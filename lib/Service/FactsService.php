<?php

declare(strict_types=1);

namespace OCA\Phos\Service;

use OCA\Phos\Service\Sword\SearchIndex;
use OCA\Phos\Service\Sword\SwordException;
use OCA\Phos\Service\Sword\SwordModule;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;

/**
 * Fakten/Facts (Phase 3, Scope 1): a topic -> key passages + dictionary hits, in the same
 * `window.PHOS_FACTS` shape the desktop and Android bundle (BVC web/facts/, see its README and
 * BVC docs/shareable-tool-bundles.md) already render. Topic data comes from data/facts/
 * (openbible.info topic-scores.txt + topic-titles-<lang>.csv), copied verbatim from BVC by
 * dev/sync-facts-assets.js -- never hand-edited here.
 *
 * Deliberately NOT ported yet (unlike the desktop/Android payload): the RAG summary (`prose`,
 * needs a reachable Ollama server), `sermons`/`media` (desktop searches sermon/genbook modules
 * for the topic TERM as free text -- a different mechanism from the chapter-keyed
 * ModuleService::sermons()/media() this app already has for the Bible reading page, and not
 * worth porting until a term-search index exists for non-Bible modules), and the person/place
 * pages (`canonStrip`/`timeline`/`places`/`people` -- those need the PhosPerson/PhosGeo SWORD
 * dictionaries, not just topic-scores.txt). All three show up in `empty` instead of being
 * silently missing.
 */
class FactsService {
	private const MAX_REFS = 20;
	private const PASSAGE_LIMIT = 8;
	private const MAX_ENTRIES = 8;
	private const MAX_CHAPTERS_PER_REF = 3;   // a range spanning more than this is cut off, not fetched whole

	private string $dataDir;

	/** $dataDir: topic-scores.txt + topic-titles-<lang>.csv, default data/facts/ (tests point elsewhere). */
	public function __construct(
		private ModuleService $modules,
		private IAppData $appData,
		?string $dataDir = null,
	) {
		$this->dataDir = $dataDir ?? (__DIR__ . '/../../data/facts');
	}

	/**
	 * Ranked like the dictionary hits in dictionaryEntries(): an exact label match first, then
	 * one that starts with the query, then one that merely contains it -- plain alphabetical
	 * would otherwise bury "Liebe" under "Agape-Liebe", "Andere lieben", … for a search of
	 * "liebe" (there are 70+ topics with "liebe" somewhere in their German label).
	 * @return list<array{key:string,label:string}>
	 */
	public function topics(string $lang, string $q, int $limit = 20): array {
		$titles = $this->titles($lang);
		$qLow = mb_strtolower(trim($q));
		$tiers = [[], [], []];
		foreach (array_keys($this->scores()) as $key) {
			// PHP arrays turn a purely-numeric string key ("2012", "666", "911" are real topics)
			// into an int key; every consumer here is typed `string`.
			$key = (string)$key;
			$label = $titles[$key] ?? $key;
			$labelLow = mb_strtolower($label);
			$tier = match (true) {
				$qLow === '' || $labelLow === $qLow => 0,
				str_starts_with($labelLow, $qLow) => 1,
				str_contains($labelLow, $qLow) || str_contains($key, $qLow) => 2,
				default => null,
			};
			if ($tier !== null) {
				$tiers[$tier][] = ['key' => $key, 'label' => $label];
			}
		}
		foreach ($tiers as &$tier) {
			usort($tier, fn ($a, $b) => strnatcasecmp($a['label'], $b['label']));
		}
		return array_slice(array_merge(...$tiers), 0, max(1, $limit));
	}

