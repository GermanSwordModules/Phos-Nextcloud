<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Service\Sword\Conf;
use OCA\Phos\Service\Sword\LocalModuleFiles;
use OCA\Phos\Service\Sword\SearchIndex;
use OCA\Phos\Service\Sword\SwordModule;
use PHPUnit\Framework\TestCase;

/** Full-text index (W-4) over the fixture Bible. */
class SearchIndexTest extends TestCase {
	private static ?SearchIndex $ix = null;

	private static function ix(): SearchIndex {
		if (self::$ix === null) {
			$root = __DIR__ . '/../../fixtures/sword';
			$m = new SwordModule(new Conf((string)file_get_contents("$root/mods.d/tinyz.conf")), new LocalModuleFiles($root), null, false);
			self::$ix = SearchIndex::fromString(SearchIndex::build($m));
		}
		return self::$ix;
	}

	/** @return list<string> "Book.c.v" of the hits (book as index) */
	private static function refs(string $q, string $mode = 'all', ?array $books = null): array {
		$r = self::ix()->find($q, $mode, $books);
		return array_map(fn ($p) => implode('.', self::ix()->verseAt($p)), $r['positions']);
	}

	public function testWords(): void {
		$this->assertSame(['0.1.1'], self::refs('beginning'));
		$this->assertSame(['0.1.1'], self::refs('GOD created'));
		$this->assertSame(['0.1.1', '0.1.3', '42.3.16', '42.3.17'], self::refs('god'));
		$this->assertSame(['0.1.1', '0.1.3', '42.3.16', '42.3.17', '65.22.21'], self::refs('god amen', 'any'));
		$this->assertSame(['0.1.3'], self::refs('god -created -loved -sent'));
		// notes are not verse text
		$this->assertSame([], self::refs('upon face deep or'));
		$this->assertSame(['0.1.2'], self::refs('upon face deep'));
	}

	public function testPhrasePrefixDiacritics(): void {
		$this->assertSame(['42.3.16'], self::refs('"so loved the world"'));
		$this->assertSame([], self::refs('"the world loved"'));
		$this->assertSame(['42.3.16'], self::refs('"only beg*"'));
		$this->assertSame(['0.1.1', '0.1.2'], self::refs('ear*'));
		// diacritics fold, ß = ss
		$this->assertSame(['42.3.16'], self::refs('grosste'));
		$this->assertSame(['42.3.16'], self::refs('GRÖSSTE'));
		$this->assertSame(['42.3.16'], self::refs('größte'));
	}

	public function testStrongsAndScope(): void {
		$this->assertSame(['0.1.1'], self::refs('H430'));
		$this->assertSame(['0.1.1'], self::refs('h0430'));
		$this->assertSame(['0.1.1'], self::refs('strong:H07225 god'));
		$this->assertSame(['42.3.16', '42.3.17'], self::refs('god', 'all', [42]));
		$this->assertSame([], self::refs('god', 'all', [1, 2]));
		$r = self::ix()->find('"only begotten" god*');
		$this->assertSame(['god*', 'only', 'begotten'], $r['terms']);
	}

	public function testParseErrors(): void {
		$this->assertSame('empty query', SearchIndex::parse('  ')['error']);
		$this->assertSame('empty query', SearchIndex::parse('-god')['error']);
		$this->assertSame('prefix too short', SearchIndex::parse('g*')['error']);
	}

	public function testPlain(): void {
		[$t, $l] = SearchIndex::plain('<title>Head</title><w lemma="strong:G0026 lemma.TR:agape">love</w> <note n="a">x</note>is<lb/>kind', 'OSIS');
		$this->assertSame('love is kind', $t);
		$this->assertSame(['G26'], $l);
		[$t, $l] = SearchIndex::plain('In the beginning<WH07225> God<WH0430>', 'GBF');
		$this->assertSame('In the beginning God', $t);
		$this->assertSame(['H7225', 'H430'], $l);
		[, $l] = SearchIndex::plain('love<sync type="Strongs" value="G25" />', 'ThML');
		$this->assertSame(['G25'], $l);
	}
}
