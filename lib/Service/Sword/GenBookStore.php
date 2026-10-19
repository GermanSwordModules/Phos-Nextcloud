<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * Tree of a RawGenBook (treekeyidx.cpp, rawgenbook.cpp):
 *   <p>.idx  u32 per node → offset of the node in <p>.dat
 *   <p>.dat  node: s32 parent, s32 next, s32 firstChild (all three are .idx
 *            offsets, i.e. node number × 4; -1 = none), name "\0",
 *            u16 size, user data — for RawGenBook u32 start, u32 size in <p>.bdt
 *   <p>.bdt  entry texts, uncompressed (ciphered with the module key, if any)
 * The root is .idx offset 0 with an empty name; a key is the path of names
 * below it, "/Teil 1/Kapitel 2".
 */
final class GenBookStore {
	/** @var array<int, array{parent:int,next:int,child:int,name:string,start:int,size:int}> */
	private array $nodes = [];

	public function __construct(
		private ModuleFiles $fs,
		private string $path,
		private ?string $cipherKey = null,
		/** converts a stored name to UTF-8 */
		private ?\Closure $utf8 = null,
	) {
		if (!$fs->exists($path . '.idx') || !$fs->exists($path . '.dat')) {
			throw new SwordException('book files are not on the server');
		}
	}

	/** @return array{parent:int,next:int,child:int,name:string,start:int,size:int} */
	public function node(int $id): array {
		if (isset($this->nodes[$id])) {
			return $this->nodes[$id];
		}
		$o = $this->fs->read($this->path . '.idx', $id, 4);
		if (strlen($o) < 4) {
			throw new SwordException("no node $id");
		}
		$off = unpack('V', $o)[1];
		$buf = '';
		for ($len = 256; ; $len *= 4) {
			$buf = $this->fs->read($this->path . '.dat', $off, $len);
			$z = strpos($buf, "\0", 12);
			if (($z !== false && strlen($buf) >= $z + 3) || strlen($buf) < $len || $len > 65536) {
				break;
			}
		}
		if (strlen($buf) < 13) {
			throw new SwordException("broken node $id");
		}
		['p' => $p, 'n' => $n, 'c' => $c] = unpack('lp/ln/lc', $buf);
		$z = strpos($buf, "\0", 12);
		$z = $z === false ? strlen($buf) : $z;
		$name = substr($buf, 12, $z - 12);
		$start = 0;
		$size = 0;
		if (strlen($buf) >= $z + 3) {
			$ds = unpack('v', $buf, $z + 1)[1];
			if ($ds >= 8) {
				$d = substr($buf, $z + 3, 8);
				if (strlen($d) < 8) {
					$d = $this->fs->read($this->path . '.dat', $off + $z + 3, 8);
				}
				if (strlen($d) === 8) {
					['s' => $start, 'z' => $size] = unpack('Vs/Vz', $d);
				}
			}
		}
		return $this->nodes[$id] = [
			'parent' => $p, 'next' => $n, 'child' => $c,
			'name' => $this->utf8 ? ($this->utf8)($name) : $name,
			'start' => $start, 'size' => $size,
		];
	}

	/** @return list<int> */
	public function children(int $id): array {
		$out = [];
		$seen = [];
		for ($c = $this->node($id)['child']; $c >= 0 && !isset($seen[$c]) && count($out) < 100000; $c = $this->node($c)['next']) {
			$seen[$c] = true;
			$out[] = $c;
		}
		return $out;
	}

	/** Node of a path ("" or "/" = root); null = no such node. */
	public function find(string $path): ?int {
		$id = 0;
		foreach (array_filter(explode('/', $path), fn ($p) => $p !== '') as $part) {
			$found = null;
			$ci = null;
			foreach ($this->children($id) as $c) {
				$n = $this->node($c)['name'];
				if ($n === $part) {
					$found = $c;
					break;
				}
				if ($ci === null && mb_strtolower($n, 'UTF-8') === mb_strtolower($part, 'UTF-8')) {
					$ci = $c;
				}
			}
			$id = $found ?? $ci;
			if ($id === null) {
				return null;
			}
		}
		return $id;
	}

	public function pathOf(int $id): string {
		$parts = [];
		for ($guard = 0; $id > 0 && $guard < 200; $guard++) {
			$n = $this->node($id);
			array_unshift($parts, $n['name']);
			$id = $n['parent'];
		}
		return '/' . implode('/', $parts);
	}

	public function text(int $id): string {
		$n = $this->node($id);
		if ($n['size'] <= 0) {
			return '';
		}
		$raw = $this->fs->read($this->path . '.bdt', $n['start'], $n['size']);
		if ($this->cipherKey !== null && strlen($raw) > 2) {
			$raw = Sapphire::decipher($this->cipherKey, $raw);
		}
		return Text::cstr($raw);
	}

	/** Next node in reading order (depth first), -1 at the end. */
	public function nextOf(int $id): int {
		$n = $this->node($id);
		if ($n['child'] >= 0) {
			return $n['child'];
		}
		for ($guard = 0; $id >= 0 && $guard < 200; $guard++) {
			$n = $this->node($id);
			if ($n['next'] >= 0) {
				return $n['next'];
			}
			$id = $n['parent'];
		}
		return -1;
	}

	/** Previous node in reading order, -1 before the first one (the root does not count). */
	public function prevOf(int $id): int {
		$n = $this->node($id);
		if ($n['parent'] < 0) {
			return -1;
		}
		$sibs = $this->children($n['parent']);
		$i = array_search($id, $sibs, true);
		if ($i === false || $i === 0) {
			return $n['parent'] > 0 ? $n['parent'] : -1;
		}
		$p = $sibs[$i - 1];
		for ($guard = 0; $guard < 200; $guard++) {
			$kids = $this->children($p);
			if (!$kids) {
				break;
			}
			$p = $kids[count($kids) - 1];
		}
		return $p;
	}
}
