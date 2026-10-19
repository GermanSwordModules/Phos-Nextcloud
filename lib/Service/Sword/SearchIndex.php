<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * Full-text index of a verse-keyed module (Bible or commentary), built once
 * per module revision (W-4). Words are folded like the web's highlighter
 * does (lower case, ß = ss, no diacritics — Greek accents and Hebrew points go),
 * Strong's numbers come from the markup (OSIS lemma, ThML sync, GBF <WG…>).
 *
 * Query: words (all must occur; mode "any": one is enough), "a phrase",
 * prefix*, -excluded, G26 / H430 for a Strong's number.
 */
final class SearchIndex {
	public const FORMAT = 1;

	/** @var list<int> verse ids: book << 16 | chapter << 8 | verse */
	private array $ids;
	/** @var list<string> per verse: its folded words, space separated */
	private array $norm;
	/** @var array<string, string> word → packed verse positions (V*) */
	private array $words;
	/** @var array<string, string> G26 → packed verse positions */
	private array $strongs;

	private function __construct(array $d) {
		$this->ids = array_values(unpack('V*', $d['ids']) ?: []);
		$this->norm = $d['norm'];
		$this->words = $d['words'];
		$this->strongs = $d['strongs'];
	}

	public static function fromString(string $data): ?self {
		$raw = @gzuncompress($data);
		$d = $raw === false ? false : @unserialize($raw, ['allowed_classes' => false]);
		return is_array($d) && ($d['format'] ?? 0) === self::FORMAT ? new self($d) : null;
	}

	/** Builds the index of a module; the result is what fromString() reads. */
	public static function build(SwordModule $m): string {
		$st = $m->sourceType();
		$ids = [];
		$norm = [];
		$words = [];
		$strongs = [];
		$m->eachVerse(function (int $book, int $chapter, int $verse, string $markup) use ($st, &$ids, &$norm, &$words, &$strongs) {
			[$text, $lemmas] = self::plain($markup, $st);
			$toks = self::tokens($text);
			if (!$toks && !$lemmas) {
				return;
			}
			$pos = count($ids);
			$ids[] = $book << 16 | $chapter << 8 | $verse;
			$norm[] = implode(' ', $toks);
			foreach (array_unique($toks) as $t) {
				$words[$t][] = $pos;
			}
			foreach (array_unique($lemmas) as $s) {
				$strongs[$s][] = $pos;
			}
		});
		$pack = fn (array $l) => pack('V*', ...$l);
		return gzcompress(serialize([
			'format' => self::FORMAT,
			'ids' => $pack($ids),
			'norm' => $norm,
			'words' => array_map($pack, $words),
			'strongs' => array_map($pack, $strongs),
		]), 6);
	}

	/**
	 * Verse text without notes and markup, and its Strong's numbers.
	 * @return array{0:string,1:list<string>}
	 */
	public static function plain(string $s, string $sourceType = 'OSIS'): array {
		$lemmas = [];
		if (preg_match_all('/lemma="([^"]*)"/', $s, $mm)) {
			foreach ($mm[1] as $l) {
				foreach (preg_split('/\s+/', $l) as $part) {
					if (preg_match('/^strong:([GH])0*(\d+)/i', $part, $x)) {
						$lemmas[] = strtoupper($x[1]) . $x[2];
					}
				}
			}
		}
		if (preg_match_all('/<sync[^>]*type="Strongs"[^>]*value="([GH]?)0*(\d+)/i', $s, $mm, PREG_SET_ORDER)) {
			foreach ($mm as $x) {
				$lemmas[] = strtoupper($x[1] ?: 'G') . $x[2];
			}
		}
		if (strcasecmp($sourceType, 'GBF') === 0 && preg_match_all('/<W([GH])0*(\d+)[^>]*>/', $s, $mm, PREG_SET_ORDER)) {
			foreach ($mm as $x) {
				$lemmas[] = $x[1] . $x[2];
			}
		}
		// notes and non-canonical headings are not verse text
		$s = preg_replace('#<note\b[^>]*/>|<note\b.*?</note>#s', ' ', $s) ?? $s;
		$s = preg_replace('#<RF>.*?<Rf>#s', ' ', $s) ?? $s;
		$s = preg_replace('#<title\b(?![^>]*canonical="true")[^>]*>.*?</title>#s', ' ', $s) ?? $s;
		$s = preg_replace('#<(?:/?(?:br|lb|p|l|lg|div|chapter|verse)\b)[^>]*>#i', ' ', $s) ?? $s;
		$s = preg_replace('#<[^>]*>#', '', $s) ?? $s;
		$s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
		$s = trim(preg_replace('/\s+/u', ' ', $s) ?? $s);
		return [$s, array_values(array_unique($lemmas))];
	}

	/** Folded words of a text (same rule as the web's highlighter). @return list<string> */
	public static function tokens(string $s): array {
		$s = str_replace('ß', 'ss', mb_strtolower($s, 'UTF-8'));   // Swiss spelling finds it too
		if (class_exists(\Normalizer::class)) {
			$d = \Normalizer::normalize($s, \Normalizer::FORM_D);
			if (is_string($d)) {
				$s = preg_replace('/\p{Mn}+/u', '', $d) ?? $s;
			}
		}
		preg_match_all('/[\p{L}\p{N}]+/u', $s, $m);
		return $m[0];
	}

