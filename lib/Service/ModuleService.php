<?php

declare(strict_types=1);

namespace OCA\Phos\Service;

use OCA\Phos\Service\Sword\Conf;
use OCA\Phos\Service\Sword\NodeModuleFiles;
use OCA\Phos\Service\Sword\SwordException;
use OCA\Phos\Service\Sword\SwordModule;
use OCA\Phos\Service\Sword\Versification;
use OCA\Phos\Sync\Record;
use OCA\Phos\Sync\RecordStore;
use OCA\Phos\Service\Sword\LeadIndex;
use OCA\Phos\Service\Sword\SearchIndex;
use OCP\Files\Folder;
use OCP\Files\IAppData;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\ICache;
use OCP\ICacheFactory;

/**
 * SWORD modules a user can read on the server (Phase 3, W-1): the `module`
 * records of all readable collections. Files live in the collection
 * owner's Phos/Module/<Name>/; cipher keys only come from the reader's own
 * moduleKey records, never from a share.
 */
class ModuleService {
	/** bump when what the reader returns changes */
	private const CACHE_VERSION = 2;

	private ICache $cache;

	public function __construct(
		private RecordStore $store,
		private IRootFolder $root,
		ICacheFactory $caches,
		private IAppData $appData,
	) {
		$this->cache = $caches->createDistributed('phos-sword');
	}

	/** @return list<Record> live module manifests, own collection first */
	private function manifests(string $uid): array {
		$personal = $this->store->personalCollection($uid);
		$colls = $this->store->readableCollections($uid);
		usort($colls, fn ($a, $b) => ($b === $personal) <=> ($a === $personal));
		$found = [];
		$cursor = 0;
		do {
			$page = $this->store->changesSince($colls, $cursor, 500, ['module']);
			foreach ($page as $r) {
				$cursor = $r->rev;
				if (!$r->deleted && $r->payload instanceof \stdClass && is_string($r->payload->conf ?? null)) {
					$found[] = $r;
				}
			}
		} while (count($page) === 500);
		$order = array_flip($colls);
		usort($found, fn (Record $a, Record $b) => $order[$a->collection] <=> $order[$b->collection]);
		return $found;
	}

	private function name(Record $r): string {
		return (string)($r->payload->name ?? substr($r->key, strlen('module:')));
	}

	private function cipherKey(string $uid, string $name): ?string {
		$rec = $this->store->find($this->store->personalCollection($uid), 'moduleKey', 'moduleKey:' . $name);
		$k = $rec === null || $rec->deleted ? null : ($rec->payload->key ?? null);
		return is_string($k) && $k !== '' ? $k : null;
	}

	private function folder(string $collection, string $name): ?Folder {
		$info = $this->store->getCollection($collection);
		if ($info === null) {
			return null;
		}
		try {
			$f = $this->root->getUserFolder($info['owner'])->get('Phos/Module/' . $name);
			return $f instanceof Folder ? $f : null;
		} catch (\Throwable) {
			return null;
		}
	}

	private function open(string $uid, Record $r): SwordModule {
		$name = $this->name($r);
		$folder = $this->folder($r->collection, $name);
		if ($folder === null) {
			throw new SwordException('module files are not on the server');
		}
		return new SwordModule(new Conf((string)$r->payload->conf), new NodeModuleFiles($folder),
			$this->cipherKey($uid, $name), (bool)($r->payload->cipher ?? false));
	}

	/**
	 * Every readable module once (a name in several collections: own first).
	 * @return list<array<string, mixed>>
	 */
	public function list(string $uid): array {
		$out = [];
		foreach ($this->manifests($uid) as $r) {
			$name = $this->name($r);
			if (isset($out[$name])) {
				continue;
			}
			$m = new SwordModule(new Conf((string)$r->payload->conf), new NullFiles(),
				$this->cipherKey($uid, $name), (bool)($r->payload->cipher ?? false));
			$info = $m->info();
			$info['name'] = $name;
			$info['collection'] = $r->collection;
			$info['size'] = (int)($r->payload->total ?? 0);
			$out[$name] = $info;
		}
		return array_values($out);
	}

	/** The manifest record a request names; null = not readable for this user. */
	private function record(string $uid, string $name, ?string $collection): ?Record {
		foreach ($this->manifests($uid) as $r) {
			if ($this->name($r) === $name && ($collection === null || $collection === '' || $r->collection === $collection)) {
				return $r;
			}
		}
		return null;
	}

