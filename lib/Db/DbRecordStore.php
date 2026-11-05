<?php

declare(strict_types=1);

namespace OCA\Phos\Db;

use OCA\Phos\Sync\Clock;
use OCA\Phos\Sync\CollectionPerm;
use OCA\Phos\Sync\ConcurrentWriteException;
use OCA\Phos\Sync\Record;
use OCA\Phos\Sync\RecordStore;
use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Teams\ITeamManager;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;

/**
 * RecordStore on the Nextcloud database.
 *
 * Writes are serialised by one exclusive lock: a rev is taken from phos_seq
 * and committed while holding it. Without that, rev 11 could commit before
 * rev 10 and a client pulling in between would advance its cursor past 10
 * and never see it.
 */
class DbRecordStore implements RecordStore {
	public const HISTORY_KEEP = 50;
	private const LOCK = 'phos/records-write';

	public function __construct(
		private IDBConnection $db,
		private ILockingProvider $locks,
		private IAppConfig $appConfig,
		private Clock $clock,
		private IGroupManager $groups,
		private IUserManager $users,
		private ITeamManager $teams,
	) {
	}

	/** user, group and team principals a user stands for */
	private function principals(string $uid): array {
		$p = [['user', $uid]];
		$user = $this->users->get($uid);
		if ($user !== null) {
			foreach ($this->groups->getUserGroupIds($user) as $g) {
				$p[] = ['group', (string)$g];
			}
		}
		try {
			if ($this->teams->hasTeamSupport()) {
				foreach ($this->teams->getTeamsForUser($uid) as $team) {
					$p[] = ['team', (string)$team->getId()];
				}
			}
		} catch (\Throwable) {
			// no Teams (Circles) app: groups and users only
		}
		return $p;
	}

	public function collections(string $uid): array {
		$personal = $this->personalCollection($uid);
		$out = [$personal => ['id' => $personal, 'name' => null, 'owner' => $uid, 'kind' => 'personal',
			'perm' => 'admin', 'since' => 0]];
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_collections')
			->where($qb->expr()->eq('owner', $qb->createNamedParameter($uid)))
			->andWhere($qb->expr()->eq('kind', $qb->createNamedParameter('shared')));
		$res = $qb->executeQuery();
		while (($r = $res->fetch()) !== false) {
			$out[$r['id']] = ['id' => (string)$r['id'], 'name' => $r['name'], 'owner' => $uid, 'kind' => 'shared',
				'perm' => 'admin', 'since' => 0];
		}
		$res->closeCursor();

		$qb = $this->db->getQueryBuilder();
		$or = [];
		foreach ($this->principals($uid) as [$t, $id]) {
			$or[] = $qb->expr()->andX(
				$qb->expr()->eq('m.ptype', $qb->createNamedParameter($t)),
				$qb->expr()->eq('m.pid', $qb->createNamedParameter($id)));
		}
		$qb->select('m.coll', 'm.perm', 'm.since', 'c.name', 'c.owner')
			->from('phos_members', 'm')
			->innerJoin('m', 'phos_collections', 'c', $qb->expr()->eq('m.coll', 'c.id'))
			->where($qb->expr()->orX(...$or));
		$res = $qb->executeQuery();
		while (($r = $res->fetch()) !== false) {
			$id = (string)$r['coll'];
			if (isset($out[$id]) && $out[$id]['owner'] === $uid) {
				continue;
			}
			$perm = (string)$r['perm'];
			if (!isset($out[$id]) || CollectionPerm::rank($perm) > CollectionPerm::rank($out[$id]['perm'])) {
				$since = (int)$r['since'];
				if (isset($out[$id])) {
					$since = min($since, $out[$id]['since']);   // earliest grant counts
				}
				$out[$id] = ['id' => $id, 'name' => $r['name'], 'owner' => (string)$r['owner'], 'kind' => 'shared',
					'perm' => $perm, 'since' => $since];
			}
		}
		$res->closeCursor();
		return array_values($out);
	}