	/**
	 * The `window.PHOS_FACTS` payload for one topic. $bible/$collection pick the Bible the key
	 * passages are shown from; null = the reader's first Bible-kind module.
	 * @throws NotFound no such topic
	 */
	public function build(string $uid, string $term, string $lang, ?string $bible, ?string $collection): array {
		$scores = $this->scores();
		$titles = $this->titles($lang);
		$key = self::resolveKey($term, $scores, $titles);
		if ($key === null) {
			throw new NotFound("no topic for \"$term\"");
		}
		$label = $titles[$key] ?? $key;

		$refs = $scores[$key];
		usort($refs, fn ($a, $b) => $b['score'] <=> $a['score']);
		$refs = array_slice($refs, 0, self::MAX_REFS);

		[$bibleMod, $bibleName] = $this->pickBible($uid, $bible, $collection);
		$items = [];
		foreach ($refs as $ref) {
			$text = $bibleMod !== null ? $this->passageText($bibleMod, $ref['osis']) : '';
			$items[] = ['osis' => $ref['osis'], 'display' => $ref['osis'], 'score' => $ref['score'], 'text' => $text];
		}

		$payload = [
			'schema' => 1,
			'lang' => $lang,
			'canPresent' => false,
			'canProject' => false,
			'topic' => ['key' => $key, 'label' => $label],
			'subtitle' => $this->subtitle($lang, $refs),
			'strings' => $this->strings($lang),
			'sections' => [],
		];
		if ($items) {
			$sec = ['id' => 'passages', 'kind' => 'passages', 'caption' => $this->str($lang, 'key', 'Schlüsselstellen', 'Key passages'),
				'count' => count($items), 'limit' => self::PASSAGE_LIMIT, 'items' => $items];
			if ($bibleName !== null) {
				$sec['lede'] = $this->strFmt($lang, 'keyFrom', 'Text aus {0}.', 'Text from {0}.', [$bibleName]);
			}
			$payload['sections'][] = $sec;
		}
		$entries = $this->dictionaryEntries($uid, $label);
		if ($entries) {
			$payload['sections'][] = ['id' => 'entries', 'kind' => 'entries',
				'caption' => $this->str($lang, 'dicts', 'Wörterbücher', 'Dictionaries'),
				'count' => count($entries), 'items' => $entries];
		}
		$payload['empty'] = [
			$this->str($lang, 'summary', 'Zusammenfassung (KI)', 'AI summary'),
			$this->str($lang, 'sermons', 'Predigten', 'Sermons'),
			$this->str($lang, 'media', 'Medien', 'Media'),
		];
		return $payload;
	}

	/**
	 * Plain text (facts.js escapes `items[].text` rather than rendering it as markup, see
	 * BVC web/facts/facts.js's `passages` section renderer -- unlike the entry markup
	 * unit_render.pas turns into HTML on desktop).
	 * @param SwordModule $m a Bible- or commentary-kind module
	 */
	private function passageText(SwordModule $m, string $osis): string {
		[$book, $c1, $v1, $c2, $v2] = self::parseOsis($osis);
		if ($book === null) {
			return '';
		}
		$sourceType = $m->sourceType();
		$parts = [];
		for ($c = $c1; $c <= min($c2, $c1 + self::MAX_CHAPTERS_PER_REF - 1); $c++) {
			try {
				$ch = $m->chapter($book, $c);
			} catch (SwordException) {
				continue;
			}
			$from = $c === $c1 ? $v1 : 1;
			$to = $c === $c2 ? $v2 : PHP_INT_MAX;
			foreach ($ch['verses'] as $v => $text) {
				if ($v >= $from && $v <= $to && $text !== '') {
					[$plain] = SearchIndex::plain($text, $sourceType);
					if ($plain !== '') {
						$parts[] = $plain;
					}
				}
			}
		}
		return trim(implode(' ', $parts));
	}

	/**
	 * "Exod.20.1-Exod.20.26" / "Gal.5.14" / "Gen.1" -> [book, c1, v1, c2, v2]; [null,...] if it
	 * doesn't parse. A bare chapter (no verse) means the whole chapter, 1..last; this app's
	 * SwordModule::chapter() already returns every verse of a chapter, so v2=PHP_INT_MAX there.
	 */
	public static function parseOsis(string $osis): array {
		$sides = explode('-', $osis, 2);
		$start = self::parseOsisRef($sides[0]);
		if ($start === null) {
			return [null, 0, 0, 0, 0];
		}
		[$book, $c1, $v1] = $start;
		if (isset($sides[1])) {
			$end = self::parseOsisRef($sides[1]);
			[$c2, $v2] = $end !== null && $end[0] === $book ? [$end[1], $end[2]] : [$c1, PHP_INT_MAX];
		} else {
			[$c2, $v2] = [$c1, $v1];
		}
		return [$book, $c1, $v1, $c2, $v2];
	}

