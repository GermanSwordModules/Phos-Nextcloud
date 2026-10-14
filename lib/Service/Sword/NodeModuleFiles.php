<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

use OCP\Files\File;
use OCP\Files\Folder;

/**
 * Module files in a Nextcloud folder (Phos/Module/<Name>/ of the owner).
 * Seeks in the storage stream; storages whose streams cannot seek
 * (some object stores) fall back to reading the whole file once.
 */
final class NodeModuleFiles implements ModuleFiles {
	/** @var array<string, ?File> */
	private array $nodes = [];
	/** @var array<string, resource|false> */
	private array $fh = [];
	/** @var array<string, string> */
	private array $whole = [];

	public function __construct(private Folder $folder) {
	}

	public function __destruct() {
		foreach ($this->fh as $h) {
			if ($h !== false) {
				fclose($h);
			}
		}
	}

	private function node(string $path): ?File {
		if (!array_key_exists($path, $this->nodes)) {
			try {
				$n = $this->folder->get($path);
				$this->nodes[$path] = $n instanceof File ? $n : null;
			} catch (\Throwable) {
				$this->nodes[$path] = null;
			}
		}
		return $this->nodes[$path];
	}

	public function exists(string $path): bool {
		return $this->node($path) !== null;
	}

	public function size(string $path): int {
		return (int)($this->node($path)?->getSize() ?? 0);
	}

	public function read(string $path, int $offset, int $len): string {
		if ($len <= 0 || ($node = $this->node($path)) === null) {
			return '';
		}
		if (isset($this->whole[$path])) {
			return substr($this->whole[$path], $offset, $len);
		}
		if (!array_key_exists($path, $this->fh)) {
			try {
				$this->fh[$path] = $node->fopen('rb');
			} catch (\Throwable) {
				$this->fh[$path] = false;
			}
		}
		$h = $this->fh[$path];
		if ($h !== false && fseek($h, $offset) === 0) {
			$s = '';
			while (strlen($s) < $len && !feof($h)) {
				$part = fread($h, $len - strlen($s));
				if ($part === false || $part === '') {
					break;
				}
				$s .= $part;
			}
			return $s;
		}
		$this->whole[$path] = $node->getContent();
		return substr($this->whole[$path], $offset, $len);
	}
}
