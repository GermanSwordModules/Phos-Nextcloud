<?php

declare(strict_types=1);

namespace OCA\Phos\Db;

use OCA\Phos\Sync\Clock;
use OCP\DB\Exception as DbException;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** Devices a user syncs from (docs/protocol.md §7 /devices). */
class DeviceStore {
	public function __construct(
		private IDBConnection $db,
		private Clock $clock,
	) {
	}

	public static function isDeviceId(string $id): bool {
		return preg_match('/^[0-9a-f]{16}$/', $id) === 1;
	}

	/** Registers or updates; only non-null fields are changed. */
	public function touch(string $uid, string $deviceId, ?string $name = null, ?string $platform = null,
		?string $appVersion = null, ?int $cursor = null): void {
		$now = $this->clock->nowMs();
		$qb = $this->db->getQueryBuilder();
		$qb->update('phos_devices')->set('last_seen', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT));
		foreach (['name' => $name, 'platform' => $platform, 'app_version' => $appVersion] as $col => $v) {
			if ($v !== null) {
				$qb->set($col, $qb->createNamedParameter(mb_substr($v, 0, $col === 'name' ? 255 : 32)));
			}
		}
		if ($cursor !== null) {
			$qb->set('last_cursor', $qb->createNamedParameter($cursor, IQueryBuilder::PARAM_INT));
		}
		$qb->where($qb->expr()->eq('uid', $qb->createNamedParameter($uid)))
			->andWhere($qb->expr()->eq('device_id', $qb->createNamedParameter($deviceId)));
		if ($qb->executeStatement() > 0) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		try {
			$qb->insert('phos_devices')->values([
				'uid' => $qb->createNamedParameter($uid),
				'device_id' => $qb->createNamedParameter($deviceId),
				'name' => $qb->createNamedParameter($name === null ? null : mb_substr($name, 0, 255)),
				'platform' => $qb->createNamedParameter($platform === null ? null : mb_substr($platform, 0, 32)),
				'app_version' => $qb->createNamedParameter($appVersion === null ? null : mb_substr($appVersion, 0, 32)),
				'last_seen' => $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT),
				'last_cursor' => $qb->createNamedParameter($cursor ?? 0, IQueryBuilder::PARAM_INT),
			])->executeStatement();
		} catch (DbException $e) {
			if ($e->getReason() !== DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
	}

	/** @return list<array{id:string,name:?string,platform:?string,appVersion:?string,lastSeen:int,lastCursor:int}> */
	public function list(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from('phos_devices')
			->where($qb->expr()->eq('uid', $qb->createNamedParameter($uid)))
			->orderBy('last_seen', 'DESC');
		$res = $qb->executeQuery();
		$out = [];
		while (($r = $res->fetch()) !== false) {
			$out[] = [
				'id' => (string)$r['device_id'],
				'name' => $r['name'],
				'platform' => $r['platform'],
				'appVersion' => $r['app_version'],
				'lastSeen' => (int)$r['last_seen'],
				'lastCursor' => (int)$r['last_cursor'],
			];
		}
		$res->closeCursor();
		return $out;
	}

	public function delete(string $uid, string $deviceId): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->delete('phos_devices')
			->where($qb->expr()->eq('uid', $qb->createNamedParameter($uid)))
			->andWhere($qb->expr()->eq('device_id', $qb->createNamedParameter($deviceId)));
		return $qb->executeStatement() > 0;
	}
}
