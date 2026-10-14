<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/** Random access to the files of one module, paths relative to the SWORD root. */
interface ModuleFiles {
	public function exists(string $path): bool;

	public function size(string $path): int;

	/** Up to $len bytes from $offset (fewer at end of file). */
	public function read(string $path, int $offset, int $len): string;
}
