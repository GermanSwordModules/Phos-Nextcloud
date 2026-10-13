<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/**
 * Push / pull / conflict handling of protocol v2 (docs/protocol.md §5, §7).
 * Independent of Nextcloud so the conformance vectors can drive it directly.
 */
class SyncService {
	public const MAX_PAYLOAD_BYTES = 1048576;
	/** manifests of files in the owner's storage: only the owner writes them */
	public const FILESET_TYPES = ['module', 'ebook', 'presAssets'];
	/** never in a shared collection */
	public const PRIVATE_TYPES = ['moduleKey'];
	public const MAX_PUSH = 500;
	public const MAX_PULL = 1000;
	private const RETRIES = 10;

	private Merger $merger;

	public function __construct(
		private RecordStore $store,
		private TypeRegistry $types,
		private Clock $clock,
	) {
		$this->merger = new Merger($types);
	}

	/**
	 * @param list<array> $changes decoded push entries (payload objects as \stdClass)
	 * @return list<array> one result per change, same order
	 */
	public function push(string $uid, string $device, array $changes): array {
		if (!preg_match('/^[0-9a-f]{16}$/', $device)) {
			throw new \InvalidArgumentException('device must be 16 lowercase hex digits');
		}
		if (count($changes) > self::MAX_PUSH) {
			throw new \InvalidArgumentException('at most ' . self::MAX_PUSH . ' changes per push');
		}
		$results = [];
		foreach ($changes as $c) {
			$results[] = $this->pushOne($uid, $device, $c);
		}
		return $results;
	}

	private function pushOne(string $uid, string $device, array $c): array {
		$changeId = is_string($c['changeId'] ?? null) ? $c['changeId'] : '';
		$err = $this->validate($c);
		if ($err !== null) {
			return ['changeId' => $changeId, 'status' => 'invalid', 'error' => $err];
		}

		$collection = $c['collection'] ?? null;
		$type = $c['type'];
		$key = $c['key'];
		if ($collection !== null && $collection !== '' && $collection !== $this->store->personalCollection($uid)) {
			$info = $this->store->getCollection($collection);
			if (in_array($type, self::PRIVATE_TYPES, true)) {
				return ['changeId' => $changeId, 'status' => 'forbidden', 'error' => "$type is never shared"];
			}
			if ($info !== null && in_array($type, self::FILESET_TYPES, true) && $info['owner'] !== $uid) {
				// the files live in the owner's storage; members only read them
				$res = ['changeId' => $changeId, 'status' => 'forbidden', 'error' => 'only the owner changes shared files'];
				$cur = $this->store->find($collection, $type, $key);
				if ($cur !== null) {
					$res['record'] = $cur->toArray();
				}
				return $res;
			}
		}
		if ($collection === null || $collection === '') {
			$collection = $this->store->personalCollection($uid);
		} elseif (!in_array($collection, $this->store->writableCollections($uid), true)) {
			// read-only (or no) access: hand back what is there, so the client
			// can undo the local edit
			$res = ['changeId' => $changeId, 'status' => 'forbidden', 'error' => 'collection not writable'];
			if (in_array($collection, $this->store->readableCollections($uid), true)) {
				$cur = $this->store->find($collection, $type, $key);
				if ($cur !== null) {
					$res['record'] = $cur->toArray();
				}
			}
			return $res;
		}

		$done = $this->store->findChange($uid, $changeId);
		if ($done !== null) {
			$cur = $this->store->find($done['collection'], $done['type'], $done['key']);
			$res = ['changeId' => $changeId, 'status' => 'duplicate', 'record' => $cur?->toArray()];
			if ($done['conflictId'] !== null) {
				$res['conflictId'] = $done['conflictId'];
			}
			return $res;
		}

		$deleted = $c['op'] === 'delete';
		$payload = $deleted ? null : $c['payload'];
		$hlc = Hlc::clamp($c['hlc'], $this->clock->nowMs(), $device);
		$baseRev = (int)($c['baseRev'] ?? 0);

		for ($attempt = 0; $attempt < self::RETRIES; $attempt++) {
			try {
				$res = $this->apply($uid, $device, $collection, $type, $key, $deleted, $payload, $hlc, $baseRev);
			} catch (ConcurrentWriteException) {
				continue;
			}
			$this->store->logChange($uid, $changeId, $collection, $type, $key, $res['status'], $res['conflictId'] ?? null);
			$from = $c['moveFrom'] ?? null;
			if (is_string($from) && $from !== '' && $from !== $collection
				&& in_array($res['status'], ['accepted', 'merged'], true)) {
				$this->tombstone($uid, $device, $from, $type, $key, $hlc);
			}
			return ['changeId' => $changeId] + $res;
		}
		return ['changeId' => $changeId, 'status' => 'invalid', 'error' => 'record busy, retry later'];
	}

