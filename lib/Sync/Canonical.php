<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** Canonical JSON: object keys sorted recursively, so equal data encodes equally. */
final class Canonical {
	public static function encode(mixed $value): string {
		return json_encode(self::normalize($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
	}

	public static function equals(mixed $a, mixed $b): bool {
		return self::encode($a) === self::encode($b);
	}

	public static function hash(mixed $value): string {
		return hash('sha256', self::encode($value));
	}

	/**
	 * Payloads are decoded with objects as \stdClass (json_decode without
	 * assoc) so that an empty object stays "{}" and never turns into "[]".
	 */
	private static function normalize(mixed $v): mixed {
		if ($v instanceof \stdClass) {
			$v = (array)$v;
			ksort($v, SORT_STRING);
			$o = new \stdClass();
			foreach ($v as $k => $x) {
				$o->{$k} = self::normalize($x);
			}
			return $o;
		}
		if (is_array($v)) {
			if (array_is_list($v)) {
				return array_map([self::class, 'normalize'], $v);
			}
			return self::normalize((object)$v);
		}
		return $v;
	}
}
