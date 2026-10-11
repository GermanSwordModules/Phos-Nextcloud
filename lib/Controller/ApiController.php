<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\Db\DeviceStore;
use OCA\Phos\Sync\Clock;
use OCA\Phos\Sync\RecordStore;
use OCA\Phos\Sync\SyncService;
use OCA\Phos\Sync\TypeRegistry;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/** OCS endpoints of sync protocol v2 (docs/protocol.md §7). */
class ApiController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private SyncService $sync,
		private RecordStore $store,
		private DeviceStore $devices,
		private TypeRegistry $types,
		private Clock $clock,
	) {
		parent::__construct($appName, $request);
	}

	private function uid(): string {
		return $this->session->getUser()->getUID();
	}

	/**
	 * Request body decoded with JSON objects as \stdClass, so that empty
	 * payload objects survive ("{}" must not become "[]").
	 */
	private function body(): ?\stdClass {
		$raw = file_get_contents('php://input');
		if ($raw === false || $raw === '') {
			return null;
		}
		try {
			$b = json_decode($raw, false, 512, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			return null;
		}
		return $b instanceof \stdClass ? $b : null;
	}

	private static function bad(string $msg): DataResponse {
		return new DataResponse(['error' => $msg], Http::STATUS_BAD_REQUEST);
	}

	/** Device bookkeeping must never fail a push or pull whose data is already committed. */
	private function touchQuietly(string $device, ?int $cursor = null): void {
		try {
			$this->devices->touch($this->uid(), $device, cursor: $cursor);
		} catch (\Throwable) {
		}
	}

	#[NoAdminRequired]
	public function status(): DataResponse {
		return new DataResponse([
			'apiVersion' => 1,
			'serverTime' => $this->clock->nowMs(),
			'personalCollection' => $this->store->personalCollection($this->uid()),
			'gcHorizon' => $this->store->gcHorizon(),
			'types' => $this->types->asArray(),
		]);
	}

	#[NoAdminRequired]
	public function listDevices(): DataResponse {
		return new DataResponse(['devices' => $this->devices->list($this->uid())]);
	}

	#[NoAdminRequired]
	public function registerDevice(): DataResponse {
		$b = $this->body();
		$id = is_string($b?->id ?? null) ? $b->id : '';
		if (!DeviceStore::isDeviceId($id)) {
			return self::bad('id must be 16 lowercase hex digits');
		}
		$str = fn ($v) => is_string($v) ? $v : null;
		$this->devices->touch($this->uid(), $id, $str($b->name ?? null), $str($b->platform ?? null), $str($b->appVersion ?? null));
		foreach ($this->devices->list($this->uid()) as $d) {
			if ($d['id'] === $id) {
				return new DataResponse($d);
			}
		}
		return new DataResponse([], Http::STATUS_INTERNAL_SERVER_ERROR);
	}

	#[NoAdminRequired]
	public function deleteDevice(string $id): DataResponse {
		if (!$this->devices->delete($this->uid(), $id)) {
			return new DataResponse([], Http::STATUS_NOT_FOUND);
		}
		return new DataResponse([]);
	}

	/**
	 * Nextcloud caps any parameter named "limit" at 500 unless a range is declared.
	 *
	 * @param int<1, 1000> $limit
	 */
	#[NoAdminRequired]
	public function changes(int $cursor = 0, int $limit = 500, string $types = '', string $device = ''): DataResponse {
		if ($cursor < 0) {
			return self::bad('cursor must be >= 0');
		}
		$typeList = $types === '' ? null : array_values(array_filter(array_map('trim', explode(',', $types))));
		$res = $this->sync->pull($this->uid(), $cursor, $limit, $typeList);
		if (DeviceStore::isDeviceId($device)) {
			$this->touchQuietly($device, $res['cursor']);
		}
		return new DataResponse($res);
	}

	#[NoAdminRequired]
	public function push(): DataResponse {
		$b = $this->body();
		if ($b === null || !is_string($b->device ?? null) || !is_array($b->changes ?? null)) {
			return self::bad('body must be {"device": "...", "changes": [...]}');
		}
		$changes = [];
		foreach ($b->changes as $c) {
			$changes[] = $c instanceof \stdClass ? (array)$c : [];
		}
		try {
			$results = $this->sync->push($this->uid(), $b->device, $changes);
		} catch (\InvalidArgumentException $e) {
			return self::bad($e->getMessage());
		}
		$this->touchQuietly($b->device);
		return new DataResponse(['results' => $results]);
	}

	#[NoAdminRequired]
	public function conflicts(): DataResponse {
		return new DataResponse(['conflicts' => $this->sync->conflicts($this->uid())]);
	}

	#[NoAdminRequired]
	public function resolveConflict(int $id): DataResponse {
		$b = $this->body();
		$use = $b?->use ?? null;
		if (!in_array($use, ['server', 'conflict'], true)) {
			return self::bad('use must be "server" or "conflict"');
		}
		try {
			$rec = $this->sync->resolve($this->uid(), $id, $use, $b->payload ?? null);
		} catch (\InvalidArgumentException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_FORBIDDEN);
		}
		if ($rec === false) {
			return new DataResponse([], Http::STATUS_NOT_FOUND);
		}
		return new DataResponse(['record' => $rec]);
	}
}
