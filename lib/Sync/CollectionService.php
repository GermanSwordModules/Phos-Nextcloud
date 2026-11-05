<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/**
 * Shared collections and their members (docs/protocol.md §11).
 * Owner and admins manage members; only the owner deletes; anyone may
 * leave (remove their own user membership).
 */
class CollectionService {
	public const PTYPES = ['user', 'group', 'team'];

	public function __construct(
		private RecordStore $store,
	) {
	}

	/** @return array{id:string,name:?string,owner:string,kind:string,perm:string,since:int} */
	private function access(string $uid, string $id): array {
		foreach ($this->store->collections($uid) as $c) {
			if ($c['id'] === $id) {
				return $c;
			}
		}
		throw new ForbiddenException('no access to this collection');
	}

	public function list(string $uid): array {
		return $this->store->collections($uid);
	}

	public function create(string $uid, string $name): string {
		$name = trim($name);
		if ($name === '' || mb_strlen($name) > 255) {
			throw new \InvalidArgumentException('name must be 1..255 characters');
		}
		return $this->store->createCollection($uid, $name);
	}

	public function rename(string $uid, string $id, string $name): void {
		$c = $this->access($uid, $id);
		if ($c['kind'] !== 'shared' || !CollectionPerm::canAdmin($c['perm'])) {
			throw new ForbiddenException('only admins rename a shared collection');
		}
		$this->store->renameCollection($id, trim($name));
	}

	public function delete(string $uid, string $id): void {
		$c = $this->access($uid, $id);
		if ($c['kind'] !== 'shared' || $c['owner'] !== $uid) {
			throw new ForbiddenException('only the owner deletes a shared collection');
		}
		$this->store->deleteCollection($id);
	}

	/** People/group/team members only — the public-link pseudo-member (if any)
	 *  is managed separately through linkToken/ensureLink/revokeLink. */
	public function members(string $uid, string $id): array {
		$this->access($uid, $id);
		return array_values(array_filter($this->store->members($id), static fn($m) => $m['ptype'] !== 'link'));
	}

	public function addMember(string $uid, string $id, string $ptype, string $pid, string $perm): void {
		$c = $this->access($uid, $id);
		if ($c['kind'] !== 'shared' || !CollectionPerm::canAdmin($c['perm'])) {
			throw new ForbiddenException('only admins add members');
		}
		if (!in_array($ptype, self::PTYPES, true) || $pid === '' || !in_array($perm, CollectionPerm::ALL, true)) {
			throw new \InvalidArgumentException('type must be user|group|team, perm read|write|admin');
		}
		if ($ptype === 'user' && $pid === $c['owner']) {
			throw new \InvalidArgumentException('the owner is always a member');
		}
		$this->store->setMember($id, $ptype, $pid, $perm);
	}

	/** Current public-link token, or null when none is set. Stored as an
	 *  ordinary 'link'-type member row (pid = token, perm = 'read') — inert
	 *  to every existing access check, which only ever matches 'user'/
	 *  'group'/'team' principals (see RecordStore::collectionForToken, the
	 *  only code that reads it back). */
	public function linkToken(string $uid, string $id): ?string {
		$this->access($uid, $id);
		foreach ($this->store->members($id) as $m) {
			if ($m['ptype'] === 'link') {
				return $m['pid'];
			}
		}
		return null;
	}

	/** Creates the public link if there isn't one yet (idempotent — the same
	 *  token comes back on repeat calls, so the URL stays stable once shared). */
	public function ensureLink(string $uid, string $id): string {
		$c = $this->access($uid, $id);
		if ($c['kind'] !== 'shared' || !CollectionPerm::canAdmin($c['perm'])) {
			throw new ForbiddenException('only admins manage the public link');
		}
		foreach ($this->store->members($id) as $m) {
			if ($m['ptype'] === 'link') {
				return $m['pid'];
			}
		}
		$token = bin2hex(random_bytes(24));
		$this->store->setMember($id, 'link', $token, 'read');
		return $token;
	}

	public function revokeLink(string $uid, string $id): void {
		$c = $this->access($uid, $id);
		if ($c['kind'] !== 'shared' || !CollectionPerm::canAdmin($c['perm'])) {
			throw new ForbiddenException('only admins manage the public link');
		}
		foreach ($this->store->members($id) as $m) {
			if ($m['ptype'] === 'link') {
				$this->store->removeMember($id, 'link', $m['pid']);
			}
		}
	}

	public function removeMember(string $uid, string $id, string $ptype, string $pid): void {
		$c = $this->access($uid, $id);
		$self = $ptype === 'user' && $pid === $uid;
		if (!$self && ($c['kind'] !== 'shared' || !CollectionPerm::canAdmin($c['perm']))) {
			throw new ForbiddenException('only admins remove members (anyone may leave)');
		}
		$this->store->removeMember($id, $ptype, $pid);
	}
}
