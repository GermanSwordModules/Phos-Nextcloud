<?php

declare(strict_types=1);

namespace OCA\Phos\Notification;

use OCA\Phos\AppInfo\Application;
use OCP\IGroupManager;
use OCP\Notification\IManager;
use OCP\Teams\ITeamManager;
use Psr\Log\LoggerInterface;

/** Tells new members of a shared collection about it; never fails the share. */
class ShareNotifier {
	public function __construct(
		private IManager $notifications,
		private IGroupManager $groups,
		private ITeamManager $teams,
		private LoggerInterface $logger,
	) {
	}

	/** @return list<string> user ids a principal stands for */
	private function recipients(string $ptype, string $pid): array {
		if ($ptype === 'user') {
			return [$pid];
		}
		if ($ptype === 'group') {
			return array_map(fn ($u) => $u->getUID(), $this->groups->get($pid)?->getUsers() ?? []);
		}
		try {
			// Teams: member listing exists only in newer Nextcloud versions
			if ($this->teams->hasTeamSupport() && method_exists($this->teams, 'getMembersOfTeam')) {
				return array_values(array_map('strval', $this->teams->getMembersOfTeam($pid, '')));
			}
		} catch (\Throwable) {
		}
		return [];
	}

	public function shared(string $actor, array $collection, string $ptype, string $pid): void {
		try {
			$time = new \DateTime();
			foreach (array_unique($this->recipients($ptype, $pid)) as $uid) {
				if ($uid === $actor || $uid === $collection['owner']) {
					continue;
				}
				$n = $this->notifications->createNotification();
				$n->setApp(Application::APP_ID)
					->setUser($uid)
					->setDateTime($time)
					->setObject('collection', (string)$collection['id'])
					->setSubject('shared', ['actor' => $actor, 'name' => (string)($collection['name'] ?? '')]);
				$this->notifications->notify($n);
			}
		} catch (\Throwable $e) {
			$this->logger->warning('phos: share notification failed', ['exception' => $e]);
		}
	}

	/** access ended: the old notification no longer applies */
	public function revoked(string $collectionId, ?string $uid = null): void {
		try {
			$n = $this->notifications->createNotification();
			$n->setApp(Application::APP_ID)->setObject('collection', $collectionId);
			if ($uid !== null) {
				$n->setUser($uid);
			}
			$this->notifications->markProcessed($n);
		} catch (\Throwable $e) {
			$this->logger->warning('phos: clearing share notification failed', ['exception' => $e]);
		}
	}
}