	/** @return array{0:string,1:int,2:int}|null */
	public static function parseOsisRef(string $ref): ?array {
		$p = explode('.', $ref);
		if (count($p) < 2 || $p[0] === '' || !ctype_digit($p[1])) {
			return null;
		}
		$v = isset($p[2]) && ctype_digit($p[2]) ? (int)$p[2] : PHP_INT_MAX;
		return [$p[0], (int)$p[1], $v];
	}

	/** @return array{0:?SwordModule,1:?string} the module and its description, or both null */
	private function pickBible(string $uid, ?string $name, ?string $collection): array {
		if ($name === null) {
			foreach ($this->modules->list($uid) as $info) {
				if ($info['kind'] === SwordModule::BIBLE) {
					$name = $info['name'];
					break;
				}
			}
		}
		if ($name === null) {
			return [null, null];
		}
		try {
			$m = $this->modules->module($uid, $name, $collection);
			return [$m, $m->info()['description']];
		} catch (SwordException) {
			return [null, null];
		}
	}

	/**
	 * Every installed dictionary whose headword matches $term: an exact hit first, then one that
	 * starts with it (desktop's unit_facts.AddDictionariesTo also ranks a "contains" tier behind
	 * a fold button -- left out here, see the class doc).
	 * @return list<array{module:string,moduleLabel:string,key:string,title:string,snippet:string}>
	 */
	private function dictionaryEntries(string $uid, string $term): array {
		$term = trim($term);
		if ($term === '') {
			return [];
		}
		$upper = mb_strtoupper($term, 'UTF-8');
		$out = [];
		foreach ($this->modules->list($uid) as $info) {
			if ($info['kind'] !== SwordModule::DICTIONARY || count($out) >= self::MAX_ENTRIES) {
				continue;
			}
			$name = $info['name'];
			try {
				$exact = $this->modules->dictEntry($uid, $name, $term);
				if ($exact !== null) {
					$out[] = $this->entry($info, $name, $term, $exact);
					continue;
				}
				foreach ($this->modules->dictKeys($uid, $name, $term, 5) as $k) {
					if (!str_starts_with(mb_strtoupper($k, 'UTF-8'), $upper)) {
						break;
					}
					$text = $this->modules->dictEntry($uid, $name, $k);
					if ($text !== null) {
						$out[] = $this->entry($info, $name, $k, $text);
					}
					if (count($out) >= self::MAX_ENTRIES) {
						break;
					}
				}
			} catch (SwordException) {
				// unreadable module: no hits from it
			}
		}
		return array_slice($out, 0, self::MAX_ENTRIES);
	}

	private function entry(array $info, string $modName, string $key, string $rawText): array {
		[$plain] = SearchIndex::plain($rawText, $info['sourceType'] ?? 'OSIS');
		return [
			'module' => $modName,
			'moduleLabel' => $info['description'] ?: $modName,
			'key' => $key,
			'title' => $key,
			'snippet' => mb_substr(trim($plain), 0, 400),
		];
	}

	private function subtitle(string $lang, array $refs): string {
		$n = count($refs);
		return $n === 1 ? $this->str($lang, 'oneVerse', '1 Vers', '1 verse')
			: $this->strFmt($lang, 'nVerses', '{0} Verse', '{0} verses', [(string)$n]);
	}

	public static function resolveKey(string $term, array $scores, array $titles): ?string {
		$t = mb_strtolower(trim($term));
		if (isset($scores[$t])) {
			return $t;
		}
		foreach ($titles as $key => $label) {
			// see the same cast in topics(): a numeric-looking topic key ("2012", "666", "911")
			// is an int here, not a string.
			if (mb_strtolower((string)$label) === $t) {
				return (string)$key;
			}
		}
		return null;
	}

	/** @return array<string, list<array{osis:string,score:int}>> lower(topic) -> its refs */
	private function scores(): array {
		return $this->cached('scores', $this->dataDir . '/topic-scores.txt', self::parseScoresFile(...));
	}

