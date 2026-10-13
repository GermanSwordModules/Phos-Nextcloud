<?php

declare(strict_types=1);

namespace OCA\Phos\AppInfo;

use OCA\Phos\Db\DbRecordStore;
use OCA\Phos\Notification\Notifier;
use OCA\Phos\Sync\Clock;
use OCA\Phos\Sync\CollectionService;
use OCA\Phos\Sync\RecordStore;
use OCA\Phos\Sync\SyncService;
use OCA\Phos\Sync\TypeRegistry;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use Psr\Container\ContainerInterface;

class Application extends App implements IBootstrap {
	public const APP_ID = 'phos';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerService(TypeRegistry::class, fn () => new TypeRegistry());
		$context->registerService(Clock::class, fn () => new Clock());
		$context->registerServiceAlias(RecordStore::class, DbRecordStore::class);
		$context->registerService(SyncService::class, fn (ContainerInterface $c) => new SyncService(
			$c->get(RecordStore::class), $c->get(TypeRegistry::class), $c->get(Clock::class)));
		$context->registerService(CollectionService::class, fn (ContainerInterface $c) => new CollectionService(
			$c->get(RecordStore::class)));
		$context->registerNotifierService(Notifier::class);
	}

	public function boot(IBootContext $context): void {
	}
}
