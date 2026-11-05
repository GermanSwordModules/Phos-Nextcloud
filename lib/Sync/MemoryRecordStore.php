<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** RecordStore in memory — conformance vectors and unit tests. */
final class MemoryRecordStore implements RecordStore {
	private int $seq = 0;
	/** @var array<string, Record> */
	private array $records = [];
	/** @var array<string, array<int, Record>> */
	private array $history = [];
	private array $changes = [];
	private array $conflicts = [];
	private int $conflictSeq = 0;
	public int $horizon = 0;

	private static function k(string $c, string $t, string $k): string {
		return "$c\x00$t\x00$k";
	}

	public function personalCollection(string $uid): string {
		return 'personal-' . $uid;
	}

	/** @var array<string, array{id:string,name:?string,owner:string,kind:string}> */
	private array $collections = [];
	/** @var array<string, array<string, array{ptype:string,pid:string,perm:string,since:int}>> */
	private array $members = [];
	/** @var array<string, list<string>> uid -> groups (vectors set this) */
	public array $groups = [];
	private int $collSeq = 0;

	public function collections(string $uid): array {
		$out = [['id' => $this->personalCollection($uid), 'name' => null, 'owner' => $uid,
			'kind' => 'personal', 'perm' => 'admin', 'since' => 0]];
		foreach ($this->collections as $c) {
			if ($c['owner'] === $uid) {
				$out[] = $c + ['perm' => 'admin', 'since' => 0];
				continue;
			}
			$best = null;
			foreach ($this->members[$c['id']] ?? [] as $m) {
				$hit = ($m['ptype'] === 'user' && $m['pid'] === $uid)
					|| ($m['ptype'] === 'group' && in_array($m['pid'], $this->groups[$uid] ?? [], true));
				if ($hit && ($best === null || CollectionPerm::rank($m['perm']) > CollectionPerm::rank($best['perm']))) {
					$best = $m;
				}
			}
			if ($best !== null) {
				$out[] = $c + ['perm' => $best['perm'], 'since' => $best['since']];
			}
		}
		return $out;
	}

	public function readableCollections(string $uid): array {
		return array_column($this->collections($uid), 'id');
	}

	public function writableCollections(string $uid): array {
		return array_column(array_filter($this->collections($uid),
			fn ($c) => CollectionPerm::canWrite($c['perm'])), 'id');
	}

	public function getCollection(string $id): ?array {
		return $this->collections[$id] ?? null;
	}

	public function createCollection(string $uid, string $name): string {
		$id = 'shared-' . (++$this->collSeq);
		$this->collections[$id] = ['id' => $id, 'name' => $name, 'owner' => $uid, 'kind' => 'shared'];
		return $id;
	}

	public function renameCollection(string $id, string $name): void {
		if (isset($this->collections[$id])) {
			$this->collections[$id]['name'] = $name;
		}
	}

	public function deleteCollection(string $id): void {
		unset($this->collections[$id], $this->members[$id]);
		foreach ($this->records as $k => $r) {
			if ($r->collection === $id) {
				unset($this->records[$k], $this->history[$k]);
			}
		}
	}

	public function members(string $collection): array {
		return array_values($this->members[$collection] ?? []);
	}

	public function setMember(string $collection, string $ptype, string $pid, string $perm): void {
		$k = "$ptype\x00$pid";
		$since = $this->members[$collection][$k]['since'] ?? ++$this->seq;
		$this->members[$collection][$k] = ['ptype' => $ptype, 'pid' => $pid, 'perm' => $perm, 'since' => $since];
	}

	public function payloadMentions(string $collection, string $needle): bool {
		foreach ($this->records as $r) {
			if ($r->collection === $collection && !$r->deleted && str_contains(json_encode($r->payload), $needle)) {
				return true;
			}
		}
		return false;
	}

	public function removeMember(string $collection, string $ptype, string $pid): void {
		unset($this->members[$collection]["$ptype\x00$pid"]);
	}

	public function collectionForToken(string $token): ?string {
		if ($token === '') {
			return null;
		}
		foreach ($this->members as $collId => $byKey) {
			foreach ($byKey as $m) {
				if ($m['ptype'] === 'link' && $m['pid'] === $token) {
					return (string)$collId;
				}
			}
		}
		return null;
	}

	public function find(string $collection, string $type, string $key): ?Record {
		$r = $this->records[self::k($collection, $type, $key)] ?? null;
		return $r === null ? null : clone $r;
	}

	public function findVersion(string $collection, string $type, string $key, int $rev): ?Record {
		$r = $this->history[self::k($collection, $type, $key)][$rev] ?? null;
		return $r === null ? null : clone $r;
	}

	public function write(Record $record, int $expectedRev, string $uid): Record {
		$k = self::k($record->collection, $record->type, $record->key);
		$cur = $this->records[$k] ?? null;
		if (($cur?->rev ?? 0) !== $expectedRev) {
			throw new ConcurrentWriteException();
		}
		$r = clone $record;
		$r->rev = ++$this->seq;
		$this->records[$k] = $r;
		$this->history[$k][$r->rev] = clone $r;
		return clone $r;
	}

	public function logChange(string $uid, string $changeId, string $collection, string $type, string $key, string $status, ?int $conflictId): void {
		$this->changes["$uid\x00$changeId"] = compact('collection', 'type', 'key', 'status', 'conflictId');
	}

	public function findChange(string $uid, string $changeId): ?array {
		return $this->changes["$uid\x00$changeId"] ?? null;
	}

	public function changesSince(array $collections, int $cursor, int $limit, ?array $types): array {
		$out = array_filter($this->records, fn (Record $r) => $r->rev > $cursor
			&& in_array($r->collection, $collections, true)
			&& ($types === null || in_array($r->type, $types, true)));
		usort($out, fn ($a, $b) => $a->rev <=> $b->rev);
		return array_map(fn ($r) => clone $r, array_slice($out, 0, $limit));
	}

	public function addConflict(string $uid, Record $losing): int {
		$id = ++$this->conflictSeq;
		$this->conflicts[$id] = ['id' => $id, 'uid' => $uid, 'record' => clone $losing, 'created' => 0, 'open' => true];
		return $id;
	}

	public function openConflicts(string $uid): array {
		return array_values(array_map(fn ($c) => ['id' => $c['id'], 'record' => $c['record'], 'created' => $c['created']],
			array_filter($this->conflicts, fn ($c) => $c['open'] && in_array($c['record']->collection, $this->readableCollections($uid), true))));
	}

	public function getConflict(string $uid, int $id): ?array {
		$c = $this->conflicts[$id] ?? null;
		if ($c === null || !$c['open'] || !in_array($c['record']->collection, $this->readableCollections($uid), true)) {
			return null;
		}
		return ['id' => $c['id'], 'record' => $c['record'], 'created' => $c['created']];
	}

	public function closeConflict(string $uid, int $id): void {
		if (isset($this->conflicts[$id])) {
			$this->conflicts[$id]['open'] = false;
		}
	}

	public function gcHorizon(): int {
		return $this->horizon;
	}
}
