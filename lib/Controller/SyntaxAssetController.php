<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\AppFramework\Http\StreamResponse;
use OCP\IRequest;

/**
 * Serves BVC's `web/syntax/` bundle (syntax.html/css/js) -- this app's own static asset, copied
 * in verbatim by dev/sync-syntax-assets.js, never a file a user uploaded. See
 * FactsAssetController, which this mirrors: that is what makes it safe to serve inline.
 */
class SyntaxAssetController extends Controller {
	private const TYPES = [
		'html' => 'text/html; charset=utf-8', 'css' => 'text/css; charset=utf-8',
		'js' => 'application/javascript; charset=utf-8',
	];

	private string $root;

	public function __construct(string $appName, IRequest $request) {
		parent::__construct($appName, $request);
		$this->root = realpath(__DIR__ . '/../../syntax-bundle');
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
		// StreamResponse defaults to frame-ancestors 'none' (EmptyContentSecurityPolicy::buildPolicy);
		// SyntaxDiagramPanel.vue embeds syntax.html in an <iframe> from this same app/origin.
		// EmptyContentSecurityPolicy (not the OCP ContentSecurityPolicy subclass) makes CSPMiddleware
		// skip merging in the app's own default policy and nonce -- syntax.html's inline bootstrap
		// script has no nonce, so merging would block it regardless of 'unsafe-inline' here.
		$csp = new EmptyContentSecurityPolicy();
		$csp->addAllowedFrameAncestorDomain("'self'");
		$csp->addAllowedScriptDomain("'self'");
		$csp->addAllowedScriptDomain("'unsafe-inline'");
		$csp->addAllowedStyleDomain("'self'");
		$resp->setContentSecurityPolicy($csp);
		return $resp;
	}
}
