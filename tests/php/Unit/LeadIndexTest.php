<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Service\ModuleService;
use OCA\Phos\Service\Sword\Conf;
use OCA\Phos\Service\Sword\LeadIndex;
use OCA\Phos\Service\Sword\LocalModuleFiles;
use OCA\Phos\Service\Sword\SwordModule;
use PHPUnit\Framework\TestCase;

/** Sermon books on a passage (start page, W-3-A follow-up). */
class LeadIndexTest extends TestCase {
	public function testRefPattern(): void {
		$re = LeadIndex::refPattern(['Römer', 'Röm', 'Rö'], 7);
		$this->assertSame(1, preg_match($re, 'Predigt über Römer 7, 22 - 23', $m));
		$this->assertSame('Römer 7, 22 - 23', $m[0]);
		$this->assertSame(1, preg_match($re, '(Röm. 7,14)'));
		$this->assertSame(0, preg_match($re, 'Römer 70'));
		$this->assertSame(0, preg_match($re, 'Römer 17,1'));
		$this->assertSame(0, preg_match($re, 'Rö 7'));         // too short to trust
		$gen = LeadIndex::refPattern(['1. Mose', 'Genesis'], 1);
		$this->assertSame(1, preg_match($gen, '1.Mose 1,1'));
		$this->assertSame(1, preg_match($gen, '1 Mose 1'));
		$this->assertSame(1, preg_match($gen, 'GENESIS 1:3'));
		$this->assertSame(0, preg_match($gen, '2. Mose 1'));
		$this->assertNull(LeadIndex::refPattern(['Rö'], 7));
	}

	public function testCitingEntries(): void {
		$root = __DIR__ . '/../../fixtures/sword';
		$m = new SwordModule(new Conf((string)file_get_contents("$root/mods.d/tinybook.conf")), new LocalModuleFiles($root), null, false);
		$ix = LeadIndex::fromString(LeadIndex::build($m));
		$this->assertSame([['path' => '/Teil Eins/Kapitel 2', 'ref' => 'Joh 3,16', 'lead' => 'Zweites Kapitel, siehe Joh 3,16.', 'picture' => '']],
			$ix->citing(['Johannes', 'Joh'], 3, 5));
		$this->assertSame([], $ix->citing(['Johannes', 'Joh'], 3, 5, true));   // no picture there
		$this->assertSame([], $ix->citing(['Johannes', 'Joh'], 4, 5));
	}

	public function testPicture(): void {
		$this->assertSame('images/bild.png', LeadIndex::picture('Text <figure src="images/bild.png"/>'));
		$this->assertSame('images/a.jpg', LeadIndex::picture("<img alt='x' src='images/a.jpg'>"));
		$this->assertSame('https://example.org/p/Jerusalem.JPG', LeadIndex::picture('<a href="https://example.org/p/Jerusalem.JPG">Bild</a>'));
		$this->assertSame('', LeadIndex::picture('<a href="https://example.org/">x</a>'));
		$this->assertTrue(ModuleService::looksLikeMedia('Maps', 'Calwer'));
		$this->assertTrue(ModuleService::looksLikeMedia('', 'EvangeliumsImages Bilder'));
		$this->assertFalse(ModuleService::looksLikeMedia('Generic Books', 'Spurgeon Andachten'));
	}

	public function testLooksLikeSermon(): void {
		$this->assertTrue(ModuleService::looksLikeSermon('AhlfeldPredigten Predigten Devotional Sermons, German.', SwordModule::GENBOOK));
		$this->assertTrue(ModuleService::looksLikeSermon('deuEvangeliumsSermon Andachten und Predigten', SwordModule::COMMENTARY));
		$this->assertFalse(ModuleService::looksLikeSermon('deuLange Theologisch-homiletisches Bibelwerk', SwordModule::COMMENTARY));
		$this->assertTrue(ModuleService::looksLikeSermon('deuLange Theologisch-homiletisches Bibelwerk', SwordModule::GENBOOK));
		$this->assertFalse(ModuleService::looksLikeSermon('KJV Predigt', SwordModule::BIBLE));
	}
}
