<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

final class Text {
	/**
	 * SWModule::prepText: every driver passes entries through it. Leading
	 * line breaks go, a single LF becomes a space (CR LF a line break,
	 * further LFs line breaks), trailing spaces and line breaks go.
	 */
	public static function prep(string $s): string {
		$out = '';
		$space = $cr = $real = false;
		$nl = 0;
		$n = strlen($s);
		for ($i = 0; $i < $n; $i++) {
			$c = $s[$i];
			if ($c === "\n") {
				if (!$real) {
					continue;
				}
				$space = !$cr;
				$cr = false;
				if (++$nl > 1) {
					$out .= "\n";
				}
				continue;
			}
			if ($c === "\r") {
				if (!$real) {
					continue;
				}
				$out .= "\n";
				$space = false;
				$cr = true;
				continue;
			}
			$real = true;
			$nl = 0;
			if ($space) {
				$space = false;
				if ($c !== ' ') {
					$out .= ' ';
				}
			}
			$out .= $c;
		}
		$to = strlen($out);
		while ($to > 1 && ($out[$to - 1] === "\n" || $out[$to - 1] === ' ')) {
			$to--;
		}
		return substr($out, 0, $to);
	}

	/** sword copies entries with strncpy/strlen: text ends at the first NUL. */
	public static function cstr(string $s): string {
		$z = strpos($s, "\0");
		return $z === false ? $s : substr($s, 0, $z);
	}
}
