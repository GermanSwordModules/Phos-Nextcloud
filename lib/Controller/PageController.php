<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Util;

/** The web frontend (src/, built to js/phos-main.mjs). */
class PageController extends Controller {
	public function __construct(string $appName, IRequest $request, private IURLGenerator $urls) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		Util::addScript(Application::APP_ID, 'phos-main');
		// the light bulb of Phos Desktop in the browser tab (core's favicon
		// derives from the app icon only with imagick, and that one is white)
		$icon = $this->urls->imagePath(Application::APP_ID, 'favicon.svg');
		Util::addHeader('link', ['rel' => 'icon', 'type' => 'image/svg+xml', 'href' => $icon]);
		return new TemplateResponse(Application::APP_ID, 'main');
	}
}
