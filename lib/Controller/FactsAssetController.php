<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\IRequest;

/**
 * Serves BVC's `web/facts/` bundle (facts.html/css/js, charts.js, maps.json, maps/*.jpg) --
 * this app's own static asset, copied in verbatim by dev/sync-facts-assets.js, never files a
 * user uploaded. That is what makes it safe to serve inline (unlike FilesController, which
 * deliberately never serves HTML/JS from user storage inline -- see its SAFE_TYPES comment):
 * these bytes are the app's own code, at the same trust level as its built js/*.mjs.
 */
class FactsAssetController extends Controller {
	private const TYPES = [
		'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8',
		'js' => 'application/javascript; charset=utf-8', 'json' => 'application/json',
		'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
		'md' => 'text/plain; charset=utf-8',
	];

	private string $root;

	public function __construct(string $appName, IRequest $request) {
		parent::__construct($appName, $request);
		$this->root = realpath(__DIR__ . '/../../facts-bundle');
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(string $path) {
		$full = $this->root !== false ? realpath($this->root . '/' . $path) : false;
		if ($full === false || !str_starts_with($full, $this->root . DIRECTORY_SEPARATOR) || !is_file($full)) {
			return new DataResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		$ext = strtolower(pathinfo($full, PATHINFO_EXTENSION));
		$type = self::TYPES[$ext] ?? null;
		if ($type === null) {
			return new DataResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		$resp = new StreamResponse(fopen($full, 'rb'));
		$resp->addHeader('Content-Type', $type);
		$resp->addHeader('Content-Length', (string)filesize($full));
		$resp->cacheFor(3600);
		return $resp;
	}
}
