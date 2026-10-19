<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/** One SWORD module read straight from its files (no libsword). */
final class SwordModule {
	public const BIBLE = 'bible';
	public const COMMENTARY = 'commentary';
	public const DICTIONARY = 'dictionary';
	public const GENBOOK = 'genbook';
	public const OTHER = 'other';

	public readonly string $kind;
	private ?VerseStore $verses = null;
	private ?LexStore $lex = null;
	private ?GenBookStore $tree = null;

	public function __construct(
		public readonly Conf $conf,
		private ModuleFiles $fs,
		private ?string $cipherKey = null,
		/** manifest flag: the module is ciphered (the conf reaches the server without CipherKey) */
		private bool $cipherFlag = false,
	) {
		$this->kind = self::kindOf($conf->get('ModDrv'));
	}

	public static function kindOf(string $driver): string {
		return match (strtolower($driver)) {
			'ztext', 'ztext4', 'rawtext', 'rawtext4' => self::BIBLE,
			'zcom', 'zcom4', 'rawcom', 'rawcom4' => self::COMMENTARY,
			'zld', 'rawld', 'rawld4' => self::DICTIONARY,
			'rawgenbook' => self::GENBOOK,
			default => self::OTHER,
		};
	}

	public function name(): string {
		return $this->conf->name;
	}

	public function versification(): Versification {
		return Versification::get($this->conf->get('Versification', 'KJV'));
	}

	/** Ciphered module without a key: nothing can be read. */
	public function locked(): bool {
		return $this->ciphered() && $this->key() === null;
	}

	public function ciphered(): bool {
		return $this->cipherFlag || $this->conf->get('CipherKey') !== '';
	}

	private function key(): ?string {
		$k = $this->cipherKey ?? $this->conf->get('CipherKey');
		return $k === '' ? null : $k;
	}

	private function verseStore(): VerseStore {
		if ($this->kind !== self::BIBLE && $this->kind !== self::COMMENTARY) {
			throw new SwordException('not a verse-keyed module');
		}
		if ($this->locked()) {
			throw new SwordException('module is locked');
		}
		return $this->verses ??= new VerseStore($this->fs, $this->conf->get('ModDrv'), $this->conf->dataPath(),
			$this->conf->get('CompressType', 'ZIP'), $this->key());
	}

	private function lexStore(): LexStore {
		if ($this->kind !== self::DICTIONARY) {
			throw new SwordException('not a dictionary');
		}
		if ($this->locked()) {
			throw new SwordException('module is locked');
		}
		return $this->lex ??= new LexStore($this->fs, $this->conf->get('ModDrv'), $this->conf->dataPath(),
			$this->conf->get('CompressType', 'ZIP'), $this->key(),
			strcasecmp($this->conf->get('CaseSensitiveKeys'), 'true') === 0,
			strcasecmp($this->conf->get('StrongsPadding'), 'false') !== 0);
	}

	private function genBook(): GenBookStore {
		if ($this->kind !== self::GENBOOK) {
			throw new SwordException('not a book');
		}
		if ($this->locked()) {
			throw new SwordException('module is locked');
		}
		return $this->tree ??= new GenBookStore($this->fs, rtrim($this->conf->dataPath(), '/'), $this->key(),
			fn (string $s) => $this->utf8($s));
	}

	/**
	 * Table of contents one level deep: the children of $path.
	 * @return array{path:string,children:list<array{name:string,path:string,children:bool}>}
	 */
	public function toc(string $path): array {
		$t = $this->genBook();
		$id = $t->find($path) ?? throw new SwordException("no such entry: $path");
		$base = $id === 0 ? '' : $t->pathOf($id);
		$out = [];
		foreach ($t->children($id) as $c) {
			$n = $t->node($c);
			$out[] = ['name' => $n['name'], 'path' => $base . '/' . $n['name'], 'children' => $n['child'] >= 0];
		}
		return ['path' => $base === '' ? '/' : $base, 'children' => $out];
	}

	/**
	 * Every entry of a book in reading order: fn(path, markup). Stops after
	 * $max entries (damaged trees can loop).
	 */
	public function eachEntry(callable $fn, int $max = 200000): void {
		$t = $this->genBook();
		for ($id = $t->nextOf(0), $n = 0; $id > 0 && $n < $max; $id = $t->nextOf($id), $n++) {
			$fn($t->pathOf($id), $this->utf8(Text::prep($t->text($id))));
		}
	}

