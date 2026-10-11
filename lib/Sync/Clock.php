<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** Server wall clock in epoch milliseconds (injectable for tests). */
class Clock {
	public function nowMs(): int {
		return (int)floor(microtime(true) * 1000);
	}
}
