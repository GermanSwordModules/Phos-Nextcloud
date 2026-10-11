<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/**
 * Line-based three-way merge (docs/protocol.md §6).
 *
 * merge() returns the merged text, or null when the two sides changed
 * overlapping regions differently.
 */
final class TextMerge {
	/** Above this many base×side cells the LCS table is not built; any real
	 *  concurrent change then counts as a conflict. */
	private const MAX_CELLS = 4000000;

	public static function merge(string $base, string $mine, string $theirs): ?string {
		if ($mine === $theirs || $theirs === $base) {
			return $mine;
		}
		if ($mine === $base) {
			return $theirs;
		}
		$b = explode("\n", $base);
		$m = explode("\n", $mine);
		$t = explode("\n", $theirs);
		$hm = self::hunks($b, $m);
		$ht = self::hunks($b, $t);
		if ($hm === null || $ht === null) {
			return null;
		}

		// Tag and sort all hunks by base position, then group overlaps.
		$all = [];
		foreach ($hm as $h) {
			$all[] = $h + ['side' => 'm'];
		}
		foreach ($ht as $h) {
			$all[] = $h + ['side' => 't'];
		}
		usort($all, fn ($x, $y) => [$x['s'], $x['e']] <=> [$y['s'], $y['e']]);

		$out = [];
		$pos = 0;
		$i = 0;
		$n = count($all);
		while ($i < $n) {
			$group = [$all[$i]];
			$gs = $all[$i]['s'];
			$ge = $all[$i]['e'];
			$j = $i + 1;
			while ($j < $n && $all[$j]['s'] <= $ge) {
				$group[] = $all[$j];
				$ge = max($ge, $all[$j]['e']);
				$j++;
			}
			// Copy unchanged base lines before the group.
			for ($k = $pos; $k < $gs; $k++) {
				$out[] = $b[$k];
			}
			$sides = array_unique(array_column($group, 'side'));
			if (count($sides) === 1) {
				$out = array_merge($out, self::render($b, $group, $gs, $ge));
			} else {
				$gm = self::render($b, array_values(array_filter($group, fn ($h) => $h['side'] === 'm')), $gs, $ge);
				$gt = self::render($b, array_values(array_filter($group, fn ($h) => $h['side'] === 't')), $gs, $ge);
				if ($gm !== $gt) {
					return null;
				}
				$out = array_merge($out, $gm);
			}
			$pos = $ge;
			$i = $j;
		}
		for ($k = $pos; $k < count($b); $k++) {
			$out[] = $b[$k];
		}
		return implode("\n", $out);
	}

	/**
	 * Base range [gs, ge) with one side's hunks (sorted, non-overlapping
	 * among themselves) applied.
	 *
	 * @param list<string> $b
	 * @param list<array{s:int,e:int,lines:list<string>}> $hunks
	 * @return list<string>
	 */
	private static function render(array $b, array $hunks, int $gs, int $ge): array {
		$out = [];
		$pos = $gs;
		foreach ($hunks as $h) {
			for ($k = $pos; $k < $h['s']; $k++) {
				$out[] = $b[$k];
			}
			$out = array_merge($out, $h['lines']);
			$pos = $h['e'];
		}
		for ($k = $pos; $k < $ge; $k++) {
			$out[] = $b[$k];
		}
		return $out;
	}

	/**
	 * Hunks turning $a into $b: base range [s, e) replaced by lines.
	 *
	 * @param list<string> $a
	 * @param list<string> $b
	 * @return list<array{s:int,e:int,lines:list<string>}>|null
	 */
	public static function hunks(array $a, array $b): ?array {
		$na = count($a);
		$nb = count($b);
		// Trim common prefix and suffix; only the middle needs an LCS table.
		$pre = 0;
		while ($pre < $na && $pre < $nb && $a[$pre] === $b[$pre]) {
			$pre++;
		}
		$suf = 0;
		while ($suf < $na - $pre && $suf < $nb - $pre && $a[$na - 1 - $suf] === $b[$nb - 1 - $suf]) {
			$suf++;
		}
		$ma = array_slice($a, $pre, $na - $pre - $suf);
		$mb = array_slice($b, $pre, $nb - $pre - $suf);
		$la = count($ma);
		$lb = count($mb);
		if ($la === 0 && $lb === 0) {
			return [];
		}
		if ($la === 0 || $lb === 0) {
			return [['s' => $pre, 'e' => $pre + $la, 'lines' => $mb]];
		}
		if ($la * $lb > self::MAX_CELLS) {
			return null;
		}

		// LCS lengths of suffixes: L[i][j] = LCS(ma[i..], mb[j..]).
		$L = array_fill(0, $la + 1, array_fill(0, $lb + 1, 0));
		for ($i = $la - 1; $i >= 0; $i--) {
			for ($j = $lb - 1; $j >= 0; $j--) {
				$L[$i][$j] = $ma[$i] === $mb[$j]
					? $L[$i + 1][$j + 1] + 1
					: max($L[$i + 1][$j], $L[$i][$j + 1]);
			}
		}

		$hunks = [];
		$i = 0;
		$j = 0;
		$hs = -1;
		$lines = [];
		$flush = function (int $endA) use (&$hunks, &$hs, &$lines, $pre) {
			if ($hs >= 0) {
				$hunks[] = ['s' => $pre + $hs, 'e' => $pre + $endA, 'lines' => $lines];
			}
			$hs = -1;
			$lines = [];
		};
		while ($i < $la || $j < $lb) {
			if ($i < $la && $j < $lb && $ma[$i] === $mb[$j]) {
				$flush($i);
				$i++;
				$j++;
			} elseif ($j < $lb && ($i >= $la || $L[$i][$j + 1] >= $L[$i + 1][$j])) {
				if ($hs < 0) {
					$hs = $i;
				}
				$lines[] = $mb[$j];
				$j++;
			} else {
				if ($hs < 0) {
					$hs = $i;
				}
				$i++;
			}
		}
		$flush($i);
		return $hunks;
	}
}