	/**
	 * One entry of a book with its neighbours in reading order. The root
	 * ("/") stands for the first entry.
	 * @return array{path:string,name:string,text:string,prev:?string,next:?string,trail:list<string>,children:bool}
	 */
	public function bookEntry(string $path): array {
		$t = $this->genBook();
		$id = $t->find($path) ?? throw new SwordException("no such entry: $path");
		if ($id === 0) {
			$id = $t->nextOf(0);
			if ($id < 0) {
				throw new SwordException('the book is empty');
			}
		}
		$prev = $t->prevOf($id);
		$next = $t->nextOf($id);
		$trail = [];
		for ($p = $t->node($id)['parent'], $guard = 0; $p > 0 && $guard < 200; $p = $t->node($p)['parent'], $guard++) {
			array_unshift($trail, $t->pathOf($p));
		}
		return [
			'path' => $t->pathOf($id),
			'name' => $t->node($id)['name'],
			'text' => $this->utf8(Text::prep($t->text($id))),
			'prev' => $prev > 0 ? $t->pathOf($prev) : null,
			'next' => $next > 0 ? $t->pathOf($next) : null,
			'trail' => $trail,
			'children' => $t->node($id)['child'] >= 0,
		];
	}

	/**
	 * A file of the module (pictures of books and maps), by the path its
	 * text uses: relative to the module's data folder. Null = not there.
	 */
	public function resolveFile(string $path): ?string {
		$dir = $this->conf->dataPath();
		$dir = str_ends_with($dir, '/') ? $dir : substr($dir, 0, (int)strrpos($dir, '/') + 1);
		$rel = ltrim(str_replace('\\', '/', $path), '/');
		if ($rel === '' || preg_match('#(^|/)\.\.(/|$)#', $rel)) {
			return null;
		}
		return $this->fs->exists($dir . $rel) ? $dir . $rel : null;
	}

	private function utf8(string $s): string {
		if ($this->conf->isUtf8()) {
			return mb_check_encoding($s, 'UTF-8') ? $s : mb_scrub($s, 'UTF-8');
		}
		return mb_convert_encoding($s, 'UTF-8', 'ISO-8859-1');
	}

	/** Books the module has text for (by testament files present). @return list<int> */
	public function books(): array {
		$vs = $this->verseStore();
		$out = [];
		foreach ($this->versification()->books as $i => $b) {
			if ($vs->hasTestament($b['t'])) {
				$out[] = $i;
			}
		}
		return $out;
	}

	/**
	 * Markup of one chapter. links: verse → first verse of the same entry
	 * (commentaries often store one entry for a range; its text is in
	 * verses[first] and repeated for the linked verses).
	 * @return array{book:string,chapter:int,intro:string,bookIntro:string,verses:array<int,string>,links:array<int,int>}
	 */
	public function chapter(string $osis, int $chapter): array {
		$v11n = $this->versification();
		$b = $v11n->bookIndex($osis);
		if ($b === null || $chapter < 1 || $chapter > $v11n->chapterCount($b)) {
			throw new SwordException("no such chapter: $osis $chapter");
		}
		$vs = $this->verseStore();
		$read = function (int $c, int $v) use ($v11n, $vs, $b): string {
			$loc = $v11n->locate($b, $c, $v);
			return $loc === null ? '' : $this->utf8(Text::prep($vs->entry($loc[0], $loc[1])));
		};
		$verses = [];
		$links = [];
		$prevRef = '';
		$first = 0;
		for ($v = 1, $n = $v11n->verseCount($b, $chapter); $v <= $n; $v++) {
			[$t, $i] = $v11n->locate($b, $chapter, $v);
			$ref = $vs->ref($t, $i);
			if ($ref !== '' && $ref === $prevRef && $v > 1) {
				$links[$v] = $first;
				$verses[$v] = $verses[$first];
				continue;
			}
			$prevRef = $ref;
			$first = $v;
			$verses[$v] = $this->utf8(Text::prep($vs->entry($t, $i)));
		}
		return [
			'book' => $osis,
			'chapter' => $chapter,
			'bookIntro' => $chapter === 1 ? $read(0, 0) : '',
			'intro' => $read($chapter, 0),
			'verses' => $verses,
			'links' => $links,
		];
	}

