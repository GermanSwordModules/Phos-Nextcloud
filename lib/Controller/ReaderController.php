<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\Service\ModuleService;
use OCA\Phos\Service\NotFound;
use OCA\Phos\Service\Sword\SwordException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Read-only access to synced SWORD modules (docs/protocol.md §12): raw
 * entry markup, rendered by the client. `collection` picks one copy when
 * the same module name is readable from several collections.
 */
class ReaderController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private ModuleService $modules,
	) {
		parent::__construct($appName, $request);
	}

	private function uid(): string {
		return $this->session->getUser()->getUID();
	}

	private function run(callable $f): DataResponse {
		try {
			return new DataResponse($f());
		} catch (NotFound $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		} catch (SwordException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}

	#[NoAdminRequired]
	public function modules(): DataResponse {
		return $this->run(fn () => ['modules' => $this->modules->list($this->uid())]);
	}

	#[NoAdminRequired]
	public function books(string $module, ?string $collection = null): DataResponse {
		return $this->run(fn () => $this->modules->books($this->uid(), $module, $collection));
	}

	#[NoAdminRequired]
	public function chapter(string $module, string $book, int $chapter, ?string $collection = null): DataResponse {
		return $this->run(fn () => $this->modules->chapter($this->uid(), $module, $book, $chapter, $collection));
	}

	#[NoAdminRequired]
	public function plan(string $module, ?string $collection = null): DataResponse {
		return $this->run(fn () => $this->modules->plan($this->uid(), $module, $collection));
	}

	#[NoAdminRequired]
	public function entry(string $module, string $key, ?string $collection = null): DataResponse {
		return $this->run(function () use ($module, $key, $collection) {
			$text = $this->modules->dictEntry($this->uid(), $module, $key, $collection);
			if ($text === null) {
				throw new NotFound("no entry $key");
			}
			return ['key' => $key, 'text' => $text];
		});
	}

	/**
	 * @param int<1, 200> $limit
	 */
	#[NoAdminRequired]
	public function keys(string $module, string $from = '', int $limit = 50, ?string $collection = null): DataResponse {
		return $this->run(fn () => ['keys' => $this->modules->dictKeys($this->uid(), $module, $from, max(1, min(200, $limit)), $collection)]);
	}
}
