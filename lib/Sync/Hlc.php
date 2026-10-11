<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/**
 * Hybrid logical clock stamp "<ms:13>-<counter:4 hex>-<device:16 hex>".
 * Plain string comparison orders stamps (docs/protocol.md §3).
 */
final class Hlc {
	public const PATTERN = '/^\d{13}-[0-9a-f]{4}-[0-9a-f]{16}$/';
	/** Stamps further than this in the server's future are clamped. */
	public const MAX_FUTURE_MS = 300000;

	public static function isValid(string $hlc): bool {
		return preg_match(self::PATTERN, $hlc) === 1;
	}

	public static function format(int $ms, int $counter, string $device): string {
		return sprintf('%013d-%04x-%s', $ms, $counter & 0xffff, $device);
	}

	public static function ms(string $hlc): int {
		return (int)substr($hlc, 0, 13);
	}

	public static function compare(string $a, string $b): int {
		return strcmp($a, $b) <=> 0;
	}

	public static function max(string $a, string $b): string {
		return strcmp($a, $b) >= 0 ? $a : $b;
	}

	/** Replaces a stamp from a clock running too far ahead with server time. */
	public static function clamp(string $hlc, int $nowMs, string $device): string {
		if (self::ms($hlc) > $nowMs + self::MAX_FUTURE_MS) {
			return self::format($nowMs, 0, $device);
		}
		return $hlc;
	}
}
