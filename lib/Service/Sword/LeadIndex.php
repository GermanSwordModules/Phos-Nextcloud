<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * The opening of every entry of a book (path + first characters of its
 * text), built once per module revision: enough to find the entries that
 * treat a passage — a sermon states its text in its title or at the top
 * (the desktop's Bible reading page does the same with a phrase search).
 */
final class LeadIndex {
	public const FORMAT = 2;
	private const LEAD = 400;

	/** @param list<array{0:string,1:string,2:string}> $entries path, lead, first picture */
	private function __construct(private array $entries) {
	}

	public static function fromString(string $data): ?self {
		$raw = @gzuncompress($data);
		$d = $raw === false ? false : @unserialize($raw, ['allowed_classes' => false]);
		return is_array($d) && ($d['format'] ?? 0) === self::FORMAT ? new self($d['entries']) : null;
	}

	public static function build(SwordModule $m): string {
		$entries = [];
		$m->eachEntry(function (string $path, string $markup) use (&$entries, $m) {
			[$text] = SearchIndex::plain($markup, $m->sourceType());
			$entries[] = [$path, mb_substr($text, 0, self::LEAD), self::picture($markup)];
		});
		return gzcompress(serialize(['format' => self::FORMAT, 'entries' => $entries]), 6);
	}

	/**
	 * The first picture an entry shows, as its markup names it: a figure or
	 * img src, else an online URL of a picture (bundled under images/ —
	 * the web resolves both like the desktop, phos.js pictureUrl).
	 */
	public static function picture(string $markup): string {
		if (preg_match('/<(?:figure|img)\b[^>]*\bsrc\s*=\s*["\']([^"\']+)["\']/i', $markup, $m)) {
			return $m[1];
		}
		if (preg_match('#https?://[^\s"\'<>)]+\.(?:jpe?g|png|gif|webp)\b#i', $markup, $m)) {
			return $m[0];
		}
		return '';
	}

	/**
	 * Entries citing a chapter in their path or lead.
	 * @param list<string> $names how the book is written ("1. Mose", "Römer", "Rom")
	 * @return list<array{path:string,ref:string,lead:string,picture:string}>
	 */
	public function citing(array $names, int $chapter, int $limit, bool $withPicture = false): array {
		$re = self::refPattern($names, $chapter);
		if ($re === null) {
			return [];
		}
		$out = [];
		foreach ($this->entries as [$path, $lead, $picture]) {
			if ($withPicture && $picture === '') {
				continue;
			}
			$leaf = substr($path, (int)strrpos($path, '/') + 1);
			if (preg_match($re, $leaf, $m) || preg_match($re, $lead, $m)) {
				$out[] = ['path' => $path, 'ref' => trim($m[0], " ,:"), 'lead' => $lead, 'picture' => $picture];
				if (count($out) >= $limit) {
					break;
				}
			}
		}
		return $out;
	}

	/** "Römer 7", "Röm. 7,22", "1.Mose 1" — not "Römer 70" */
	public static function refPattern(array $names, int $chapter): ?string {
		$alts = [];
		foreach ($names as $n) {
			$n = trim($n);
			if (mb_strlen(preg_replace('/[\s.]/u', '', $n) ?? '') < 3) {
				continue;   // "Rö", "1M": too many accidental hits
			}
			$parts = preg_split('/[\s.]+/u', $n, -1, PREG_SPLIT_NO_EMPTY) ?: [];
			$alts[] = implode('\.?\s*', array_map(fn ($x) => preg_quote($x, '/'), $parts));
		}
		if (!$alts || $chapter < 1) {
			return null;
		}
		usort($alts, fn ($a, $b) => strlen($b) <=> strlen($a));
		return '/(?<![\p{L}\d])(?:' . implode('|', $alts) . ')\.?\s*' . $chapter . '(?!\d)(?:\s*[,:]\s*\d+(?:\s*[-–]\s*\d+)?)?/iu';
	}
}
