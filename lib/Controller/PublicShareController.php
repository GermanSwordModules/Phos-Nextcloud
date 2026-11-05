<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCA\Phos\AppInfo\Application;
use OCA\Phos\Sync\RecordStore;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\NotFoundResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

/**
 * Anonymous read-only view of a collection shared via "Öffentlichen Link
 * erstellen" (docs/crosswire-checklist-offene-punkte.md Tier 1 #5 —
 * "mit der Gemeinde teilen, die nicht alle einen Nextcloud-Zugang haben").
 *
 * Deliberately its OWN, fully separate rendering path — not a public mode of
 * the authenticated SPA (src/, served by PageController). Teaching every OCS
 * endpoint a token-based auth path alongside Nextcloud session auth would be
 * a much bigger and much riskier surface to open up (every endpoint that
 * forgets the check becomes an anonymous data leak); this controller instead
 * has exactly one entry point, reads nothing but RecordStore::changesSince
 * (read-only, already used everywhere) and CollectionService's
 * token→collection resolution, and has no write path reachable at all.
 *
 * Only a hand-picked allow-list of "content" record types is shown
 * (self::KNOWN) — internal/app-state types (settings, workspaces, reading
 * positions, …) are silently skipped rather than guessed at, and rich-text
 * (RTF) fields are never included: both are about not leaking more than the
 * admin meant to share, not about completeness.
 */
class PublicShareController extends Controller {
	/** type => [label, title field or null, prose field(s) to show]. Anything
	 *  not listed here simply never appears on the public page. */
	private const KNOWN = [
		'bookmark' => ['Lesezeichen', null, ['noteMd']],
		'note' => ['Notiz', 'title', ['text']],
		'sermon' => ['Predigt', 'title', ['main_idea', 'goal', 'audience', 'intro', 'conclusion']],
		'project' => ['Studienprojekt', 'title', []],
		'projectDoc' => ['Studiendokument', 'title', ['text']],
		'biblioEntry' => ['Literaturangabe', 'title', []],
	];

	public function __construct(
		string $appName,
		IRequest $request,
		private RecordStore $store,
	) {
		parent::__construct($appName, $request);
	}

	private static function str(mixed $v): string {
		return is_string($v) ? $v : '';
	}

	/** One payload → the template's per-item shape, or null to skip it
	 *  (unknown type, or a known type with nothing to show). */
	private function renderItem(string $type, string $key, mixed $payload): ?array {
		$known = self::KNOWN[$type] ?? null;
		if ($known === null || !($payload instanceof \stdClass)) {
			return null;
		}
		[$label, $titleField, $textFields] = $known;
		$title = $titleField !== null ? self::str($payload->{$titleField} ?? '') : '';
		if ($title === '') {
			$title = $key;
		}
		$paras = [];
		foreach ($textFields as $f) {
			$t = trim(self::str($payload->{$f} ?? ''));
			if ($t !== '') {
				$paras[] = $t;
			}
		}
		if ($paras === [] && $titleField === null) {
			return null;   // e.g. a bookmark with no note — nothing worth showing
		}
		return ['type' => $type, 'typeLabel' => $label, 'title' => $title, 'paragraphs' => $paras];
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function view(string $token): Response {
		$collId = $this->store->collectionForToken($token);
		if ($collId === null) {
			return new NotFoundResponse();
		}
		$coll = $this->store->getCollection($collId);
		if ($coll === null) {
			return new NotFoundResponse();
		}

		$items = [];
		foreach ($this->store->changesSince([$collId], 0, 5000, null) as $r) {
			if ($r->deleted) {
				continue;
			}
			$item = $this->renderItem($r->type, $r->key, $r->payload);
			if ($item !== null) {
				$items[] = $item;
			}
		}

		$response = new TemplateResponse(Application::APP_ID, 'public_share', [
			'collectionName' => $coll['name'] ?? 'Phos',
			'items' => $items,
		], TemplateResponse::RENDER_AS_BASE);
		return $response;
	}
}
