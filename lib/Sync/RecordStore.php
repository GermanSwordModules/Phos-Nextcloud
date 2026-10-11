<?php

declare(strict_types=1);

namespace OCA\Phos\Sync;

/** Storage behind SyncService: database in production, memory in tests. */
interface RecordStore {
	/** The user's personal collection id, created on first use. */
	public function personalCollection(string $uid): string;

	/** @return list<string> collections the user may read */
	public function readableCollections(string $uid): array;

	/** @return list<string> collections the user may write */
	public function writableCollections(string $uid): array;

	public function find(string $collection, string $type, string $key): ?Record;

	/** The version stored with exactly this rev, if history still has it. */
	public function findVersion(string $collection, string $type, string $key, int $rev): ?Record;

	/**
	 * Stores a new version; assigns and returns its rev.
	 * @param int $expectedRev current rev the write is based on (0 = record must not exist)
	 * @throws ConcurrentWriteException when the record's rev is no longer $expectedRev
	 */
	public function write(Record $record, int $expectedRev, string $uid): Record;

	/** Remembers a processed changeId (dedupe of retried pushes). */
	public function logChange(string $uid, string $changeId, string $collection, string $type, string $key, string $status, ?int $conflictId): void;

	/** @return array{collection:string,type:string,key:string,status:string,conflictId:?int}|null */
	public function findChange(string $uid, string $changeId): ?array;

	/** @return list<Record> records with rev > $cursor in these collections, ascending */
	public function changesSince(array $collections, int $cursor, int $limit, ?array $types): array;

	public function addConflict(string $uid, Record $losing): int;

	/** @return list<array{id:int, record:Record, created:int}> */
	public function openConflicts(string $uid): array;

	/** @return array{id:int, record:Record, created:int}|null */
	public function getConflict(string $uid, int $id): ?array;

	public function closeConflict(string $uid, int $id): void;

	/** Highest rev of a purged tombstone (0 = nothing purged). */
	public function gcHorizon(): int;
}
