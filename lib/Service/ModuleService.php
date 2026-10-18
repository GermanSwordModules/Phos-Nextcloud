<?php

declare(strict_types=1);

namespace OCA\Phos\Service;

use OCA\Phos\Service\Sword\Conf;
use OCA\Phos\Service\Sword\NodeModuleFiles;
use OCA\Phos\Service\Sword\SwordException;
use OCA\Phos\Service\Sword\SwordModule;
use OCA\Phos\Sync\Record;
use OCA\Phos\Sync\RecordStore;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\ICache;
use OCP\ICacheFactory;

/**
 * SWORD modules a user can read on the server (Phase 3, W-1): the `module`
 * records of all readable collections. Files live in the collection
 * owner's Phos/Module/<Name>/; cipher keys only come from the reader's own
 * moduleKey records, never from a share.
 */
class ModuleService {
	private ICache $cache;

	public function __construct(
		private RecordStore $store,
		private IRootFolder $root,
		ICacheFactory $caches,
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

	public function chapter(string $uid, string $name, string $book, int $chapter, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
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
	public function dictKeys(string $uid, string $name, string $from, int $n, ?string $collection = null): array {
		$r = $this->record($uid, $name, $collection) ?? throw new NotFound("no module $name");
		return $this->open($uid, $r)->dictKeys($from, $n);
	}

	/**
	 * Results are cached per manifest revision (a module update = new rev);
	 * deciphered text additionally per key, so it never leaks to someone
	 * reading the same files without that key.
	 */
	private function cached(Record $r, string $what, callable $make, string $uid): mixed {
		$k = $r->collection . '/' . $r->key . '/' . $r->rev . '/' . $what;
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
