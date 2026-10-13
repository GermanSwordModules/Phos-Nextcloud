<?php

declare(strict_types=1);

namespace OCA\Phos\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Sharing (phase 2): members of shared collections. */
class Version000200Date20261013150000 extends SimpleMigrationStep {
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if (!$schema->hasTable('phos_members')) {
			$t = $schema->createTable('phos_members');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('coll', Types::STRING, ['notnull' => true, 'length' => 36]);
			// user | group | team
			$t->addColumn('ptype', Types::STRING, ['notnull' => true, 'length' => 8]);
			$t->addColumn('pid', Types::STRING, ['notnull' => true, 'length' => 255]);
			// read | write | admin
			$t->addColumn('perm', Types::STRING, ['notnull' => true, 'length' => 8]);
			// journal rev when access was granted: clients whose cursor is older
			// fetch the whole collection
			$t->addColumn('since', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->addColumn('created', Types::BIGINT, ['notnull' => true, 'default' => 0]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['coll', 'ptype', 'pid'], 'phos_mem_unique');
			$t->addIndex(['ptype', 'pid'], 'phos_mem_principal');
		}
		return $schema;
	}
}
