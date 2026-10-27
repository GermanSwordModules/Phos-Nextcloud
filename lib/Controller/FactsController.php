<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\Service\FactsService;
use OCA\Phos\Service\NotFound;
use OCA\Phos\Service\Sword\SwordException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserSession;

/** Fakten/Facts (Phase 3, Scope 1): see FactsService for what this ports and what it doesn't yet. */
class FactsController extends OCSController {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private FactsService $facts,
	) {
		parent::__construct($appName, $request);
	}

	private function uid(): string {
		return $this->session->getUser()->getUID();
	}

	#[NoAdminRequired]
	public function topics(string $lang = 'de', string $q = ''): DataResponse {
		return new DataResponse(['topics' => $this->facts->topics($lang, $q)]);
	}

	#[NoAdminRequired]
	public function build(string $key, string $lang = 'de', ?string $module = null, ?string $collection = null): DataResponse {
		try {
			return new DataResponse($this->facts->build($this->uid(), $key, $lang, $module, $collection));
		} catch (NotFound $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		} catch (SwordException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_UNPROCESSABLE_ENTITY);
		}
	}
}
