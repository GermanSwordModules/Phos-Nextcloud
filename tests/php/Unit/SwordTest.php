<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Service\Sword\Conf;
use OCA\Phos\Service\Sword\LexStore;
use OCA\Phos\Service\Sword\LocalModuleFiles;
use OCA\Phos\Service\Sword\Sapphire;
use OCA\Phos\Service\Sword\SwordModule;
use OCA\Phos\Service\Sword\Versification;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * PHP SWORD reader against modules written by libsword's osis2mod/imp2ld
 * (tests/fixtures/sword/build.sh). The same reader was compared entry by
 * entry with mod2imp on real modules (dev/sword_dump.php).
 */
class SwordTest extends TestCase {
	private const ROOT = __DIR__ . '/../../fixtures/sword';

	private static function module(string $conf, ?string $key = null, bool $cipherFlag = false): SwordModule {
		return new SwordModule(new Conf((string)file_get_contents(self::ROOT . "/mods.d/$conf.conf")),
			new LocalModuleFiles(self::ROOT), $key, $cipherFlag);
	}

	public static function bibles(): array {
		return [['tinyz', null], ['tinyz4', null], ['tinyraw', null], ['tinyraw4', null], ['tinyzc', 'Fixture-Key-1']];
	}

	#[DataProvider('bibles')]
	public function testChapter(string $conf, ?string $key): void {
		$m = self::module($conf, $key, $key !== null);
		$this->assertSame(SwordModule::BIBLE, $m->kind);
		$this->assertFalse($m->locked());
		$c = $m->chapter('Gen', 1);
		$this->assertStringContainsString('<title type="main">GENESIS</title>', $c['bookIntro']);
		$this->assertStringContainsString('The Creation', $c['intro']);
		$this->assertCount(31, $c['verses']);
		$this->assertSame('<w lemma="strong:H07225">In the beginning</w> <w lemma="strong:H0430">God</w> created the heaven and the earth.', $c['verses'][1]);
		$this->assertStringContainsString('<note n="a" type="study">Or, upon the face of the deep.</note>', $c['verses'][2]);
		$this->assertSame('', $c['verses'][4]);

		$j = $m->chapter('John', 3);
		$this->assertStringContainsString('<q marker="" who="Jesus">For God so loved the world', $j['verses'][16]);
		$this->assertStringContainsString('(größte Liebe)', $j['verses'][16]);
		// one entry for two verses: 18 is linked to 17
		$this->assertSame([18 => 17], $j['links']);
		$this->assertSame($j['verses'][17], $j['verses'][18]);
		$this->assertSame('', $j['bookIntro']);

		$this->assertStringStartsWith('The grace of our Lord Jesus Christ be with you all. Amen. <chapter eID=', $m->chapter('Rev', 22)['verses'][21]);
		$this->assertCount(66, $m->books());
	}

	public function testCipheredWithoutKeyIsLocked(): void {
		$m = self::module('tinyzc', null, true);
		$this->assertTrue($m->locked());
		$this->expectExceptionMessage('locked');
		$m->chapter('Gen', 1);
	}

	public function testWrongKeyFails(): void {
		$this->expectExceptionMessage('cannot decompress');
		self::module('tinyzc', 'wrong', true)->chapter('Gen', 1);
	}

	public static function lexicons(): array {
		return [['tinylex_rawld'], ['tinylex_rawld4'], ['tinylex_zld']];
	}

	#[DataProvider('lexicons')]
	public function testLexicon(string $conf): void {
		$m = self::module($conf);
		$this->assertSame(SwordModule::DICTIONARY, $m->kind);
		$this->assertSame('<entry>agapao: to love</entry>', $m->dictEntry('G25'));
		$this->assertSame('<entry>agapao: to love</entry>', $m->dictEntry('G0025'));
		$this->assertSame('<entry>elohim: God</entry>', $m->dictEntry('h430'));
		$this->assertSame('Father of Isaac.', $m->dictEntry('abram'));   // @LINK
		$this->assertNull($m->dictEntry('Moses'));
		$this->assertNull($m->dictEntry('G27'));
		$this->assertSame(['ABRAHAM', 'ABRAM', 'G0025'], $m->dictKeys('ab', 3));
		$this->assertSame(['ZION'], $m->dictKeys('Y', 5));
	}

	public function testStrongsPad(): void {
		$this->assertSame('G0025', LexStore::strongsPad('G25'));
		$this->assertSame('00025', LexStore::strongsPad('25'));
		$this->assertSame('H0430A', LexStore::strongsPad('H430a'));
		$this->assertSame('H0430!A', LexStore::strongsPad('H430!a'));
		$this->assertSame('Abraham', LexStore::strongsPad('Abraham'));
	}

	public function testVersificationIndex(): void {
		$kjv = Versification::get('KJV');
		$gen = $kjv->bookIndex('Gen');
		$this->assertSame([1, 4], $kjv->locate($gen, 1, 1));   // module, testament, book, chapter headings first
		$this->assertSame([1, 2], $kjv->locate($gen, 0, 0));
		$this->assertSame([2, 4], $kjv->locate($kjv->bookIndex('Matt'), 1, 1));
		$this->assertNull($kjv->locate($gen, 1, 32));
		$this->assertNull($kjv->locate($gen, 51, 1));
		$lu = Versification::get('Luther');
		$this->assertSame(76, count($lu->books));
		$this->assertSame('KJV', Versification::get('NoSuchSystem')->name);
	}

	public function testPersonalizedKeyPassesThrough(): void {
		$this->assertSame('Fixture-Key-1', Sapphire::personalize('Fixture-Key-1'));
	}

	public function testReadingPlan(): void {
		$m = self::module('tinyplan');
		$this->assertTrue($m->info()['readingPlan']);
		$p = $m->readingPlan();
		$this->assertFalse($p['dateBased']);
		$this->assertSame([1, 2], array_column($p['days'], 'day'));
		$this->assertSame(['Gen.1', 'John.3.16-John.3.17'], $p['days'][0]['passages']);
		$this->assertSame(['Rev.22.21', 'Gen.1.1'], $p['days'][1]['passages']);
		$this->assertSame(['Rev.22.21', 'Zum Nachdenken.', 'Gen.1.1'], $p['days'][1]['seq']);
		$dated = \OCA\Phos\Service\Sword\ReadingPlan::parse("1=Jan-1;Jes.7.4;Luke.4.18-Luke.4.21\n2=Jan-2;Ps.54.8\n", false);
		$this->assertTrue($dated['dateBased']);
		$this->assertSame('Jan-1', $dated['days'][0]['date']);
		$this->assertSame(['Jes.7.4', 'Luke.4.18-Luke.4.21'], $dated['days'][0]['passages']);
		$this->assertNull(self::module('tinyz')->readingPlan());
	}

	public function testConfContinuationAndRepeats(): void {
		$c = new Conf("[Mod]\nAbout=line one\\\nline two\nFeature=StrongsNumbers\nFeature=GreekDef\nDataPath=./modules/x/\n");
		$this->assertSame('Mod', $c->name);
		$this->assertSame("line one\nline two", $c->get('About'));
		$this->assertSame(['StrongsNumbers', 'GreekDef'], $c->all('Feature'));
		$this->assertSame('modules/x/', $c->dataPath());
	}
}
