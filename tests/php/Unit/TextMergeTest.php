<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Sync\TextMerge;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class TextMergeTest extends TestCase {
	public static function cases(): array {
		$base = "eins\nzwei\ndrei\nvier\nfünf";
		return [
			'only mine changed' => [$base, "eins\nZWEI\ndrei\nvier\nfünf", $base, "eins\nZWEI\ndrei\nvier\nfünf"],
			'only theirs changed' => [$base, $base, "eins\nzwei\ndrei\nvier\nFÜNF", "eins\nzwei\ndrei\nvier\nFÜNF"],
			'disjoint edits' => [$base, "EINS\nzwei\ndrei\nvier\nfünf", "eins\nzwei\ndrei\nvier\nFÜNF", "EINS\nzwei\ndrei\nvier\nFÜNF"],
			'insert + delete apart' => [$base, "eins\nneu\nzwei\ndrei\nvier\nfünf", "eins\nzwei\ndrei\nfünf", "eins\nneu\nzwei\ndrei\nfünf"],
			'same edit both' => [$base, "eins\nZWEI\ndrei\nvier\nfünf", "eins\nZWEI\ndrei\nvier\nfünf", "eins\nZWEI\ndrei\nvier\nfünf"],
			'same line differently' => [$base, "eins\nzwo\ndrei\nvier\nfünf", "eins\nZWEI\ndrei\nvier\nfünf", null],
			'adjacent lines conflict' => [$base, "eins\nZWEI\ndrei\nvier\nfünf", "eins\nzwei\nDREI\nvier\nfünf", null],
			'both append differently' => [$base, $base . "\nsechs", $base . "\nsieben", null],
			'empty base, one side' => ['', 'neu', '', 'neu'],
			'unicode lines' => ["α\nβ\nγ\nδ", "α\nβ'\nγ\nδ", "α\nβ\nγ\nδ'", "α\nβ'\nγ\nδ'"],
		];
	}

	#[DataProvider('cases')]
	public function testMerge(string $base, string $mine, string $theirs, ?string $expected): void {
		$this->assertSame($expected, TextMerge::merge($base, $mine, $theirs));
		// Symmetric: swapping the sides gives the same result.
		$this->assertSame($expected, TextMerge::merge($base, $theirs, $mine));
	}

	public function testLargeParagraphs(): void {
		$lines = [];
		for ($i = 0; $i < 400; $i++) {
			$lines[] = "Absatz $i";
		}
		$base = implode("\n", $lines);
		$m = $lines;
		$m[10] = 'geändert A';
		$t = $lines;
		$t[300] = 'geändert B';
		array_splice($t, 200, 1);
		$r = TextMerge::merge($base, implode("\n", $m), implode("\n", $t));
		$this->assertNotNull($r);
		$this->assertStringContainsString('geändert A', $r);
		$this->assertStringContainsString('geändert B', $r);
		$this->assertStringNotContainsString("Absatz 200\n", $r);
	}
}
