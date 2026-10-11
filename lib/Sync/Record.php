<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** One stored version of a record (docs/protocol.md §4). */
final class Record {
	public function __construct(
		public string $collection,
		public string $type,
		public string $key,
		public int $rev,
		public string $hlc,
		public string $device,
		public bool $deleted,
		/** Decoded JSON (objects as \stdClass); null for tombstones. */
		public mixed $payload,
	) {
	}

	public function sameContent(bool $deleted, mixed $payload): bool {
		if ($this->deleted || $deleted) {
			return $this->deleted === $deleted;
		}
		return Canonical::equals($this->payload, $payload);
	}

	public function toArray(): array {
		return [
			'collection' => $this->collection,
			'type' => $this->type,
			'key' => $this->key,
			'rev' => $this->rev,
			'hlc' => $this->hlc,
			'device' => $this->device,
			'deleted' => $this->deleted,
			'payload' => $this->deleted ? null : $this->payload,
		];
	}
}
