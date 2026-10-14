<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * Entry storage of verse-keyed modules (Bibles, commentaries):
 *   zText/zCom   zverse.cpp   ot.?zs (blocks, 12 B) ot.?zv (verses, 10 B) ot.?zz (data)
 *   zText4/zCom4 zverse4.cpp  same, verse entries 12 B (32-bit size)
 *   RawText/RawCom   rawverse.cpp  ot.vss (6 B) + ot
 *   RawText4/RawCom4 rawverse4.cpp ot.vss (8 B) + ot
 * Ciphered modules: compressed drivers decipher the compressed block,
 * raw drivers the entry (sword's CipherFilter placement).
 */
final class VerseStore {
	private bool $compressed;
	private int $entrySize;
	/** @var array<int, ?array{idx:string,dat:string,blk?:string}> testament → file names */
	private array $files = [];
	private ?string $cacheKey = null;
	private string $cacheBuf = '';

	public function __construct(
		private ModuleFiles $fs,
		string $driver,
		private string $path,
		private string $compress = 'ZIP',
		private ?string $cipherKey = null,
	) {
		$d = strtolower($driver);
		$this->compressed = str_starts_with($d, 'z');
		$four = str_ends_with($d, '4');
		$this->entrySize = $this->compressed ? ($four ? 12 : 10) : ($four ? 8 : 6);
		$this->path = rtrim($path, '/') . '/';
	}

	/** @return array{idx:string,dat:string,blk?:string}|null */
	private function files(int $testament): ?array {
		if (!array_key_exists($testament, $this->files)) {
			$t = $testament === 1 ? 'ot' : 'nt';
			$f = null;
			if ($this->compressed) {
				foreach (['b', 'c', 'v'] as $u) {   // BlockType BOOK / CHAPTER / VERSE
					if ($this->fs->exists($this->path . "$t.{$u}zv") && $this->fs->exists($this->path . "$t.{$u}zz")) {
						$f = ['idx' => $this->path . "$t.{$u}zv", 'blk' => $this->path . "$t.{$u}zs", 'dat' => $this->path . "$t.{$u}zz"];
						break;
					}
				}
			} elseif ($this->fs->exists($this->path . "$t.vss") && $this->fs->exists($this->path . $t)) {
				$f = ['idx' => $this->path . "$t.vss", 'dat' => $this->path . $t];
			}
			$this->files[$testament] = $f;
		}
		return $this->files[$testament];
	}

	public function hasTestament(int $testament): bool {
		return $this->files($testament) !== null;
	}

	/**
	 * Where the entry is stored; equal refs of neighbouring verses = one
	 * entry linked to several verses (sword's isLinked). '' = empty entry.
	 */
	public function ref(int $testament, int $index): string {
		$f = $this->files($testament);
		if ($f === null || $index < 0) {
			return '';
		}
		$e = $this->fs->read($f['idx'], $index * $this->entrySize, $this->entrySize);
		if (strlen($e) < $this->entrySize) {
			return '';
		}
		// the size field closes the entry; 0 = no text
		$sizeLen = $this->entrySize === 10 || $this->entrySize === 6 ? 2 : 4;
		return trim(substr($e, -$sizeLen), "\0") === '' ? '' : $e;
	}

	/** Raw entry text ('' when empty or missing). */
	public function entry(int $testament, int $index): string {
		$f = $this->files($testament);
		if ($f === null || $index < 0) {
			return '';
		}
		$e = $this->fs->read($f['idx'], $index * $this->entrySize, $this->entrySize);
		if (strlen($e) < $this->entrySize) {
			return '';
		}
		if (!$this->compressed) {
			[$start, $size] = array_values(unpack($this->entrySize === 6 ? 'Vs/vn' : 'Vs/Vn', $e));
			if ($size <= 0) {
				return '';
			}
			$text = $this->fs->read($f['dat'], $start, $size);
			if ($this->cipherKey !== null && strlen($text) > 2) {
				$text = Sapphire::decipher($this->cipherKey, $text);
			}
			return Text::cstr($text);
		}
		[$buf, $start, $size] = array_values(unpack($this->entrySize === 10 ? 'Vb/Vs/vn' : 'Vb/Vs/Vn', $e));
		if ($size <= 0) {
			return '';
		}
		$block = $this->block($testament, $f, $buf);
		return $start < strlen($block) ? Text::cstr(substr($block, $start, $size)) : '';
	}

	private function block(int $testament, array $f, int $num): string {
		$key = "$testament/$num";
		if ($this->cacheKey === $key) {
			return $this->cacheBuf;
		}
		$b = $this->fs->read($f['blk'], $num * 12, 12);
		if (strlen($b) < 12) {
			return '';
		}
		['o' => $off, 'c' => $csize] = unpack('Vo/Vc/Vu', $b);
		$raw = $this->fs->read($f['dat'], $off, $csize);
		if ($this->cipherKey !== null && strlen($raw) > 2) {
			$raw = Sapphire::decipher($this->cipherKey, $raw);
		}
		$this->cacheKey = $key;
		$this->cacheBuf = self::uncompress($this->compress, $raw);
		return $this->cacheBuf;
	}

	public static function uncompress(string $type, string $raw): string {
		$type = strtoupper($type === '' ? 'ZIP' : $type);
		$out = match ($type) {
			'ZIP' => @gzuncompress($raw),
			'BZIP2' => function_exists('bzdecompress') ? @bzdecompress($raw) : false,
			default => false,
		};
		if (!is_string($out)) {
			throw new SwordException("cannot decompress ($type)");
		}
		return $out;
	}
}
