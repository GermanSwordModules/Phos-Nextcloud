<?php

declare(strict_types=1);

namespace OCA\Phos\BackgroundJob;

use OCA\Phos\Db\DbRecordStore;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/** Daily: purge old tombstones (raising the gc horizon) and old push-log rows (docs/protocol.md §9). */
class TombstoneGc extends TimedJob {
	public const TOMBSTONE_DAYS = 180;
	public const PUSHLOG_DAYS = 30;

	public function __construct(
		ITimeFactory $time,
		private DbRecordStore $store,
	) {
		parent::__construct($time);
		$this->setInterval(24 * 3600);
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		$nowMs = $this->time->getTime() * 1000;
		$this->store->purgeTombstones($nowMs - self::TOMBSTONE_DAYS * 86400000);
		$this->store->prunePushLog($nowMs - self::PUSHLOG_DAYS * 86400000);
	}
}
