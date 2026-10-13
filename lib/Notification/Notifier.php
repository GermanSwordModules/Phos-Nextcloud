<?php

declare(strict_types=1);

namespace OCA\Phos\Notification;

use OCA\Phos\AppInfo\Application;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Notification\INotification;
use OCP\Notification\INotifier;
use OCP\Notification\UnknownNotificationException;

/** Renders "X shared „Y“ with you" (docs/protocol.md §11). */
class Notifier implements INotifier {
	public function __construct(
		private IFactory $l10nFactory,
		private IUserManager $users,
		private IURLGenerator $url,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l10nFactory->get(Application::APP_ID)->t('Phos');
	}

	public function prepare(INotification $notification, string $languageCode): INotification {
		if ($notification->getApp() !== Application::APP_ID || $notification->getSubject() !== 'shared') {
			throw new UnknownNotificationException();
		}
		$l = $this->l10nFactory->get(Application::APP_ID, $languageCode);
		$p = $notification->getSubjectParameters();
		$actor = (string)($p['actor'] ?? '');
		$actorName = $this->users->getDisplayName($actor) ?? $actor;
		$name = (string)($p['name'] ?? '');
		$notification->setRichSubject($l->t('{user} shared „{collection}“ with you in Phos'), [
			'user' => ['type' => 'user', 'id' => $actor, 'name' => $actorName],
			'collection' => ['type' => 'highlight', 'id' => $notification->getObjectId(), 'name' => $name],
		]);
		$notification->setParsedSubject(str_replace(['{user}', '{collection}'], [$actorName, $name],
			$l->t('{user} shared „{collection}“ with you in Phos')));
		$notification->setRichMessage($l->t('It arrives with the next sync of your Phos devices.'));
		$notification->setParsedMessage($l->t('It arrives with the next sync of your Phos devices.'));
		$notification->setIcon($this->url->getAbsoluteURL($this->url->imagePath(Application::APP_ID, 'app-dark.svg')));
		return $notification;
	}
}