	public function sourceType(): string {
		return $this->conf->get('SourceType', 'Plain') ?: 'Plain';
	}

	/**
	 * Every verse with text, in canonical order: fn(bookIndex, chapter,
	 * verse, markup). An entry that stands for several verses (commentaries)
	 * is passed once, for its first verse.
	 */
	public function eachVerse(callable $fn): void {
		$v11n = $this->versification();
		$vs = $this->verseStore();
		foreach ($this->books() as $b) {
			$prevRef = '';
			foreach ($v11n->books[$b]['v'] as $ci => $n) {
				for ($v = 1; $v <= $n; $v++) {
					[$t, $i] = $v11n->locate($b, $ci + 1, $v);
					$ref = $vs->ref($t, $i);
					if ($ref === '' || $ref === $prevRef) {
						continue;
					}
					$prevRef = $ref;
					$text = $this->utf8(Text::prep($vs->entry($t, $i)));
					if ($text !== '') {
						$fn($b, $ci + 1, $v, $text);
					}
				}
			}
		}
	}

	/** Markup of one verse ('' when empty). */
	public function verse(int $book, int $chapter, int $verse): string {
		$loc = $this->versification()->locate($book, $chapter, $verse);
		return $loc === null ? '' : $this->utf8(Text::prep($this->verseStore()->entry($loc[0], $loc[1])));
	}

	/**
	 * One chapter of another versification, filled from this module: each
	 * verse holds the text sword maps it to here (a parallel text next to a
	 * Bible of another system). refs: verse → where the text comes from,
	 * when that is not the same verse; links: verse → the verse that
	 * already shows the same text.
	 * @return array{book:string,chapter:int,intro:string,bookIntro:string,verses:array<int,string>,links:array<int,int>,refs:array<int,string>}
	 */
	public function chapterAs(string $osis, int $chapter, string $system): array {
		$own = $this->versification();
		$src = Versification::get($system);
		if ($src === $own) {
			return $this->chapter($osis, $chapter) + ['refs' => []];
		}
		$b = $src->bookIndex($osis);
		if ($b === null || $chapter < 1 || $chapter > $src->chapterCount($b)) {
			throw new SwordException("no such chapter: $osis $chapter");
		}
		$vs = $this->verseStore();
		$read = function (string $book, int $c, int $v) use ($own, $vs): string {
			$bi = $own->bookIndex($book);
			$loc = $bi === null ? null : $own->locate($bi, $c, $v);
			return $loc === null ? '' : $this->utf8(Text::prep($vs->entry($loc[0], $loc[1])));
		};
		$verses = [];
		$links = [];
		$refs = [];
		$seen = [];
		$used = [];
		$introOf = null;
		for ($v = 1, $n = $src->verseCount($b, $chapter); $v <= $n; $v++) {
			$m = $src->mapTo($own, $osis, $chapter, $v);
			if ($m === null || $m[4]) {
				continue;   // not in this module's versification
			}
			[$ob, $oc, $ov, $oe] = $m;
			$introOf ??= [$ob, $oc];
			$end = min($oe, $own->verseCount((int)$own->bookIndex($ob), $oc));
			$at = "$ob.$oc.$ov";
			if (isset($seen[$at])) {
				$links[$v] = $seen[$at];
				$verses[$v] = $verses[$seen[$at]];
				continue;
			}
			$seen[$at] = $v;
			$parts = [];
			for ($x = $ov; $x <= max($ov, $end); $x++) {
				$parts[] = $read($ob, $oc, $x);
			}
			for ($x = $ov; $x <= max($ov, $end); $x++) {
				$used["$ob.$oc.$x"] = true;
			}
			$verses[$v] = trim(implode(' ', $parts));
			if ($ob !== $osis || $oc !== $chapter || $ov !== $v || $end > $ov) {
				$refs[$v] = "$ob.$oc.$ov" . ($end > $ov ? "-$end" : '');
			}
		}
		// Some modules declare a versification their text does not follow
		// (GerElb1905: "NRSV", Rev 12,18 empty and its words in 13,1). Where
		// the mapped verse is empty, the same number is taken — unless that
		// verse is shown elsewhere already.
		$ownB = $own->bookIndex($osis);
		for ($v = 1, $n = $src->verseCount($b, $chapter); $ownB !== null && $v <= $n; $v++) {
			if (($verses[$v] ?? '') !== '' || isset($links[$v]) || isset($used["$osis.$chapter.$v"])) {
				continue;
			}
			$text = $read($osis, $chapter, $v);
			if ($text !== '') {
				$verses[$v] = $text;
				unset($refs[$v]);
				$used["$osis.$chapter.$v"] = true;
			}
		}
		[$ib, $ic] = $introOf ?? [$osis, $chapter];
		return [
			'book' => $osis,
			'chapter' => $chapter,
			'bookIntro' => $chapter === 1 ? $read($ib, 0, 0) : '',
			// a chapter title that sword maps onto verse 1 is shown there already
			'intro' => isset($seen["$ib.$ic.0"]) ? '' : $read($ib, $ic, 0),
			'verses' => $verses,
			'links' => $links,
			'refs' => $refs,
		];
	}

