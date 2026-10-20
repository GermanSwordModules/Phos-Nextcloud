<?php

declare(strict_types=1);

namespace OCA\Phos\Controller;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Phone remote for a deck shown in the web (W-6, docs/protocol.md §13).
 *
 * The desktop runs a LAN server for this (BVC unit_presremote); in the web
 * both ends are browsers of the same Nextcloud user, so the server relays:
 * the presenting page publishes its state (slide, notes, slide list), the
 * phone posts commands, each side polls the other. Per user, nothing shared:
 * the phone must be logged in as the same user. Kept in the user's
 * preferences — two small JSON values, no table, no cache backend needed.
 */
class RemoteController extends OCSController {
	private const MAX_STATE = 65536;
	private const ACTIONS = ['next', 'prev', 'first', 'last', 'goto', 'black'];

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $session,
		private IConfig $config,
	) {
		parent::__construct($appName, $request);
	}

	private function uid(): string {
		return $this->session->getUser()->getUID();
	}

	private function body(): array {
		$raw = file_get_contents('php://input');
		$b = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
		return is_array($b) ? $b : [];
	}

	private function read(string $key): ?array {
		$v = json_decode($this->config->getUserValue($this->uid(), 'phos', $key, ''), true);
		return is_array($v) ? $v : null;
	}

	private static function nowMs(): int {
		return (int)floor(microtime(true) * 1000);
	}

	/** Both halves; `now` lets clients judge age without trusting their own clock. */
	#[NoAdminRequired]
	public function get(): DataResponse {
		return new DataResponse([
			'cmd' => $this->read('remote_cmd'),
			'state' => $this->read('remote_state'),
			'now' => self::nowMs(),
		]);
	}

	/** From the phone: {action: next|prev|first|last|goto|black, slide?: n}. */
	#[NoAdminRequired]
	public function command(): DataResponse {
		$b = $this->body();
		$action = (string)($b['action'] ?? '');
		if (!in_array($action, self::ACTIONS, true)) {
			return new DataResponse(['error' => 'unknown action'], Http::STATUS_BAD_REQUEST);
		}
		$seq = (int)($this->read('remote_cmd')['seq'] ?? 0) + 1;
		$cmd = ['seq' => $seq, 'action' => $action, 'slide' => max(0, (int)($b['slide'] ?? 0)), 'at' => self::nowMs()];
		$this->config->setUserValue($this->uid(), 'phos', 'remote_cmd', json_encode($cmd));
		return new DataResponse($cmd);
	}

	/** From the presenting page: what is on the screen; {} or null when it stops. */
	#[NoAdminRequired]
	public function state(): DataResponse {
		$b = $this->body();
		if (!$b) {
			$this->config->deleteUserValue($this->uid(), 'phos', 'remote_state');
			return new DataResponse(['state' => null]);
		}
		$state = [
			'deck' => mb_substr((string)($b['deck'] ?? ''), 0, 200),
			'title' => mb_substr((string)($b['title'] ?? ''), 0, 500),
			'idx' => max(0, (int)($b['idx'] ?? 0)),
			'total' => max(0, (int)($b['total'] ?? 0)),
			'black' => (bool)($b['black'] ?? false),
			'notes' => mb_substr((string)($b['notes'] ?? ''), 0, 20000),
			'slides' => array_slice(array_map(fn ($s) => mb_substr((string)$s, 0, 200), (array)($b['slides'] ?? [])), 0, 500),
			'at' => self::nowMs(),
		];
		$json = json_encode($state);
		if (strlen($json) > self::MAX_STATE) {
			$state['notes'] = '';
			$json = json_encode($state);
		}
		$this->config->setUserValue($this->uid(), 'phos', 'remote_state', $json);
		return new DataResponse(['state' => $state]);
	}
}
