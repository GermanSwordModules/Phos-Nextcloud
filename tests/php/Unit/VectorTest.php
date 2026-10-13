<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Sync\Canonical;
use OCA\Phos\Sync\Clock;
use OCA\Phos\Sync\CollectionService;
use OCA\Phos\Sync\ForbiddenException;
use OCA\Phos\Sync\MemoryRecordStore;
use OCA\Phos\Sync\SyncService;
use OCA\Phos\Sync\TypeRegistry;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Plays protocol/vectors/*.json against SyncService (docs/protocol.md §10). */
final class VectorTest extends TestCase {
	public static function vectors(): array {
		$out = [];
		foreach (glob(dirname(__DIR__, 3) . '/protocol/vectors/*.json') as $f) {
			$out[basename($f, '.json')] = [$f];
		}
		return $out;
	}

	#[DataProvider('vectors')]
	public function testVector(string $file): void {
		$v = json_decode((string)file_get_contents($file), false, 512, JSON_THROW_ON_ERROR);
		$clock = new class extends Clock {
			public int $now = 0;
			public function nowMs(): int {
				return $this->now;
			}
		};
		$clock->now = $v->now ?? 1791200000000;
		$store = new MemoryRecordStore();
		$svc = new SyncService($store, new TypeRegistry(), $clock);
		$cols = new CollectionService($store);

		foreach ($v->steps as $i => $step) {
			$where = basename($file) . " step $i";
			$uid = $step->uid ?? 'alice';
			if (isset($step->now)) {
				$clock->now = $step->now;
			}
			$actual = null;
			try {
			if (isset($step->push)) {
				$changes = array_map(fn ($c) => self::change($c), $step->push->changes);
				$actual = $svc->push($uid, $step->push->device, $changes);
			} elseif (isset($step->pull)) {
				$actual = $svc->pull($uid, $step->pull->cursor ?? 0, $step->pull->limit ?? 500,
					isset($step->pull->types) ? $step->pull->types : null,
					isset($step->pull->collections) ? $step->pull->collections : null);
			} elseif (isset($step->createCollection)) {
				$actual = ['id' => $cols->create($uid, $step->createCollection->name)];
			} elseif (isset($step->addMember)) {
				$m = $step->addMember;
				$cols->addMember($uid, $m->collection, $m->type, $m->id, $m->perm);
				$actual = ['ok' => true];
			} elseif (isset($step->removeMember)) {
				$m = $step->removeMember;
				$cols->removeMember($uid, $m->collection, $m->type, $m->id);
				$actual = ['ok' => true];
			} elseif (isset($step->deleteCollection)) {
				$cols->delete($uid, $step->deleteCollection->collection);
				$actual = ['ok' => true];
			} elseif (isset($step->members)) {
				$actual = $cols->members($uid, $step->members->collection);
			} elseif (isset($step->userGroups)) {
				foreach ((array)$step->userGroups as $u => $g) {
					$store->groups[$u] = $g;
				}
				continue;
			} elseif (isset($step->get)) {
				$actual = $store->find($store->personalCollection($uid), $step->get->type, $step->get->key)?->toArray();
			} elseif (isset($step->conflicts)) {
				$actual = $svc->conflicts($uid);
			} elseif (isset($step->resolve)) {
				$actual = $svc->resolve($uid, $step->resolve->id, $step->resolve->use, $step->resolve->payload ?? null);
			} elseif (isset($step->gcHorizon)) {
				$store->horizon = $step->gcHorizon;
				continue;
			} else {
				$this->fail("$where: unknown step");
			}
			} catch (ForbiddenException $e) {
				$actual = ['error' => 'forbidden'];
			}
			if (property_exists($step, 'expect')) {
				$act = json_decode(json_encode($actual, JSON_THROW_ON_ERROR), false);
				self::assertSubset($step->expect, $act, $where);
			}
		}
		$this->addToAssertionCount(1);
	}

	/** Push entry: top level as array, payload stays \stdClass. */
	private static function change(\stdClass $c): array {
		$a = (array)$c;
		if (isset($a['baseRev'])) {
			$a['baseRev'] = (int)$a['baseRev'];
		}
		return $a;
	}

	private static function assertSubset(mixed $exp, mixed $act, string $path): void {
		if ($exp instanceof \stdClass) {
			self::assertInstanceOf(\stdClass::class, $act, "$path: expected object, got " . json_encode($act));
			foreach ((array)$exp as $k => $e) {
				self::assertTrue(property_exists($act, (string)$k), "$path.$k missing in " . json_encode($act, JSON_UNESCAPED_UNICODE));
				if ($k === 'payload') {
					// Payloads are compared exactly: a merge must not keep stray fields.
					self::assertSame(Canonical::encode($e), Canonical::encode($act->{$k}), "$path.payload");
					continue;
				}
				self::assertSubset($e, $act->{$k}, "$path.$k");
			}
			return;
		}
		if (is_array($exp)) {
			self::assertIsArray($act, "$path: expected array, got " . json_encode($act));
			self::assertCount(count($exp), $act, "$path: length, got " . json_encode($act, JSON_UNESCAPED_UNICODE));
			foreach ($exp as $i => $e) {
				self::assertSubset($e, $act[$i], "$path[$i]");
			}
			return;
		}
		self::assertSame($exp, $act, $path);
	}
}
