<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** Merge policy per record type, read from protocol/types.json. */
final class TypeRegistry {
	/** @var array<string, array{policy:string, text?:list<string>, sets?:list<string>}> */
	private array $types;
	private array $raw;

	public function __construct(?string $file = null) {
		$file ??= dirname(__DIR__, 2) . '/protocol/types.json';
		$this->raw = json_decode((string)file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
		$this->types = $this->raw['types'];
	}

	/** @return array{policy:string, text:list<string>, sets:list<string>} */
	public function get(string $type): array {
		$t = $this->types[$type] ?? ['policy' => 'lww'];
		return [
			'policy' => $t['policy'],
			'text' => $t['text'] ?? [],
			'sets' => $t['sets'] ?? [],
		];
	}

	public function asArray(): array {
		return $this->raw;
	}
}
