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

	/** Strong's lexicons key either "G0026" or "00026": a prefixed number falls back to the bare one. */
	public function dictEntry(string $key): ?string {
		$t = $this->lexStore()->find($key);
		if ($t === null && preg_match('/^[GHgh](\d+[a-zA-Z]?)$/', $key, $m)) {
			$t = $this->lexStore()->find($m[1]);
		}
		return $t === null ? null : $this->utf8(Text::prep($t));
	}

	/** Up to $n keys starting at the first key >= $from. @return list<string> */
	public function dictKeys(string $from, int $n): array {
		$lex = $this->lexStore();
		$out = [];
		for ($i = $lex->lowerBound($from); $i < $lex->count() && count($out) < $n; $i++) {
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
		];
	}
}