	private function apply(string $uid, string $device, string $collection, string $type, string $key,
		bool $deleted, mixed $payload, string $hlc, int $baseRev): array {
		$theirs = $this->store->find($collection, $type, $key);
		$mine = new Record($collection, $type, $key, 0, $hlc, $device, $deleted, $payload);

		if ($theirs === null) {
			return ['status' => 'accepted', 'record' => $this->store->write($mine, 0, $uid)->toArray()];
		}
		if ($theirs->sameContent($deleted, $payload)) {
			return ['status' => 'accepted', 'record' => $theirs->toArray()];
		}
		if ($baseRev === $theirs->rev) {
			return ['status' => 'accepted', 'record' => $this->store->write($mine, $theirs->rev, $uid)->toArray()];
		}

		$base = $baseRev > 0 ? $this->store->findVersion($collection, $type, $key, $baseRev) : null;
		$m = $this->merger->merge($type,
			$base?->payload, $base?->deleted ?? false,
			$deleted, $payload, $hlc,
			$theirs->deleted, $theirs->payload, $theirs->hlc);

		switch ($m['outcome']) {
			case Merger::MINE:
				$mine->hlc = Hlc::max($hlc, $theirs->hlc);
				return ['status' => 'accepted', 'record' => $this->store->write($mine, $theirs->rev, $uid)->toArray()];
			case Merger::THEIRS:
				return ['status' => 'superseded', 'record' => $theirs->toArray()];
			case Merger::MERGED:
				$merged = new Record($collection, $type, $key, 0, Hlc::max($hlc, $theirs->hlc), $device, false, $m['payload']);
				return ['status' => 'merged', 'record' => $this->store->write($merged, $theirs->rev, $uid)->toArray()];
			default:
				$id = $this->store->addConflict($uid, $mine);
				return ['status' => 'conflict', 'record' => $theirs->toArray(), 'conflictId' => $id];
		}
	}

	/** The other half of a move: the record leaves its old collection. */
	private function tombstone(string $uid, string $device, string $collection, string $type, string $key, string $hlc): void {
		if (!in_array($collection, $this->store->writableCollections($uid), true)) {
			return;
		}
		for ($attempt = 0; $attempt < self::RETRIES; $attempt++) {
			$old = $this->store->find($collection, $type, $key);
			if ($old === null || $old->deleted) {
				return;
			}
			try {
				$this->store->write(new Record($collection, $type, $key, 0, Hlc::max($hlc, $old->hlc), $device, true, null),
					$old->rev, $uid);
				return;
			} catch (ConcurrentWriteException) {
			}
		}
	}

	private function validate(array $c): ?string {
		foreach (['changeId' => 64, 'type' => 64, 'key' => 255] as $f => $max) {
			if (!is_string($c[$f] ?? null) || $c[$f] === '' || strlen($c[$f]) > $max) {
				return "$f must be a string of 1..$max bytes";
			}
		}
		if (!preg_match('/^[A-Za-z][A-Za-z0-9_]*$/', $c['type'])) {
			return 'type must be an identifier';
		}
		if (!in_array($c['op'] ?? null, ['upsert', 'delete'], true)) {
			return 'op must be upsert or delete';
		}
		if (!is_string($c['hlc'] ?? null) || !Hlc::isValid($c['hlc'])) {
			return 'hlc malformed';
		}
		if (isset($c['moveFrom']) && !is_string($c['moveFrom'])) {
			return 'moveFrom must be a collection id';
		}
		if (isset($c['baseRev']) && (!is_int($c['baseRev']) || $c['baseRev'] < 0)) {
			return 'baseRev must be a non-negative integer';
		}
		if ($c['op'] === 'upsert') {
			if (!array_key_exists('payload', $c) || $c['payload'] === null) {
				return 'upsert needs a payload';
			}
			if (strlen(Canonical::encode($c['payload'])) > self::MAX_PAYLOAD_BYTES) {
				return 'tooLarge';
			}
		}
		return null;
	}

