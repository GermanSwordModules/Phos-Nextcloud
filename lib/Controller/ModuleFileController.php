<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\Service\ModuleService;
use OCA\Phos\Service\NotFound;
use OCA\Phos\Service\Sword\SwordException;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Pictures inside a readable module (maps, book illustrations), for <img>
 * in the web frontend: the path as the module's text names it, below the
 * module's data folder. Same access rule as the reader (docs/protocol.md §12).
 */
class ModuleFileController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private ModuleService $modules,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(string $module, string $path, ?string $collection = null) {
		$uid = $this->session->getUser()?->getUID();
		if ($uid === null) {
			return new DataResponse(['error' => 'no access'], Http::STATUS_FORBIDDEN);
		}
		try {
			$f = $this->modules->file($uid, $module, $path, $collection);
		} catch (NotFound|SwordException $e) {
			return new DataResponse(['error' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		}
		$resp = new DataDisplayResponse($f['data'], Http::STATUS_OK, ['Content-Type' => $f['mime']]);
		$resp->cacheFor(86400, false, true);
		return $resp;
	}
}
