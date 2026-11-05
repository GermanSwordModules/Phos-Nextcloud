<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\Notification\ShareNotifier;
use OCA\Phos\Sync\CollectionService;
use OCA\Phos\Sync\RecordStore;
use OCA\Phos\Sync\ForbiddenException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\Collaboration\Collaborators\ISearch;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\Share\IShare;

/** Shared collections, their members, and finding people to share with (docs/protocol.md §11). */
class CollectionsController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private CollectionService $collections,
		private IUserManager $users,
		private IGroupManager $groups,
		private ISearch $search,
		private ShareNotifier $notifier,
		private RecordStore $store,
	) {
		parent::__construct($appName, $request);
	}

	private function uid(): string {
		return $this->session->getUser()->getUID();
	}

	private function body(): array {
		$raw = file_get_contents('php://input');
		$b = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
		return is_array($b) ? $b : [];
	}

	private function userName(string $uid): string {
		return $this->users->getDisplayName($uid) ?? $uid;
	}

	private function principalName(string $type, string $id): string {
		return match ($type) {
			'user' => $this->userName($id),
			'group' => $this->groups->get($id)?->getDisplayName() ?? $id,
			default => $id,
		};
	}

	private static function fail(\Throwable $e): DataResponse {
		$code = $e instanceof ForbiddenException ? Http::STATUS_FORBIDDEN : Http::STATUS_BAD_REQUEST;
		return new DataResponse(['error' => $e->getMessage()], $code);
	}

	#[NoAdminRequired]
	public function index(): DataResponse {
		$out = [];
		foreach ($this->collections->list($this->uid()) as $c) {
			$out[] = $c + ['ownerName' => $this->userName($c['owner'])];
		}
		return new DataResponse(['collections' => $out]);
	}

	#[NoAdminRequired]
	public function create(): DataResponse {
		try {
			$id = $this->collections->create($this->uid(), (string)($this->body()['name'] ?? ''));
			return new DataResponse(['id' => $id]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function update(string $collection): DataResponse {
		$id = $collection;   // not "id": body fields are merged into route parameters
		try {
			$this->collections->rename($this->uid(), $id, (string)($this->body()['name'] ?? ''));
			return new DataResponse([]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function destroy(string $collection): DataResponse {
		$id = $collection;   // not "id": body fields are merged into route parameters
		try {
			$this->collections->delete($this->uid(), $id);
			$this->notifier->revoked($id);
			return new DataResponse([]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function members(string $collection): DataResponse {
		$id = $collection;   // not "id": body fields are merged into route parameters
		try {
			$out = [];
			foreach ($this->collections->members($this->uid(), $id) as $m) {
				$out[] = $m + ['displayName' => $this->principalName($m['ptype'], $m['pid'])];
			}
			return new DataResponse(['members' => $out]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function addMember(string $collection): DataResponse {
		$id = $collection;   // not "id": body fields are merged into route parameters
		$b = $this->body();
		$ptype = (string)($b['type'] ?? '');
		$pid = (string)($b['id'] ?? '');
		try {
			$known = false;
			foreach ($this->store->members($id) as $m) {
				$known = $known || ($m['ptype'] === $ptype && $m['pid'] === $pid);
			}
			$this->collections->addMember($this->uid(), $id, $ptype, $pid, (string)($b['perm'] ?? 'read'));
			if (!$known) {   // a changed permission is no news
				$this->notifier->shared($this->uid(), $this->store->getCollection($id) ?? ['id' => $id, 'owner' => ''],
					$ptype, $pid);
			}
			return new DataResponse([]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function removeMember(string $collection, string $type, string $pid): DataResponse {
		$id = $collection;
		try {
			$this->collections->removeMember($this->uid(), $id, $type, $pid);
			if ($type === 'user') {
				$this->notifier->revoked($id, $pid);
			}
			return new DataResponse([]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	/** The collection's public link, if any — separate from the members list
	 *  (members() filters the link's pseudo-member row out). */
	#[NoAdminRequired]
	public function getLink(string $collection): DataResponse {
		try {
			return new DataResponse(['token' => $this->collections->linkToken($this->uid(), $collection)]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function createLink(string $collection): DataResponse {
		try {
			return new DataResponse(['token' => $this->collections->ensureLink($this->uid(), $collection)]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	#[NoAdminRequired]
	public function removeLink(string $collection): DataResponse {
		try {
			$this->collections->revokeLink($this->uid(), $collection);
			return new DataResponse([]);
		} catch (\Throwable $e) {
			return self::fail($e);
		}
	}

	/** People, groups and teams to share with — Nextcloud's own sharee search. */
	#[NoAdminRequired]
	public function sharees(string $search = ''): DataResponse {
		$types = [IShare::TYPE_USER, IShare::TYPE_GROUP];
		if (defined(IShare::class . '::TYPE_CIRCLE')) {
			$types[] = IShare::TYPE_CIRCLE;
		}
		[$result] = $this->search->search($search, $types, false, 25, 0);
		$out = [];
		$map = ['users' => 'user', 'groups' => 'group', 'circles' => 'team'];
		foreach ([$result['exact'] ?? [], $result] as $block) {
			foreach ($map as $k => $type) {
				foreach ($block[$k] ?? [] as $hit) {
					$id = (string)($hit['value']['shareWith'] ?? '');
					if ($id === '' || ($type === 'user' && $id === $this->uid())) {
						continue;
					}
					$out[$type . ':' . $id] = ['type' => $type, 'id' => $id, 'label' => (string)($hit['label'] ?? $id)];
				}
			}
		}
		return new DataResponse(['sharees' => array_values($out)]);
	}
}
