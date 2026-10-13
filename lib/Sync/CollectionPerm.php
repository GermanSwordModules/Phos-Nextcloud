<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** Permission levels of a shared collection: read < write < admin. */
final class CollectionPerm {
	public const ALL = ['read', 'write', 'admin'];

	public static function rank(string $perm): int {
		return match ($perm) {
			'admin' => 3,
			'write' => 2,
			'read' => 1,
			default => 0,
		};
	}

	public static function canWrite(string $perm): bool {
		return self::rank($perm) >= 2;
	}

	public static function canAdmin(string $perm): bool {
		return self::rank($perm) >= 3;
	}
}
