<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * Entry storage of key-sorted modules (dictionaries, lexicons):
 *   RawLD   rawstr.cpp   <p>.idx (u32 start, u16 size) → <p>.dat "key\n text"
 *   RawLD4  rawstr4.cpp  <p>.idx (u32 start, u32 size)
 *   zLD     zstr.cpp     <p>.idx (u32, u32) → <p>.dat "key\r\n" u32 block u32 entry
 *                        → <p>.zdx (u32 start, u32 size) → <p>.zdt compressed
 *                        EntriesBlock (u32 count, count × (u32 offset, u32 size), data)
 * Keys are compared upper-cased (sword's toupperstr_utf8); "@LINK key" entries redirect.
 */
final class LexStore {
	private bool $z;
	private int $idxSize;
	private int $count;
	private ?int $cacheBlock = null;
	private string $cacheBuf = '';

	public function __construct(
		private ModuleFiles $fs,
		string $driver,
		private string $path,
		private string $compress = 'ZIP',
		private ?string $cipherKey = null,
		private bool $caseSensitive = false,
		private bool $strongsPadding = true,
	) {
		$d = strtolower($driver);
		$this->z = $d === 'zld';
		$this->idxSize = $d === 'rawld' ? 6 : 8;
		$this->count = intdiv($fs->size($path . '.idx'), $this->idxSize);
	}

	public function count(): int {
		return $this->count;
	}

	/** @return array{0:int,1:int} start, size of entry $i in .dat */
	private function idx(int $i): array {
		$e = $this->fs->read($this->path . '.idx', $i * $this->idxSize, $this->idxSize);
		if (strlen($e) < $this->idxSize) {
			return [0, 0];
		}
		return array_values(unpack($this->idxSize === 6 ? 'Vs/vn' : 'Vs/Vn', $e));
	}

	/** Key of entry $i as stored. */
	public function keyAt(int $i): string {
		[$start, $size] = $this->idx($i);
		if ($size <= 0) {
			return '';
		}
		$dat = $this->fs->read($this->path . '.dat', $start, min($size, 512));
		return substr($dat, 0, strcspn($dat, "\\\r\n"));
	}

	private function norm(string $k): string {
		return $this->caseSensitive ? $k : mb_strtoupper($k, 'UTF-8');
	}

	/** Position of the first entry whose key is >= $key (binary search). */
	public function lowerBound(string $key): int {
		$k = $this->norm($key);
		$lo = 0;
		$hi = $this->count;
		while ($lo < $hi) {
			$mid = intdiv($lo + $hi, 2);
			if (strcmp($this->norm($this->keyAt($mid)), $k) < 0) {
				$lo = $mid + 1;
			} else {
				$hi = $mid;
			}
		}
		return $lo;
	}

	/**
	 * SWLD::strongsPad: "G25" → "G0025", "25" → "00025", "25a" → "00025A";
	 * any other key unchanged.
	 */
	public static function strongsPad(string $key): string {
		$len = strlen($key);
		if ($len >= 9 || $len === 0) {
			return $key;
		}
		$prefix = '';
		if (strpbrk($key[0], 'GHgh') !== false) {
			$prefix = $key[0];
			$key = substr($key, 1);
			$len--;
		}
		$digits = strspn($key, '0123456789');
		if (!$digits || $digits < $len - 2) {
			return $prefix . $key;
		}
		$rest = substr($key, $digits);
		$bang = str_starts_with($rest, '!');
		if ($bang) {
			$rest = substr($rest, 1);
		}
		$sub = $rest !== '' && ctype_alpha($rest[0]) ? strtoupper($rest[0]) : '';
		$num = sprintf($prefix !== '' ? '%04d' : '%05d', (int)substr($key, 0, $digits));
		// sprintf ends the string after the number unless a letter is re-appended
		return $prefix . $num . ($sub !== '' ? ($bang ? '!' : '') . $sub : '');
	}

	/** Entry text for exactly this key (after @LINK resolution), or null. */
	public function find(string $key): ?string {
		if ($this->strongsPadding) {
			$key = self::strongsPad($key);
		}
		for ($hops = 0; $hops < 5; $hops++) {
			$i = $this->lowerBound($key);
			if ($i >= $this->count || $this->norm($this->keyAt($i)) !== $this->norm($key)) {
				return null;
			}
			$text = $this->textAt($i);
			if (!str_starts_with($text, '@LINK')) {
				return $text;
			}
			$key = trim(substr($text, 6, strcspn($text, "\r\n", 6)));
		}
		return null;
	}

	/** Raw text of entry $i. */
	public function textAt(int $i): string {
		[$start, $size] = $this->idx($i);
		if ($size <= 0) {
			return '';
		}
		$dat = $this->fs->read($this->path . '.dat', $start, $size);
		$nl = strpos($dat, "\n");
		$body = $nl === false ? '' : substr($dat, $nl + 1);
		if (!$this->z) {
			if ($this->cipherKey !== null && strlen($body) > 2) {
				$body = Sapphire::decipher($this->cipherKey, $body);
			}
			return Text::cstr($body);
		}
		if (str_starts_with($body, '@LINK')) {
			return Text::cstr($body);
		}
		if (strlen($body) < 8) {
			return '';
		}
		['b' => $block, 'e' => $entry] = unpack('Vb/Ve', $body);
		$buf = $this->block($block);
		if (strlen($buf) < 4) {
			return '';
		}
		$n = unpack('V', $buf)[1];
		if ($entry >= $n) {
			return '';
		}
		['o' => $off] = unpack('Vo/Vs', $buf, 4 + $entry * 8);
		return $off ? Text::cstr(substr($buf, $off)) : '';
	}

	private function block(int $num): string {
		if ($this->cacheBlock === $num) {
			return $this->cacheBuf;
		}
		$e = $this->fs->read($this->path . '.zdx', $num * 8, 8);
		if (strlen($e) < 8) {
			return '';
		}
		['s' => $start, 'n' => $size] = unpack('Vs/Vn', $e);
		$raw = $this->fs->read($this->path . '.zdt', $start, $size);
		if ($this->cipherKey !== null && strlen($raw) > 2) {
			$raw = Sapphire::decipher($this->cipherKey, $raw);
		}
		$this->cacheBlock = $num;
		$this->cacheBuf = VerseStore::uncompress($this->compress, $raw);
		return $this->cacheBuf;
	}
}