	/** Strong's lexicons key either "G0026" or "00026": a prefixed number falls back to the bare one. */
	public function dictEntry(string $key): ?string {
		$t = $this->lexStore()->find($key);
		if ($t === null && preg_match('/^[GHgh](\d+[a-zA-Z]?)$/', $key, $m)) {
			$t = $this->lexStore()->find($m[1]);
		}
		return $t === null ? null : $this->utf8(Text::prep($t));
	}

	/**
	 * Up to $n keys starting at the first key >= $from; with $before the
	 * (up to) $n keys right before it instead.
	 * @return list<string>
	 */
	public function dictKeys(string $from, int $n, bool $before = false): array {
		$lex = $this->lexStore();
		// as in dictEntry: "G26" lists from "00026" where the lexicon keys bare numbers
		if (preg_match('/^[GHgh](\d+[a-zA-Z]?)$/', $from, $m) && $lex->find($from) === null && $lex->find($m[1]) !== null) {
			$from = $m[1];
		}
		$out = [];
		$i = $lex->seek($from);
		$end = $before ? $i : $lex->count();
		if ($before) {
			$i = max(0, $i - $n);
		}
		for (; $i < $end && count($out) < $n; $i++) {
			$k = $lex->keyAt($i);
			if ($k !== '') {
				$out[] = $this->utf8($k);
			}
		}
		return $out;
	}

	/** The module's AndBible reading plan, or null. */
	public function readingPlan(): ?array {
		$c = $this->conf;
		$file = $c->get('AndBibleProvidesReadingPlan');
		if ($file === '' || str_contains($file, '/')) {
			return null;
		}
		$dir = $c->dataPath();
		$dir = str_ends_with($dir, '/') ? $dir : substr($dir, 0, (int)strrpos($dir, '/') + 1);
		$props = $this->fs->read($dir . $file, 0, $this->fs->size($dir . $file));
		if ($props === '') {
			throw new SwordException('reading plan file is not on the server');
		}
		$comp = $c->get('PhosReadingPlanText');
		$compText = $comp !== '' && !str_contains($comp, '/') ? $this->fs->read($dir . $comp, 0, $this->fs->size($dir . $comp)) : '';
		return ReadingPlan::parse($this->utf8($props),
			strcasecmp(trim($c->get('AndBibleReadingPlanDateBased')), 'true') === 0,
			$compText !== '' ? $this->utf8($compText) : null);
	}

	/** Summary for module lists. */
	public function info(): array {
		$c = $this->conf;
		return [
			'name' => $c->name,
			'description' => $this->utf8($c->get('Description', $c->name)),
			'kind' => $this->kind,
			'lang' => $c->get('Lang', 'en'),
			'direction' => $c->get('Direction', 'LtoR'),
			'versification' => $this->kind === self::BIBLE || $this->kind === self::COMMENTARY ? $this->versification()->name : null,
			'sourceType' => $c->get('SourceType', 'Plain'),
			'features' => $c->all('Feature'),
			'options' => $c->all('GlobalOptionFilter'),
			'ciphered' => $this->ciphered(),
			'locked' => $this->locked(),
			'readingPlan' => $c->get('AndBibleProvidesReadingPlan') !== '',
			'category' => $c->get('Category'),
		];
	}
}
