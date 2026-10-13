<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/**
 * Resolves a pushed change against a concurrently changed record
 * (docs/protocol.md §5, step 5). Pure: no storage, no clock.
 */
final class Merger {
	public const MINE = 'mine';
	public const THEIRS = 'theirs';
	public const MERGED = 'merged';
	public const CONFLICT = 'conflict';

	public function __construct(
		private TypeRegistry $types,
	) {
	}

	/**
	 * @param mixed $base payload at baseRev (null = unknown/absent)
	 * @return array{outcome:string, payload?:mixed}
	 */
	public function merge(string $type, mixed $base, bool $baseDeleted,
		bool $mineDeleted, mixed $mine, string $mineHlc,
		bool $theirsDeleted, mixed $theirs, string $theirsHlc): array {
		$cfg = $this->types->get($type);
		$mineWinsLww = Hlc::compare($mineHlc, $theirsHlc) > 0;

		if ($cfg['policy'] !== 'fields' || $mineDeleted || $theirsDeleted
			|| !($mine instanceof \stdClass) || !($theirs instanceof \stdClass)) {
			return ['outcome' => $mineWinsLww ? self::MINE : self::THEIRS];
		}

		$b = ($base instanceof \stdClass && !$baseDeleted) ? (array)$base : [];
		$m = (array)$mine;
		$t = (array)$theirs;
		$absent = self::absent();
		// Field order: theirs first, then fields only mine/base know.
		$fields = array_keys($t + $m + $b);
		$out = new \stdClass();
		foreach ($fields as $f) {
			$bv = array_key_exists($f, $b) ? $b[$f] : $absent;
			$mv = array_key_exists($f, $m) ? $m[$f] : $absent;
			$tv = array_key_exists($f, $t) ? $t[$f] : $absent;
			if (self::eq($mv, $tv)) {
				$v = $mv;
			} elseif (self::eq($mv, $bv)) {
				$v = $tv;
			} elseif (self::eq($tv, $bv)) {
				$v = $mv;
			} elseif (in_array($f, $cfg['opaque'], true)) {
				// e.g. RTF: a line merge could break the document
				return ['outcome' => self::CONFLICT];
			} elseif (in_array($f, $cfg['sets'], true) && self::isList($mv) && self::isList($tv)) {
				$v = self::mergeSet(self::isList($bv) ? $bv : [], $mv, $tv);
			} elseif (in_array($f, $cfg['text'], true) && is_string($mv) && is_string($tv)) {
				$v = TextMerge::merge(is_string($bv) ? $bv : '', $mv, $tv);
				if ($v === null) {
					return ['outcome' => self::CONFLICT];
				}
			} else {
				$v = $mineWinsLww ? $mv : $tv;
			}
			if ($v !== $absent) {
				$out->{$f} = $v;
			}
		}

		if (Canonical::equals($out, $mine)) {
			return ['outcome' => self::MINE];
		}
		if (Canonical::equals($out, $theirs)) {
			return ['outcome' => self::THEIRS];
		}
		return ['outcome' => self::MERGED, 'payload' => $out];
	}

	/** Marks a field missing from one version (distinct from JSON null). */
	private static function absent(): object {
		static $a = null;
		return $a ??= new class {
		};
	}

	private static function eq(mixed $a, mixed $b): bool {
		$absent = self::absent();
		if ($a === $absent || $b === $absent) {
			return $a === $b;
		}
		return Canonical::equals($a, $b);
	}

	private static function isList(mixed $v): bool {
		return is_array($v) && array_is_list($v);
	}

	/** (mine ∩ theirs) ∪ (mine − base) ∪ (theirs − base); theirs' order first. */
	private static function mergeSet(array $base, array $mine, array $theirs): array {
		$key = fn ($x) => Canonical::encode($x);
		$bk = array_flip(array_map($key, $base));
		$mk = array_flip(array_map($key, $mine));
		$out = [];
		$seen = [];
		foreach ($theirs as $x) {
			$k = $key($x);
			if ((isset($mk[$k]) || !isset($bk[$k])) && !isset($seen[$k])) {
				$out[] = $x;
				$seen[$k] = true;
			}
		}
		foreach ($mine as $x) {
			$k = $key($x);
			if (!isset($bk[$k]) && !isset($seen[$k])) {
				$out[] = $x;
				$seen[$k] = true;
			}
		}
		return $out;
	}
}
