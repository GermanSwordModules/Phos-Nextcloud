<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\Util;

/** The web frontend (src/, built to js/phos-main.mjs). */
class PageController extends Controller {
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'phos-main');
		return new TemplateResponse(Application::APP_ID, 'main');
	}
}
