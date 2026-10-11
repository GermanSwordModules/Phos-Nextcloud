<?php

declare(strict_types=1);

namespace OCA\Phos\Tests\Unit;

use OCA\Phos\Sync\Hlc;
use PHPUnit\Framework\TestCase;

final class HlcTest extends TestCase {
	public function testFormatAndOrder(): void {
		$a = Hlc::format(1791196986000, 0, '7bf7d9b698e112f5');
		$this->assertSame('1791196986000-0000-7bf7d9b698e112f5', $a);
		$this->assertTrue(Hlc::isValid($a));
		$b = Hlc::format(1791196986000, 1, '0000000000000000');
		$this->assertSame(1, Hlc::compare($b, $a), 'counter beats device id');
		$c = Hlc::format(1791196986001, 0, '0000000000000000');
		$this->assertSame(1, Hlc::compare($c, $b), 'ms beats counter');
	}

	public function testInvalid(): void {
		$this->assertFalse(Hlc::isValid('1791196986000-0000-7BF7D9B698E112F5'));
		$this->assertFalse(Hlc::isValid('179119698600-0000-7bf7d9b698e112f5'));
	}

	public function testClamp(): void {
		$now = 1791196986000;
		$ok = Hlc::format($now + 60000, 3, 'aaaaaaaaaaaaaaaa');
		$this->assertSame($ok, Hlc::clamp($ok, $now, 'aaaaaaaaaaaaaaaa'));
		$future = Hlc::format($now + 86400000, 3, 'aaaaaaaaaaaaaaaa');
		$this->assertSame(Hlc::format($now, 0, 'aaaaaaaaaaaaaaaa'), Hlc::clamp($future, $now, 'aaaaaaaaaaaaaaaa'));
	}
}
