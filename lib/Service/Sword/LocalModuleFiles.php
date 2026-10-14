<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/** Module files in a local directory (tests, tools). */
final class LocalModuleFiles implements ModuleFiles {
	/** @var array<string, resource> */
	private array $fh = [];

	public function __construct(private string $root) {
		$this->root = rtrim($root, '/') . '/';
	}

	public function __destruct() {
		foreach ($this->fh as $h) {
			fclose($h);
		}
	}

	public function exists(string $path): bool {
		return is_file($this->root . $path);
	}

	public function size(string $path): int {
		return (int)@filesize($this->root . $path);
	}

	public function read(string $path, int $offset, int $len): string {
		if ($len <= 0) {
			return '';
		}
		$h = $this->fh[$path] ??= @fopen($this->root . $path, 'rb');
		if ($h === false || fseek($h, $offset) !== 0) {
			return '';
		}
		$s = fread($h, $len);
		return $s === false ? '' : $s;
	}
}
