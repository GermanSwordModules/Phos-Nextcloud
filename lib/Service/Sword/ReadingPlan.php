<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * AndBible reading plans as Phos reads them (unit_readingplan.pas): a
 * module whose conf names a .properties file (AndBibleProvidesReadingPlan)
 * with lines "<day>=[Mon-D;]ref;ref,ref…", optionally a Phos companion JSON
 * (PhosReadingPlanText) {"<day>": [ref or text, …]} interleaving text.
 */
final class ReadingPlan {
	/**
	 * @return array{dateBased:bool,days:list<array{day:int,date:string,passages:list<string>,seq:list<string>}>}
	 */
	public static function parse(string $properties, bool $dateBasedFlag, ?string $companion = null): array {
		$days = [];
		$allDated = true;
		foreach (preg_split('/\r\n|\r|\n/', $properties) ?: [] as $line) {
			$line = trim($line);
			if ($line === '' || $line[0] === '#' || ($eq = strpos($line, '=')) === false) {
				continue;
			}
			$key = trim(substr($line, 0, $eq));
			if (!preg_match('/^\d+$/', $key)) {
				continue;
			}
			$date = '';
			$passages = [];
			foreach (explode(';', substr($line, $eq + 1)) as $j => $tok) {
				$tok = trim($tok);
				if ($tok === '') {
					continue;
				}
				if ($j === 0 && preg_match('/^...-\d+$/', $tok)) {
					$date = $tok;
					continue;
				}
				foreach (explode(',', $tok) as $p) {
					if (($p = trim($p)) !== '') {
						$passages[] = $p;
					}
				}
			}
			$allDated = $allDated && $date !== '';
			$days[] = ['day' => (int)$key, 'date' => $date, 'passages' => $passages, 'seq' => $passages];
		}
		if ($companion !== null) {
			$extra = json_decode($companion, true);
			if (is_array($extra)) {
				foreach ($days as &$d) {
					$seq = $extra[(string)$d['day']] ?? null;
					if (is_array($seq)) {
						$d['seq'] = array_values(array_filter($seq, 'is_string'));
					}
				}
				unset($d);
			}
		}
		return ['dateBased' => $dateBasedFlag || ($allDated && $days !== []), 'days' => $days];
	}
}