	public function getCollection(string $id): ?array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_collections')->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		$res = $qb->executeQuery();
		$r = $res->fetch();
		$res->closeCursor();
		return $r === false ? null : ['id' => (string)$r['id'], 'name' => $r['name'], 'owner' => (string)$r['owner'],
			'kind' => (string)$r['kind']];
	}

	public function createCollection(string $uid, string $name): string {
		$h = bin2hex(random_bytes(16));
		$id = sprintf('%s-%s-4%s-8%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 13, 3), substr($h, 17, 3), substr($h, 20, 12));
		$qb = $this->db->getQueryBuilder();
		$qb->insert('phos_collections')->values([
			'id' => $qb->createNamedParameter($id),
			'owner' => $qb->createNamedParameter($uid),
			'kind' => $qb->createNamedParameter('shared'),
			'name' => $qb->createNamedParameter($name),
			'created' => $qb->createNamedParameter($this->clock->nowMs(), IQueryBuilder::PARAM_INT),
		])->executeStatement();
		return $id;
	}

	public function renameCollection(string $id, string $name): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('phos_collections')->set('name', $qb->createNamedParameter($name))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id)))->executeStatement();
	}

	public function deleteCollection(string $id): void {
		$this->db->beginTransaction();
		try {
			$qb = $this->db->getQueryBuilder();
			$qb->select('id')->from('phos_records')->where($qb->expr()->eq('coll', $qb->createNamedParameter($id)));
			$res = $qb->executeQuery();
			$ids = [];
			while (($r = $res->fetchOne()) !== false) {
				$ids[] = (int)$r;
			}
			$res->closeCursor();
			foreach (array_chunk($ids, 500) as $chunk) {
				$qb = $this->db->getQueryBuilder();
				$qb->delete('phos_history')->where($qb->expr()->in('record_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)))->executeStatement();
			}
			foreach (['phos_records' => 'coll', 'phos_conflicts' => 'coll', 'phos_members' => 'coll', 'phos_collections' => 'id'] as $t => $col) {
				$qb = $this->db->getQueryBuilder();
				$qb->delete($t)->where($qb->expr()->eq($col, $qb->createNamedParameter($id)))->executeStatement();
			}
			$this->db->commit();
		} catch (\Throwable $e) {
			$this->db->rollBack();
			throw $e;
		}
	}

	public function members(string $collection): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('ptype', 'pid', 'perm', 'since')->from('phos_members')
			->where($qb->expr()->eq('coll', $qb->createNamedParameter($collection)))
			->orderBy('id', 'ASC');
		$res = $qb->executeQuery();
		$out = [];
		while (($r = $res->fetch()) !== false) {
			$out[] = ['ptype' => (string)$r['ptype'], 'pid' => (string)$r['pid'], 'perm' => (string)$r['perm'], 'since' => (int)$r['since']];
		}
		$res->closeCursor();
		return $out;
	}

	public function setMember(string $collection, string $ptype, string $pid, string $perm): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('phos_members')->set('perm', $qb->createNamedParameter($perm))
			->where($qb->expr()->eq('coll', $qb->createNamedParameter($collection)))
			->andWhere($qb->expr()->eq('ptype', $qb->createNamedParameter($ptype)))
			->andWhere($qb->expr()->eq('pid', $qb->createNamedParameter($pid)));
		if ($qb->executeStatement() > 0) {
			return;
		}
		// a fresh rev from the journal sequence: clients behind it read the
		// whole collection ("joined")
		$this->lock();
		try {
			$qb = $this->db->getQueryBuilder();
			$qb->insert('phos_seq')->values([
				'record_id' => $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT),
				'created' => $qb->createNamedParameter($this->clock->nowMs(), IQueryBuilder::PARAM_INT),
			])->executeStatement();
			$since = $qb->getLastInsertId();
			$qb = $this->db->getQueryBuilder();
			$qb->insert('phos_members')->values([
				'coll' => $qb->createNamedParameter($collection),
				'ptype' => $qb->createNamedParameter($ptype),
				'pid' => $qb->createNamedParameter($pid),
				'perm' => $qb->createNamedParameter($perm),
				'since' => $qb->createNamedParameter($since, IQueryBuilder::PARAM_INT),
				'created' => $qb->createNamedParameter($this->clock->nowMs(), IQueryBuilder::PARAM_INT),
			])->executeStatement();
		} finally {
			$this->locks->releaseLock(self::LOCK, ILockingProvider::LOCK_EXCLUSIVE);
		}
	}

	public function collectionForToken(string $token): ?string {
		if ($token === '') {
			return null;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('coll')->from('phos_members')
			->where($qb->expr()->eq('ptype', $qb->createNamedParameter('link')))
			->andWhere($qb->expr()->eq('pid', $qb->createNamedParameter($token)));
		$res = $qb->executeQuery();
		$r = $res->fetch();
		$res->closeCursor();
		return $r === false ? null : (string)$r['coll'];
	}

	public function payloadMentions(string $collection, string $needle): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from('phos_records')
			->where($qb->expr()->eq('coll', $qb->createNamedParameter($collection)))
			->andWhere($qb->expr()->eq('deleted', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->like('payload', $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($needle) . '%')))
			->setMaxResults(1);
		$res = $qb->executeQuery();
		$hit = $res->fetchOne() !== false;
		$res->closeCursor();
		return $hit;
	}

	public function removeMember(string $collection, string $ptype, string $pid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('phos_members')
			->where($qb->expr()->eq('coll', $qb->createNamedParameter($collection)))
			->andWhere($qb->expr()->eq('ptype', $qb->createNamedParameter($ptype)))
			->andWhere($qb->expr()->eq('pid', $qb->createNamedParameter($pid)))
			->executeStatement();
	}

	public function personalCollection(string $uid): string {
		$id = self::personalId($uid);
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from('phos_collections')->where($qb->expr()->eq('id', $qb->createNamedParameter($id)));
		$res = $qb->executeQuery();
		$exists = $res->fetchOne() !== false;
		$res->closeCursor();
		if (!$exists) {
			try {
				$qb = $this->db->getQueryBuilder();
				$qb->insert('phos_collections')->values([
					'id' => $qb->createNamedParameter($id),
					'owner' => $qb->createNamedParameter($uid),
					'kind' => $qb->createNamedParameter('personal'),
					'name' => $qb->createNamedParameter(null),
					'created' => $qb->createNamedParameter($this->clock->nowMs(), IQueryBuilder::PARAM_INT),
				])->executeStatement();
			} catch (DbException $e) {
				if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
			}
		}
		return $id;
	}

	/** Deterministic, so concurrent first requests agree on the id. */
	public static function personalId(string $uid): string {
		$h = md5('phos-personal:' . $uid);
		return sprintf('%s-%s-4%s-8%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 13, 3), substr($h, 17, 3), substr($h, 20, 12));
	}

	public function readableCollections(string $uid): array {
		return array_column($this->collections($uid), 'id');
	}

	public function writableCollections(string $uid): array {
		return array_column(array_filter($this->collections($uid),
			fn ($c) => CollectionPerm::canWrite($c['perm'])), 'id');
	}

	public function find(string $collection, string $type, string $key): ?Record {
		$row = $this->findRow($collection, $type, $key);
		return $row === null ? null : self::toRecord($row);
	}

	private function findRow(string $collection, string $type, string $key): ?array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_records')
			->where($qb->expr()->eq('coll', $qb->createNamedParameter($collection)))
			->andWhere($qb->expr()->eq('type', $qb->createNamedParameter($type)))
			->andWhere($qb->expr()->eq('rkey', $qb->createNamedParameter($key)));
		$res = $qb->executeQuery();
		$row = $res->fetch();
		$res->closeCursor();
		return $row === false ? null : $row;
	}

	public function findVersion(string $collection, string $type, string $key, int $rev): ?Record {
		$row = $this->findRow($collection, $type, $key);
		if ($row === null) {
			return null;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_history')
			->where($qb->expr()->eq('record_id', $qb->createNamedParameter((int)$row['id'], IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('rev', $qb->createNamedParameter($rev, IQueryBuilder::PARAM_INT)));
		$res = $qb->executeQuery();
		$h = $res->fetch();
		$res->closeCursor();
		if ($h === false) {
			return null;
		}
		return new Record($collection, $type, $key, (int)$h['rev'], (string)$h['hlc'], (string)$h['device'],
			(bool)$h['deleted'], self::decode($h['payload']));
	}

	public function write(Record $record, int $expectedRev, string $uid): Record {
		$this->lock();
		try {
			$this->db->beginTransaction();
			try {
				$r = $this->writeLocked($record, $expectedRev, $uid);
				$this->db->commit();
				return $r;
			} catch (\Throwable $e) {
				$this->db->rollBack();
				if ($e instanceof DbException && self::isTransient($e)) {
					// Deadlock / lock timeout / SQLite busy: let SyncService retry.
					usleep(random_int(10000, 60000));
					throw new ConcurrentWriteException($e->getMessage(), 0, $e);
				}
				throw $e;
			}
		} finally {
			$this->locks->releaseLock(self::LOCK, ILockingProvider::LOCK_EXCLUSIVE);
		}
	}

	private function writeLocked(Record $record, int $expectedRev, string $uid): Record {
		$now = $this->clock->nowMs();
		$cur = $this->findRow($record->collection, $record->type, $record->key);
		if ((int)($cur['rev'] ?? 0) !== $expectedRev) {
			throw new ConcurrentWriteException();
		}

		$qb = $this->db->getQueryBuilder();
		$qb->insert('phos_seq')->values([
			'record_id' => $qb->createNamedParameter((int)($cur['id'] ?? 0), IQueryBuilder::PARAM_INT),
			'created' => $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT),
		])->executeStatement();
		$rev = $qb->getLastInsertId();

		$payload = $record->deleted ? null : json_encode($record->payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
		$cols = [
			'rev' => [$rev, IQueryBuilder::PARAM_INT],
			'hlc' => [$record->hlc, IQueryBuilder::PARAM_STR],
			'device' => [$record->device, IQueryBuilder::PARAM_STR],
			'deleted' => [$record->deleted ? 1 : 0, IQueryBuilder::PARAM_INT],
			'payload' => [$payload, $payload === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_STR],
			'updated_by' => [$uid, IQueryBuilder::PARAM_STR],
			'updated_at' => [$now, IQueryBuilder::PARAM_INT],
		];

		if ($cur === null) {
			$qb = $this->db->getQueryBuilder();
			$values = [
				'coll' => $qb->createNamedParameter($record->collection),
				'type' => $qb->createNamedParameter($record->type),
				'rkey' => $qb->createNamedParameter($record->key),
			];
			foreach ($cols as $c => [$v, $t]) {
				$values[$c] = $qb->createNamedParameter($v, $t);
			}
			$qb->insert('phos_records')->values($values)->executeStatement();
			$recordId = $qb->getLastInsertId();
		} else {
			$recordId = (int)$cur['id'];
			$qb = $this->db->getQueryBuilder();
			$qb->update('phos_records');
			foreach ($cols as $c => [$v, $t]) {
				$qb->set($c, $qb->createNamedParameter($v, $t));
			}
			$qb->where($qb->expr()->eq('id', $qb->createNamedParameter($recordId, IQueryBuilder::PARAM_INT)))
				->andWhere($qb->expr()->eq('rev', $qb->createNamedParameter($expectedRev, IQueryBuilder::PARAM_INT)));
			if ($qb->executeStatement() !== 1) {
				throw new ConcurrentWriteException();
			}
		}

		$qb = $this->db->getQueryBuilder();
		$qb->insert('phos_history')->values([
			'record_id' => $qb->createNamedParameter($recordId, IQueryBuilder::PARAM_INT),
			'rev' => $qb->createNamedParameter($rev, IQueryBuilder::PARAM_INT),
			'hlc' => $qb->createNamedParameter($record->hlc),
			'device' => $qb->createNamedParameter($record->device),
			'deleted' => $qb->createNamedParameter($record->deleted ? 1 : 0, IQueryBuilder::PARAM_INT),
			'payload' => $qb->createNamedParameter($payload, $payload === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_STR),
		])->executeStatement();
		$this->pruneHistory($recordId);

		$r = clone $record;
		$r->rev = $rev;
		return $r;
	}

	private static function isTransient(DbException $e): bool {
		return in_array($e->getReason(), [DbException::REASON_DEADLOCK, DbException::REASON_LOCK_WAIT_TIMEOUT], true)
			|| str_contains($e->getMessage(), 'database is locked');
	}

	private function pruneHistory(int $recordId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('rev')->from('phos_history')
			->where($qb->expr()->eq('record_id', $qb->createNamedParameter($recordId, IQueryBuilder::PARAM_INT)))
			->orderBy('rev', 'DESC')
			->setFirstResult(self::HISTORY_KEEP - 1)
			->setMaxResults(1);
		$res = $qb->executeQuery();
		$oldestKept = $res->fetchOne();
		$res->closeCursor();
		if ($oldestKept === false) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete('phos_history')
			->where($qb->expr()->eq('record_id', $qb->createNamedParameter($recordId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->lt('rev', $qb->createNamedParameter((int)$oldestKept, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}

	private function lock(): void {
		// The locking provider does not wait; poll for up to ~10 s.
		for ($i = 0; ; $i++) {
			try {
				$this->locks->acquireLock(self::LOCK, ILockingProvider::LOCK_EXCLUSIVE, 'phos records');
				return;
			} catch (LockedException $e) {
				if ($i >= 400) {
					throw $e;
				}
				usleep(25000);
			}
		}
	}

	public function logChange(string $uid, string $changeId, string $collection, string $type, string $key, string $status, ?int $conflictId): void {
		$qb = $this->db->getQueryBuilder();
		try {
			$qb->insert('phos_pushlog')->values([
				'uid' => $qb->createNamedParameter($uid),
				'change_id' => $qb->createNamedParameter($changeId),
				'coll' => $qb->createNamedParameter($collection),
				'type' => $qb->createNamedParameter($type),
				'rkey' => $qb->createNamedParameter($key),
				'status' => $qb->createNamedParameter($status),
				'conflict_id' => $qb->createNamedParameter($conflictId, $conflictId === null ? IQueryBuilder::PARAM_NULL : IQueryBuilder::PARAM_INT),
				'created' => $qb->createNamedParameter($this->clock->nowMs(), IQueryBuilder::PARAM_INT),
			])->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	public function findChange(string $uid, string $changeId): ?array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('coll', 'type', 'rkey', 'status', 'conflict_id')->from('phos_pushlog')
			->where($qb->expr()->eq('uid', $qb->createNamedParameter($uid)))
			->andWhere($qb->expr()->eq('change_id', $qb->createNamedParameter($changeId)));
		$res = $qb->executeQuery();
		$row = $res->fetch();
		$res->closeCursor();
		if ($row === false) {
			return null;
		}
		return [
			'collection' => (string)$row['coll'],
			'type' => (string)$row['type'],
			'key' => (string)$row['rkey'],
			'status' => (string)$row['status'],
			'conflictId' => $row['conflict_id'] === null ? null : (int)$row['conflict_id'],
		];
	}

	public function changesSince(array $collections, int $cursor, int $limit, ?array $types): array {
		if ($collections === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_records')
			->where($qb->expr()->in('coll', $qb->createNamedParameter($collections, IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($qb->expr()->gt('rev', $qb->createNamedParameter($cursor, IQueryBuilder::PARAM_INT)))
			->orderBy('rev', 'ASC')
			->setMaxResults($limit);
		if ($types !== null) {
			$qb->andWhere($qb->expr()->in('type', $qb->createNamedParameter($types, IQueryBuilder::PARAM_STR_ARRAY)));
		}
		$res = $qb->executeQuery();
		$out = [];
		while (($row = $res->fetch()) !== false) {
			$out[] = self::toRecord($row);
		}
		$res->closeCursor();
		return $out;
	}

	public function addConflict(string $uid, Record $losing): int {
		$qb = $this->db->getQueryBuilder();
		$qb->insert('phos_conflicts')->values([
			'uid' => $qb->createNamedParameter($uid),
			'coll' => $qb->createNamedParameter($losing->collection),
			'type' => $qb->createNamedParameter($losing->type),
			'rkey' => $qb->createNamedParameter($losing->key),
			'hlc' => $qb->createNamedParameter($losing->hlc),
			'device' => $qb->createNamedParameter($losing->device),
			'payload' => $qb->createNamedParameter(json_encode($losing->payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
			'created' => $qb->createNamedParameter($this->clock->nowMs(), IQueryBuilder::PARAM_INT),
			'resolved' => $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT),
		])->executeStatement();
		return $qb->getLastInsertId();
	}

	public function openConflicts(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_conflicts')
			->where($qb->expr()->in('coll', $qb->createNamedParameter($this->readableCollections($uid), IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($qb->expr()->eq('resolved', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'ASC');
		$res = $qb->executeQuery();
		$out = [];
		while (($row = $res->fetch()) !== false) {
			$out[] = self::toConflict($row);
		}
		$res->closeCursor();
		return $out;
	}

	public function getConflict(string $uid, int $id): ?array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_conflicts')
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->in('coll', $qb->createNamedParameter($this->readableCollections($uid), IQueryBuilder::PARAM_STR_ARRAY)))
			->andWhere($qb->expr()->eq('resolved', $qb->createNamedParameter(0, IQueryBuilder::PARAM_INT)));
		$res = $qb->executeQuery();
		$row = $res->fetch();
		$res->closeCursor();
		return $row === false ? null : self::toConflict($row);
	}

	public function closeConflict(string $uid, int $id): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update('phos_conflicts')
			->set('resolved', $qb->createNamedParameter(1, IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}

	public function gcHorizon(): int {
		return $this->appConfig->getValueInt('phos', 'gc_horizon', 0);
	}

	/** Purges tombstones last written before $olderThanMs; raises the horizon. Returns the number purged. */
	public function purgeTombstones(int $olderThanMs): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id', 'rev')->from('phos_records')
			->where($qb->expr()->eq('deleted', $qb->createNamedParameter(1, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->lt('updated_at', $qb->createNamedParameter($olderThanMs, IQueryBuilder::PARAM_INT)));
		$res = $qb->executeQuery();
		$ids = [];
		$maxRev = 0;
		while (($row = $res->fetch()) !== false) {
			$ids[] = (int)$row['id'];
			$maxRev = max($maxRev, (int)$row['rev']);
		}
		$res->closeCursor();
		foreach (array_chunk($ids, 500) as $chunk) {
			$this->lock();
			try {
				foreach (['phos_history' => 'record_id', 'phos_records' => 'id'] as $table => $col) {
					$qb = $this->db->getQueryBuilder();
					$qb->delete($table)->where($qb->expr()->in($col, $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
					if ($table === 'phos_records') {
						// Skip records resurrected since we looked.
						$qb->andWhere($qb->expr()->eq('deleted', $qb->createNamedParameter(1, IQueryBuilder::PARAM_INT)));
					}
					$qb->executeStatement();
				}
			} finally {
				$this->locks->releaseLock(self::LOCK, ILockingProvider::LOCK_EXCLUSIVE);
			}
		}
		if ($maxRev > $this->gcHorizon()) {
			$this->appConfig->setValueInt('phos', 'gc_horizon', $maxRev);
		}
		return count($ids);
	}

	public function prunePushLog(int $olderThanMs): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('phos_pushlog')
			->where($qb->expr()->lt('created', $qb->createNamedParameter($olderThanMs, IQueryBuilder::PARAM_INT)))
			->executeStatement();
	}

	private static function toRecord(array $row): Record {
		return new Record((string)$row['coll'], (string)$row['type'], (string)$row['rkey'], (int)$row['rev'],
			(string)$row['hlc'], (string)$row['device'], (bool)$row['deleted'], self::decode($row['payload']));
	}

	private static function toConflict(array $row): array {
		return [
			'id' => (int)$row['id'],
			'record' => new Record((string)$row['coll'], (string)$row['type'], (string)$row['rkey'], 0,
				(string)$row['hlc'], (string)$row['device'], false, self::decode($row['payload'])),
			'created' => (int)$row['created'],
		];
	}

	private static function decode(mixed $payload): mixed {
		if ($payload === null) {
			return null;
		}
		if (is_resource($payload)) {
			$payload = stream_get_contents($payload);
		}
		return json_decode((string)$payload, false, 512, JSON_THROW_ON_ERROR);
	}
}