	/**
	 * @param list<string>|null $only restrict to these collections (a client
	 *        reading a collection it just joined, from cursor 0)
	 * @return array{changes:list<array>, cursor:int, hasMore:bool, resetRequired:bool, joined:list<string>, collections:list<array>}
	 */
	public function pull(string $uid, int $cursor, int $limit = 500, ?array $types = null, ?array $only = null): array {
		$limit = max(1, min($limit, self::MAX_PULL));
		$cols = $this->store->collections($uid);
		$ids = array_column($cols, 'id');
		$joined = [];
		if ($only !== null) {
			$ids = array_values(array_intersect($ids, $only));
		} elseif ($cursor > 0) {
			// access granted after this client's cursor: what was in there
			// before has older revs — the client must read it from 0
			foreach ($cols as $c) {
				if ($c['since'] > $cursor) {
					$joined[] = $c['id'];
				}
			}
		}
		$info = array_map(fn ($c) => ['id' => $c['id'], 'name' => $c['name'], 'owner' => $c['owner'],
			'kind' => $c['kind'], 'perm' => $c['perm']], $cols);
		$horizon = $this->store->gcHorizon();
		if ($only === null && $cursor > 0 && $cursor < $horizon) {
			return ['changes' => [], 'cursor' => $cursor, 'hasMore' => false, 'resetRequired' => true,
				'joined' => [], 'collections' => $info];
		}
		$rows = $ids === [] ? [] : $this->store->changesSince($ids, $cursor, $limit + 1, $types);
		$hasMore = count($rows) > $limit;
		$rows = array_slice($rows, 0, $limit);
		$out = array_map(fn (Record $r) => $r->toArray(), $rows);
		$next = $rows === [] ? $cursor : end($rows)->rev;
		if (!$hasMore && $only === null) {
			// step past every grant, so "joined" is reported once
			foreach ($cols as $c) {
				$next = max($next, $c['since']);
			}
		}
		return ['changes' => $out, 'cursor' => $next, 'hasMore' => $hasMore, 'resetRequired' => false,
			'joined' => $joined, 'collections' => $info];
	}

	/** @return list<array> */
	public function conflicts(string $uid): array {
		return array_map(fn ($c) => ['id' => $c['id'], 'created' => $c['created']] + $c['record']->toArray(),
			$this->store->openConflicts($uid));
	}

	/**
	 * @param string $use 'server' (discard the conflicting version) or 'conflict' (write it)
	 * @return array|null|false the current record (null if none), false when there is no such open conflict
	 */
	public function resolve(string $uid, int $id, string $use, mixed $payload = null): array|null|false {
		$c = $this->store->getConflict($uid, $id);
		if ($c === null) {
			return false;
		}
		/** @var Record $losing */
		$losing = $c['record'];
		$cur = $this->store->find($losing->collection, $losing->type, $losing->key);
		if ($use === 'conflict') {
			if (!in_array($losing->collection, $this->store->writableCollections($uid), true)) {
				throw new \InvalidArgumentException('collection not writable');
			}
			$now = $this->clock->nowMs();
			$hlc = Hlc::format($now, 0, $losing->device);
			if ($cur !== null) {
				$hlc = Hlc::max($hlc, $cur->hlc);
				if ($hlc === $cur->hlc) {
					$hlc = Hlc::format(Hlc::ms($cur->hlc), ((int)hexdec(substr($cur->hlc, 14, 4))) + 1, $losing->device);
				}
			}
			$write = new Record($losing->collection, $losing->type, $losing->key, 0, $hlc, $losing->device,
				false, $payload ?? $losing->payload);
			for ($attempt = 0; ; $attempt++) {
				try {
					$cur = $this->store->write($write, $cur?->rev ?? 0, $uid);
					break;
				} catch (ConcurrentWriteException $e) {
					if ($attempt >= self::RETRIES) {
						throw $e;
					}
					$cur = $this->store->find($losing->collection, $losing->type, $losing->key);
				}
			}
		}
		$this->store->closeConflict($uid, $id);
		return $cur?->toArray();
	}
}