	/**
	 * @param list<int>|null $books book indexes to search (null = all)
	 * @return array{terms:list<string>,strongs:list<string>,positions:list<int>,error?:string}
	 */
	public function find(string $query, string $mode = 'all', ?array $books = null): array {
		$q = self::parse($query);
		if ($q['error'] !== null) {
			return ['terms' => [], 'strongs' => [], 'positions' => [], 'error' => $q['error']];
		}
		$sets = [];
		foreach ($q['phrases'] as $p) {
			$sets[] = $this->phrase($p);
		}
		foreach ($q['words'] as $w) {
			$sets[] = $this->word($w);
		}
		foreach ($q['strongs'] as $s) {
			$sets[] = $this->unpack($this->strongs[$s] ?? '');
		}
		if (!$sets) {
			$hits = [];
		} elseif ($mode === 'any') {
			$hits = array_keys(array_flip(array_merge(...$sets)));
			sort($hits);
		} else {
			usort($sets, fn ($a, $b) => count($a) <=> count($b));
			$hits = array_shift($sets);
			foreach ($sets as $s) {
				$hits = array_values(array_intersect($hits, $s));
			}
		}
		foreach ($q['not'] as $w) {
			$hits = array_values(array_diff($hits, $this->word($w)));
		}
		if ($books !== null) {
			$want = array_flip($books);
			$hits = array_values(array_filter($hits, fn ($p) => isset($want[$this->ids[$p] >> 16])));
		}
		$terms = $q['words'];
		foreach ($q['phrases'] as $p) {
			array_push($terms, ...$p);
		}
		return ['terms' => array_values(array_unique($terms)), 'strongs' => $q['strongs'], 'positions' => $hits];
	}

	/** @return array{0:int,1:int,2:int} book index, chapter, verse */
	public function verseAt(int $pos): array {
		$id = $this->ids[$pos];
		return [$id >> 16, ($id >> 8) & 0xff, $id & 0xff];
	}

	/** @return list<int> */
	private function unpack(string $packed): array {
		return $packed === '' ? [] : array_values(unpack('V*', $packed) ?: []);
	}

	/** "glaub*" matches every word starting so, otherwise the word itself */
	private function word(string $w): array {
		if (!str_ends_with($w, '*')) {
			return $this->unpack($this->words[$w] ?? '');
		}
		$pre = substr($w, 0, -1);
		$all = [];
		foreach ($this->words as $t => $packed) {
			if (str_starts_with((string)$t, $pre)) {
				$all[] = $this->unpack($packed);
			}
		}
		$out = $all ? array_keys(array_flip(array_merge(...$all))) : [];
		sort($out);
		return $out;
	}

	/** @param list<string> $p */
	private function phrase(array $p): array {
		$cand = null;
		foreach ($p as $w) {
			$s = $this->word($w);
			$cand = $cand === null ? $s : array_values(array_intersect($cand, $s));
		}
		$cand ??= [];
		if (count($p) < 2) {
			return $cand;
		}
		$re = '/(?:^| )' . implode(' ', array_map(
			fn ($w) => str_ends_with($w, '*') ? preg_quote(substr($w, 0, -1), '/') . '\S*' : preg_quote($w, '/'),
			$p)) . '(?: |$)/u';
		return array_values(array_filter($cand, fn ($i) => preg_match($re, $this->norm[$i]) === 1));
	}

	/** One typed word as index words; a trailing * stays on the last one (prefix). @return list<string> */
	private static function terms(string $piece): array {
		$t = self::tokens($piece);
		if ($t && str_ends_with($piece, '*')) {
			$t[count($t) - 1] .= '*';
		}
		return $t;
	}

	/**
	 * @return array{words:list<string>,phrases:list<list<string>>,strongs:list<string>,not:list<string>,error:?string}
	 */
	public static function parse(string $query): array {
		$out = ['words' => [], 'phrases' => [], 'strongs' => [], 'not' => [], 'error' => null];
		preg_match_all('/(-?)"([^"]*)"?|(\S+)/u', $query, $mm, PREG_SET_ORDER);
		foreach ($mm as $m) {
			if (($m[3] ?? '') === '') {
				$p = [];
				foreach (preg_split('/\s+/u', trim($m[2])) ?: [] as $piece) {
					array_push($p, ...self::terms($piece));
				}
				if (count($p) === 1) {
					$out[$m[1] === '-' ? 'not' : 'words'][] = $p[0];
				} elseif ($p && $m[1] !== '-') {
					$out['phrases'][] = $p;
				}
				continue;
			}
			$t = $m[3];
			$neg = $t[0] === '-' && strlen($t) > 1;
			if ($neg) {
				$t = substr($t, 1);
			}
			if (preg_match('/^(?:strong:)?([GHgh])0*(\d+)[a-zA-Z]?$/', $t, $x)) {
				if (!$neg) {
					$out['strongs'][] = strtoupper($x[1]) . $x[2];
				}
				continue;
			}
			foreach (self::terms($t) as $w) {
				$out[$neg ? 'not' : 'words'][] = $w;
			}
		}
		foreach ($out['words'] as $w) {
			if (str_ends_with($w, '*') && mb_strlen($w) < 3) {
				$out['error'] = 'prefix too short';
			}
		}
		if (!$out['words'] && !$out['phrases'] && !$out['strongs']) {
			$out['error'] = 'empty query';
		}
		$out['words'] = array_values(array_unique($out['words']));
		$out['strongs'] = array_values(array_unique($out['strongs']));
		return $out;
	}
}
