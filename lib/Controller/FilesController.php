<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\Sync\RecordStore;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Files of a shared collection for its members (docs/protocol.md §11).
 *
 * The files stay in the owner's storage below Phos/. A member may read a
 * file only when it belongs to a live record of the collection:
 *   Module/<set>/…, E-Books/<set>/…, Praesentationen/<set>/…  → a module /
 *   ebook / presAssets record with key <type>:<set> in that collection;
 *   .records/…  → a record of the collection whose payload names the file.
 * Nothing else of the owner's Phos/ folder is reachable.
 */
class FilesController extends Controller {
	private const AREAS = ['Module' => 'module', 'E-Books' => 'ebook', 'Praesentationen' => 'presAssets'];

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private RecordStore $store,
		private IRootFolder $root,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(string $collection, string $path) {
		$uid = $this->session->getUser()?->getUID();
		if ($uid === null || !in_array($collection, $this->store->readableCollections($uid), true)) {
			return new DataResponse(['error' => 'no access'], Http::STATUS_FORBIDDEN);
		}
		$info = $this->store->getCollection($collection);
		$parts = explode('/', $path);
		if ($info === null || in_array('..', $parts, true) || in_array('', $parts, true) || count($parts) < 2) {
			return new DataResponse(['error' => 'bad path'], Http::STATUS_BAD_REQUEST);
		}
		$allowed = false;
		if (isset(self::AREAS[$parts[0]]) && count($parts) >= 3) {
			$rec = $this->store->find($collection, self::AREAS[$parts[0]], self::AREAS[$parts[0]] . ':' . $parts[1]);
			$allowed = $rec !== null && !$rec->deleted;
		} elseif ($parts[0] === '.records') {
			$allowed = $this->store->payloadMentions($collection, 'Phos/' . $path);
		}
		if (!$allowed) {
			return new DataResponse(['error' => 'not part of this collection'], Http::STATUS_FORBIDDEN);
		}
		try {
			$node = $this->root->getUserFolder($info['owner'])->get('Phos/' . $path);
		} catch (\Throwable) {
			return new DataResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		if (!$node instanceof File) {
			return new DataResponse(['error' => 'not a file'], Http::STATUS_NOT_FOUND);
		}
		$resp = new StreamResponse($node->fopen('rb'));
		$resp->addHeader('Content-Type', 'application/octet-stream');
		$resp->addHeader('Content-Length', (string)$node->getSize());
		return $resp;
	}
}