	/** @throws SwordException */
	public function module(string $uid, string $name, ?string $collection = null): SwordModule {
		$r = $this->record($uid, $name, $collection);
		if ($r === null) {
			throw new NotFound("no module $name");
		}
		return $this->open($uid, $r);
	}

	/**
	 * Books with text in this module.
	 * @return array{versification:string,books:list<array{osis:string,name:string,testament:int,verses:list<int>}>}
	 */
	public function books(string $uid, string $name, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->cached($r, "books", fn () => $this->booksOf($this->open($uid, $r)), $uid);
	}

	private function booksOf(SwordModule $m): array {
		$v = $m->versification();
		$books = [];
		foreach ($m->books() as $i) {
			$b = $v->books[$i];
			$books[] = ['osis' => $b['osis'], 'name' => $b['name'], 'testament' => $b['t'], 'verses' => $b['v']];
		}
		return ['versification' => $v->name, 'books' => $books];
	}

	/** $as: the versification the caller counts in (parallel texts), '' = the module's own */
	public function chapter(string $uid, string $name, string $book, int $chapter, ?string $collection = null, string $as = ''): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		if ($as !== '' && in_array($as, Versification::names(), true)) {
			return $this->cached($r, "c/$book/$chapter/$as", fn () => $this->open($uid, $r)->chapterAs($book, $chapter, $as), $uid);
		}
		return $this->cached($r, "c/$book/$chapter", fn () => $this->open($uid, $r)->chapter($book, $chapter), $uid);
	}

	public function plan(string $uid, string $name, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->cached($r, 'plan', fn () => $this->open($uid, $r)->readingPlan() ?? throw new NotFound("$name has no reading plan"), $uid);
	}

	public function dictEntry(string $uid, string $name, string $key, ?string $collection = null): ?string {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->cached($r, "d/" . mb_strtoupper($key), fn () => $this->open($uid, $r)->dictEntry($key), $uid);
	}

	/** @return list<string> */
	public function dictKeys(string $uid, string $name, string $from, int $n, ?string $collection = null, bool $before = false): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->open($uid, $r)->dictKeys($from, $n, $before);
	}

	public function toc(string $uid, string $name, string $path, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->cached($r, "t/$path", fn () => $this->open($uid, $r)->toc($path), $uid);
	}

	public function bookEntry(string $uid, string $name, string $path, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->cached($r, "g/$path", fn () => $this->open($uid, $r)->bookEntry($path), $uid);
	}

	/**
	 * Full-text search in a Bible or commentary (W-4). The index is built on
	 * the first search after a module (re)upload and kept in the app data,
	 * one file per manifest revision (and cipher key).
	 * @param list<string> $books OSIS ids to search in, [] = all; "OT"/"NT" for a testament
	 * @return array<string, mixed>
	 */
	public function search(string $uid, string $name, string $query, string $mode = 'all', array $books = [],
		int $offset = 0, int $limit = 50, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		$m = $this->open($uid, $r);
		if ($m->kind !== SwordModule::BIBLE && $m->kind !== SwordModule::COMMENTARY) {
			throw new SwordException('only Bibles and commentaries can be searched');
		}
		$v11n = $m->versification();
		$want = null;
		if ($books) {
			$want = [];
			foreach ($books as $b) {
				if ($b === 'OT' || $b === 'NT') {
					foreach ($v11n->books as $i => $bk) {
						if ($bk['t'] === ($b === 'OT' ? 1 : 2)) {
							$want[] = $i;
						}
					}
				} elseif (($i = $v11n->bookIndex($b)) !== null) {
					$want[] = $i;
				}
			}
		}
		$index = $this->index($uid, $r, $m);
		$t0 = microtime(true);
		$found = $index->find($query, $mode, $want);
		if (isset($found['error'])) {
			throw new SwordException($found['error']);
		}
		$perBook = [];
		foreach ($found['positions'] as $p) {
			$osis = $v11n->books[$index->verseAt($p)[0]]['osis'];
			$perBook[$osis] = ($perBook[$osis] ?? 0) + 1;
		}
		$hits = [];
		foreach (array_slice($found['positions'], $offset, $limit) as $p) {
			[$b, $c, $v] = $index->verseAt($p);
			$hits[] = ['book' => $v11n->books[$b]['osis'], 'chapter' => $c, 'verse' => $v, 'text' => $m->verse($b, $c, $v)];
		}
		return [
			'total' => count($found['positions']),
			'perBook' => $perBook,
			'terms' => $found['terms'],
			'strongs' => $found['strongs'],
			'hits' => $hits,
			'ms' => (int)round((microtime(true) - $t0) * 1000),
		];
	}

	private function index(string $uid, Record $r, SwordModule $m): SearchIndex {
		return $this->stored($uid, $r, 'search', SearchIndex::FORMAT,
			fn () => SearchIndex::build($m), fn (string $d) => SearchIndex::fromString($d));
	}

	private function leads(string $uid, Record $r, SwordModule $m): LeadIndex {
		return $this->stored($uid, $r, 'leads', LeadIndex::FORMAT,
			fn () => LeadIndex::build($m), fn (string $d) => LeadIndex::fromString($d));
	}

	/**
	 * An index of a module kept in the app data: one file per manifest
	 * revision (and cipher key); building a new one removes the module's
	 * older ones. The file name starts with a hash of the module, so that
	 * works without any bookkeeping.
	 */
	private function stored(string $uid, Record $r, string $folder, int $format, callable $build, callable $parse): object {
		$mod = substr(sha1($r->collection . '/' . $r->key), 0, 20);
		$id = $r->rev . '/' . $format;
		if ($r->payload->cipher ?? false) {
			$id .= '/' . sha1((string)$this->cipherKey($uid, $this->name($r)));
		}
		$file = $mod . '-' . substr(sha1($id), 0, 20) . '.idx';
		try {
			$dir = $this->appData->getFolder($folder);
		} catch (NotFoundException) {
			$dir = $this->appData->newFolder($folder);
		}
		try {
			$ix = $parse($dir->getFile($file)->getContent());
			if ($ix !== null) {
				return $ix;
			}
		} catch (\Throwable) {
			// missing or unreadable: build it again
		}
		@set_time_limit(600);
		$data = $build();
		foreach ($dir->getDirectoryListing() as $f) {
			if (str_starts_with($f->getName(), $mod . '-') && $f->getName() !== $file) {
				try {
					$f->delete();
				} catch (\Throwable) {
				}
			}
		}
		try {
			$dir->getFile($file)->putContent($data);
		} catch (NotFoundException) {
			$dir->newFile($file, $data);
		}
		return $parse($data) ?? throw new SwordException('index unreadable');
	}

	/**
	 * Sermon and devotional books treating a chapter (the desktop's Bible
	 * reading page, RenderSermonCardsHtml): books whose entries cite it in
	 * their title or opening, and sermon commentaries' entries on it.
	 * @param list<string> $names how the book may be written ("1. Mose", "Genesis")
	 * @return list<array<string, mixed>>
	 */
	public function sermons(string $uid, string $osis, int $chapter, array $names, int $limit = 20): array {
		$out = [];
		$seen = [];
		foreach ($this->manifests($uid) as $r) {
			$name = $this->name($r);
			if (isset($seen[$name]) || count($out) >= $limit) {
				continue;
			}
			$seen[$name] = true;
			$conf = new Conf((string)$r->payload->conf);
			$kind = SwordModule::kindOf($conf->get('ModDrv'));
			$hay = implode(' ', [$name, $conf->get('Description'), $conf->get('Category'), $conf->get('LCSH')]);
			if (!self::looksLikeSermon($hay, $kind) || $conf->get('AndBibleProvidesReadingPlan') !== '') {
				continue;
			}
			try {
				$m = $this->open($uid, $r);
				if ($m->locked()) {
					continue;
				}
				$desc = $conf->get('Description') ?: $name;
				if ($kind === SwordModule::GENBOOK) {
					foreach ($this->leads($uid, $r, $m)->citing($names, $chapter, min(5, $limit - count($out))) as $hit) {
						$out[] = ['module' => $name, 'description' => $desc, 'kind' => $kind] + $hit;
					}
				} elseif ($kind === SwordModule::COMMENTARY) {
					$ch = $this->chapter($uid, $name, $osis, $chapter, $r->collection);
					$n = 0;
					foreach ($ch['verses'] as $v => $text) {
						if ($text === '' || isset($ch['links'][$v]) || $n >= 5 || count($out) >= $limit) {
							continue;
						}
						[$plain] = SearchIndex::plain($text, $m->sourceType());
						$out[] = ['module' => $name, 'description' => $desc, 'kind' => $kind, 'verse' => (int)$v, 'lead' => mb_substr($plain, 0, 400)];
						$n++;
					}
				}
			} catch (SwordException) {
				// unreadable or no such chapter there: no hits from it
			}
		}
		return $out;
	}

	/**
	 * Pictures and maps showing a chapter: entries of picture and map
	 * modules citing it, with their first picture (the desktop's keyword
	 * fallback of the Bible reading page; its places-on-maps part needs the
	 * map index, which only the desktop has).
	 * @param list<string> $names
	 * @return list<array<string, mixed>>
	 */
	public function media(string $uid, string $osis, int $chapter, array $names, int $limit = 12): array {
		$out = [];
		$seen = [];
		foreach ($this->manifests($uid) as $r) {
			$name = $this->name($r);
			if (isset($seen[$name]) || count($out) >= $limit) {
				continue;
			}
			$seen[$name] = true;
			$conf = new Conf((string)$r->payload->conf);
			if (SwordModule::kindOf($conf->get('ModDrv')) !== SwordModule::GENBOOK
				|| !self::looksLikeMedia($conf->get('Category'), implode(' ', [$name, $conf->get('Description'), $conf->get('Category')]))) {
				continue;
			}
			try {
				$m = $this->open($uid, $r);
				if ($m->locked()) {
					continue;
				}
				foreach ($this->leads($uid, $r, $m)->citing($names, $chapter, min(8, $limit - count($out)), true) as $hit) {
					$out[] = ['module' => $name, 'description' => $conf->get('Description') ?: $name] + $hit;
				}
			} catch (SwordException) {
			}
		}
		return $out;
	}

	/** unit_facts LooksLikeMedia */
	public static function looksLikeMedia(string $category, string $hay): bool {
		return in_array(strtolower($category), ['maps', 'images'], true)
			|| (bool)preg_match('/image|figure|bild|foto|photo|karte|graphic/u', mb_strtolower($hay));
	}

	/**
	 * unit_facts LooksLikeSermon on name, description, category and LCSH.
	 * Commentaries only by the narrower words: a "homiletic" or prayer
	 * commentary would otherwise fill every chapter.
	 */
	public static function looksLikeSermon(string $hay, string $kind): bool {
		$h = mb_strtolower($hay);
		return match ($kind) {
			SwordModule::GENBOOK => (bool)preg_match('/predigt|andacht|gebet|losung|sermon|devotion|prayer|homil/u', $h),
			SwordModule::COMMENTARY => (bool)preg_match('/predigt|andacht|sermon|devotion/u', $h),
			default => false,
		};
	}

	/**
	 * A picture of a module, as its text names it.
	 * @return array{data:string,mime:string}
	 */
	public function file(string $uid, string $name, string $path, ?string $collection = null): array {
		$mime = match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
			'jpg', 'jpeg' => 'image/jpeg',
			'png' => 'image/png',
			'gif' => 'image/gif',
			'webp' => 'image/webp',
			'bmp' => 'image/bmp',
			'svg' => 'image/svg+xml',
			default => throw new NotFound('not a picture'),
		};
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		$folder = $this->folder($r->collection, $this->name($r)) ?? throw new NotFound('module files are not on the server');
		$m = $this->open($uid, $r);
		$p = $m->resolveFile($path) ?? throw new NotFound("no file $path");
		$fs = new NodeModuleFiles($folder);
		return ['data' => $fs->read($p, 0, $fs->size($p)), 'mime' => $mime];
	}

	/**
	 * Results are cached per manifest revision (a module update = new rev);
	 * deciphered text additionally per key, so it never leaks to someone
	 * reading the same files without that key.
	 */
	private function cached(Record $r, string $what, callable $make, string $uid): mixed {
		$k = self::CACHE_VERSION . '/' . $r->collection . '/' . $r->key . '/' . $r->rev . '/' . $what;
		if ($r->payload->cipher ?? false) {
			$k .= '/' . sha1((string)$this->cipherKey($uid, $this->name($r)));
		}
		$k = sha1($k);
		$hit = $this->cache->get($k);
		if (is_array($hit) && array_key_exists('v', $hit)) {
			return $hit['v'];
		}
		$v = $make();
		$this->cache->set($k, ['v' => $v], 86400);
		return $v;
	}
}
