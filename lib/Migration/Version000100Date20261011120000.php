<?php

declare(strict_types=1);

namespace OCA\Phos\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Initial schema: collections, records + history, rev sequence, push log, devices, conflicts. */
class Version000100Date20261011120000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('phos_collections')) {
			$t = $schema->createTable('phos_collections');
			$t->addColumn('id', Types::STRING, ['notnull' => true, 'length' => 36]);
			$t->addColumn('owner', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('kind', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('name', Types::STRING, ['notnull' => false, 'length' => 255]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['owner'], 'phos_coll_owner');
		}

		if (!$schema->hasTable('phos_records')) {
			$t = $schema->createTable('phos_records');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('coll', Types::STRING, ['notnull' => true, 'length' => 36]);
			$t->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('rkey', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('rev', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('hlc', Types::STRING, ['notnull' => true, 'length' => 40]);
			$t->addColumn('device', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('deleted', Types::SMALLINT, ['notnull' => true, 'default' => 0]);
			$t->addColumn('payload', Types::TEXT, ['notnull' => false]);
			$t->addColumn('updated_by', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('updated_at', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['coll', 'type', 'rkey'], 'phos_rec_key');
			$t->addIndex(['coll', 'rev'], 'phos_rec_rev');
			$t->addIndex(['deleted', 'updated_at'], 'phos_rec_tomb');
		}

		if (!$schema->hasTable('phos_history')) {
			$t = $schema->createTable('phos_history');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('record_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('rev', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('hlc', Types::STRING, ['notnull' => true, 'length' => 40]);
			$t->addColumn('device', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('deleted', Types::SMALLINT, ['notnull' => true, 'default' => 0]);
			$t->addColumn('payload', Types::TEXT, ['notnull' => false]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['record_id', 'rev'], 'phos_hist_rec');
		}

		// One row per write; its autoincrement id is the global rev.
		if (!$schema->hasTable('phos_seq')) {
			$t = $schema->createTable('phos_seq');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('record_id', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
		}

		if (!$schema->hasTable('phos_pushlog')) {
			$t = $schema->createTable('phos_pushlog');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('change_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('coll', Types::STRING, ['notnull' => true, 'length' => 36]);
			$t->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('rkey', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('status', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('conflict_id', Types::BIGINT, ['notnull' => false]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['uid', 'change_id'], 'phos_push_change');
			$t->addIndex(['created'], 'phos_push_created');
		}

		if (!$schema->hasTable('phos_devices')) {
			$t = $schema->createTable('phos_devices');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('device_id', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('name', Types::STRING, ['notnull' => false, 'length' => 255]);
			$t->addColumn('platform', Types::STRING, ['notnull' => false, 'length' => 32]);
			$t->addColumn('app_version', Types::STRING, ['notnull' => false, 'length' => 32]);
			$t->addColumn('last_seen', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->addColumn('last_cursor', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['uid', 'device_id'], 'phos_dev_uid');
		}

		if (!$schema->hasTable('phos_conflicts')) {
			$t = $schema->createTable('phos_conflicts');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('coll', Types::STRING, ['notnull' => true, 'length' => 36]);
			$t->addColumn('type', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('rkey', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('hlc', Types::STRING, ['notnull' => true, 'length' => 40]);
			$t->addColumn('device', Types::STRING, ['notnull' => true, 'length' => 16]);
			$t->addColumn('payload', Types::TEXT, ['notnull' => false]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('resolved', Types::SMALLINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['coll', 'resolved'], 'phos_confl_coll');
		}

		return $schema;
	}
}