	/** openbible.info's own format: "Topic<TAB>OSIS<TAB>Score", a header row first. */
	public static function parseScoresFile(string $path): array {
		$out = [];
		$fh = fopen($path, 'r');
		if ($fh === false) {
			return $out;
		}
		$first = true;
		while (($line = fgets($fh)) !== false) {
			if ($first) {
				$first = false;
				continue;   // header row
			}
			$cols = explode("\t", rtrim($line, "\r\n"));
			if (count($cols) < 3 || $cols[0] === '') {
				continue;
			}
			$key = mb_strtolower($cols[0]);
			$score = (int)$cols[2];
			$out[$key][] = ['osis' => $cols[1], 'score' => $score];
		}
		fclose($fh);
		return $out;
	}

	/** @return array<string, string> lower(english key) -> translated label */
	private function titles(string $lang): array {
		$path = $this->dataDir . "/topic-titles-$lang.csv";
		if (!is_file($path)) {
			return [];
		}
		return $this->cached("titles-$lang", $path, self::parseTitlesFile(...));
	}

	/** "english-topic|translated-label" per line, '#' comments, see data/facts/topic-titles-de.csv. */
	public static function parseTitlesFile(string $path): array {
		$out = [];
		foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
			if ($line === '' || $line[0] === '#') {
				continue;
			}
			$p = explode('|', $line, 2);
			if (count($p) === 2 && $p[0] !== '') {
				$out[mb_strtolower($p[0])] = $p[1];
			}
		}
		return $out;
	}

	/**
	 * Parsing topic-scores.txt (70k+ rows) is too slow to redo on every request; the result is
	 * cached in app data by the source file's mtime, so a `dev/sync-facts-assets.js` regen
	 * invalidates it automatically.
	 */
	private function cached(string $id, string $path, callable $build): array {
		$mtime = @filemtime($path) ?: 0;
		$file = $id . '-' . $mtime . '.ser';
		try {
			$dir = $this->appData->getFolder('facts');
		} catch (NotFoundException) {
			$dir = $this->appData->newFolder('facts');
		}
		try {
			$data = unserialize($dir->getFile($file)->getContent(), ['allowed_classes' => false]);
			if (is_array($data)) {
				return $data;
			}
		} catch (\Throwable) {
			// missing or unreadable: rebuild
		}
		$data = $build($path);
		foreach ($dir->getDirectoryListing() as $f) {
			if (str_starts_with($f->getName(), $id . '-') && $f->getName() !== $file) {
				try {
					$f->delete();
				} catch (\Throwable) {
				}
			}
		}
		try {
			$dir->getFile($file)->putContent(serialize($data));
		} catch (NotFoundException) {
			$dir->newFile($file, serialize($data));
		}
		return $data;
	}

	/** The page's `strings` table (see BVC web/facts/README.md) -- only the entries this build uses. */
	private function strings(string $lang): array {
		return [
			'more' => $this->str($lang, 'more', 'weitere zeigen', 'show more'),
			'asTable' => $this->str($lang, 'asTable', 'als Tabelle', 'as a table'),
			'toSlide' => $this->str($lang, 'toSlide', 'auf eine Folie', 'to a slide'),
			'bookmark' => $this->str($lang, 'bookmark', '★ Merken', '★ Bookmark'),
			'fulltext' => $this->str($lang, 'fulltext', 'Volltextsuche', 'Full-text search'),
			'noHits' => $this->str($lang, 'noHits', 'Ohne Treffer', 'No hits'),
			'hits' => $this->str($lang, 'hits', 'Stellen', 'Passages'),
			'close' => $this->str($lang, 'close', 'schließen', 'close'),
			'routeOn' => $this->str($lang, 'routeOn', 'Route einblenden', 'Show route'),
			'routeOff' => $this->str($lang, 'routeOff', 'Route ausblenden', 'Hide route'),
			'inAtlas' => $this->str($lang, 'inAtlas', 'in Akteure & Orte öffnen', 'open in People & Places'),
			'toProject' => $this->str($lang, 'toProject', 'Ins Studienprojekt', 'To a research project'),
			'toProjectPericope' => $this->str($lang, 'toProjectPericope', 'Als Perikope ins Studienprojekt', 'As a pericope to a research project'),
		];
	}

	private function str(string $lang, string $id, string $de, string $en): string {
		return $lang === 'de' ? $de : $en;
	}

	private function strFmt(string $lang, string $id, string $de, string $en, array $args): string {
		$s = $this->str($lang, $id, $de, $en);
		foreach ($args as $i => $a) {
			$s = str_replace('{' . $i . '}', $a, $s);
		}
		return $s;
	}
}
