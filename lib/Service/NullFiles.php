<?php

declare(strict_types=1);

namespace OCA\Phos\Service;

use OCA\Phos\Service\Sword\ModuleFiles;

/** No files: module metadata from the conf alone (module lists). */
final class NullFiles implements ModuleFiles {
	public function exists(string $path): bool {
		return false;
	}

	public function size(string $path): int {
		return 0;
	}

	public function read(string $path, int $offset, int $len): string {
		return '';
	}
}
