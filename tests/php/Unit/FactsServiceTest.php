<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Service\FactsService;
use PHPUnit\Framework\TestCase;

/**
 * The pure parts of Fakten/Facts on the web (Phase 3, Scope 1): OSIS range parsing, topic
 * resolution, and the two data files' formats. What needs ModuleService/IAppData (the Bible
 * text and dictionary lookups, the full `build()` payload) is covered end to end instead, by
 * tests/integration/facts.py against the real running app.
 */
class FactsServiceTest extends TestCase {
	public function testParseOsisSingleVerse(): void {
		$this->assertSame(['Gal', 5, 14, 5, 14], FactsService::parseOsis('Gal.5.14'));
	}

	public function testParseOsisWholeChapter(): void {
		$this->assertSame(['Gen', 1, PHP_INT_MAX, 1, PHP_INT_MAX], FactsService::parseOsis('Gen.1'));
	}

	public function testParseOsisVerseRangeWithinChapter(): void {
		$this->assertSame(['Gal', 5, 13, 5, 14], FactsService::parseOsis('Gal.5.13-Gal.5.14'));
	}

	public function testParseOsisChapterRange(): void {
		$this->assertSame(['Exod', 20, 1, 20, 26], FactsService::parseOsis('Exod.20.1-Exod.20.26'));
	}

	public function testParseOsisRangeAcrossBooksTakesTheStartBookToEnd(): void {
		// "a-b, different book": not a real topic-scores.txt shape, but parseOsis must not
		// invent a cross-book range -- it falls back to "from v1 to the end of c1".
		$this->assertSame(['John', 3, 16, 3, PHP_INT_MAX], FactsService::parseOsis('John.3.16-Acts.1.1'));
	}

	public function testParseOsisUnparseable(): void {
		$this->assertSame([null, 0, 0, 0, 0], FactsService::parseOsis('not an osis ref'));
	}

	public function testResolveKeyByEnglishKey(): void {
		$scores = ['love' => [['osis' => 'John.3.16', 'score' => 4]]];
		$this->assertSame('love', FactsService::resolveKey('Love', $scores, []));
	}

	public function testResolveKeyByTranslatedLabel(): void {
		$scores = ['love' => [['osis' => 'John.3.16', 'score' => 4]]];
		$titles = ['love' => 'Liebe'];
		$this->assertSame('love', FactsService::resolveKey('liebe', $scores, $titles));
		$this->assertSame('love', FactsService::resolveKey('LIEBE', $scores, $titles));
	}

	public function testResolveKeyUnknown(): void {
		$this->assertNull(FactsService::resolveKey('nonexistent', ['love' => []], ['love' => 'Liebe']));
	}

	/**
	 * "2012", "666", "911" are real topic-scores.txt keys -- PHP silently turns a purely-numeric
	 * string array key into an int (found the hard way: a 500 from topics() doing str_contains()
	 * on one, since array_keys() of such an array hands back a mix of strings and ints).
	 * resolveKey must still return a plain string either way.
	 */
	public function testResolveKeyOnANumericTopic(): void {
		$scores = ['2012' => [['osis' => 'Matt.24.36', 'score' => 1]]];
		$this->assertIsInt(array_keys($scores)[0]);   // the gotcha itself, documented
		$this->assertSame('2012', FactsService::resolveKey('2012', $scores, []));
		$this->assertSame('2012', FactsService::resolveKey('Mayan calendar', $scores, ['2012' => 'Mayan calendar']));
	}

	public function testParseScoresFile(): void {
		$path = $this->tmpFile("Topic\tOSIS\tScore\nlove\tJohn.3.16\t4\nlove\t1Cor.13.4-1Cor.13.8\t8\nabraham\tGen.12.1-Gen.12.20\t3\n");
		$scores = FactsService::parseScoresFile($path);
		$this->assertSame([
			['osis' => 'John.3.16', 'score' => 4],
			['osis' => '1Cor.13.4-1Cor.13.8', 'score' => 8],
		], $scores['love']);
		$this->assertSame([['osis' => 'Gen.12.1-Gen.12.20', 'score' => 3]], $scores['abraham']);
	}

	public function testParseScoresFileIgnoresBlankAndShortLines(): void {
		$path = $this->tmpFile("Topic\tOSIS\tScore\n\nlove\tJohn.3.16\t4\nbroken-line-only-one-column\n");
		$scores = FactsService::parseScoresFile($path);
		$this->assertSame(['love'], array_keys($scores));
	}

	public function testParseTitlesFile(): void {
		$path = $this->tmpFile("# a comment\nlove|Liebe\nabraham|Abraham\n\n");
		$titles = FactsService::parseTitlesFile($path);
		$this->assertSame(['love' => 'Liebe', 'abraham' => 'Abraham'], $titles);
	}

	private function tmpFile(string $content): string {
		$path = tempnam(sys_get_temp_dir(), 'phos-facts-test-');
		file_put_contents($path, $content);
		register_shutdown_function('unlink', $path);
		return $path;
	}
}
