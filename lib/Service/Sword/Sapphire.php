<?php

declare(strict_types=1);

namespace OCA\Phos\Service\Sword;

/**
 * Sapphire II stream cipher as used by sword's CipherFilter (sapphire.cpp,
 * swcipher.cpp). Only deciphering is needed on the server.
 */
final class Sapphire {
	private const LATS = 'bceafgijklhmpqBrHostTuwxyAdCDzEFIJKGLNO7PQMRSUVWXY9012Z364n8v5';

	/** @var list<int> */
	private array $cards = [];
	private int $rotor = 0;
	private int $ratchet = 0;
	private int $avalanche = 0;
	private int $lastPlain = 0;
	private int $lastCipher = 0;

	public function __construct(string $cipherKey) {
		$key = self::personalize($cipherKey);
		$this->initialize($key, strlen($key) & 0xFF);
	}

	/** Deciphers a whole buffer (fresh state per buffer, as SWCipher::decode). */
	public static function decipher(string $cipherKey, string $data): string {
		static $proto = [];
		$s = clone ($proto[$cipherKey] ??= new self($cipherKey));
		$out = '';
		$n = strlen($data);
		for ($i = 0; $i < $n; $i++) {
			$out .= chr($s->decrypt(ord($data[$i])));
		}
		return $out;
	}

	private function keyrand(int $limit, string $key, int $keysize, int &$rsum, int &$keypos): int {
		if (!$limit) {
			return 0;
		}
		$retry = 0;
		$mask = 1;
		while ($mask < $limit) {
			$mask = ($mask << 1) + 1;
		}
		do {
			$rsum = ($this->cards[$rsum] + ord($key[$keypos++])) & 0xFF;
			if ($keypos >= $keysize) {
				$keypos = 0;
				$rsum = ($rsum + $keysize) & 0xFF;
			}
			$u = $mask & $rsum;
			if (++$retry > 11) {
				$u %= $limit;
			}
		} while ($u > $limit);
		return $u;
	}

	private function initialize(string $key, int $keysize): void {
		if ($keysize < 1) {
			$this->rotor = 1;
			$this->ratchet = 3;
			$this->avalanche = 5;
			$this->lastPlain = 7;
			$this->lastCipher = 11;
			$this->cards = range(255, 0, -1);
			return;
		}
		$this->cards = range(0, 255);
		$keypos = 0;
		$rsum = 0;
		for ($i = 255; $i >= 0; $i--) {
			$toswap = $this->keyrand($i, $key, $keysize, $rsum, $keypos);
			$t = $this->cards[$i];
			$this->cards[$i] = $this->cards[$toswap];
			$this->cards[$toswap] = $t;
		}
		$this->rotor = $this->cards[1];
		$this->ratchet = $this->cards[3];
		$this->avalanche = $this->cards[5];
		$this->lastPlain = $this->cards[7];
		$this->lastCipher = $this->cards[$rsum];
	}

	private function decrypt(int $b): int {
		$c = &$this->cards;
		$this->ratchet = ($this->ratchet + $c[$this->rotor]) & 0xFF;
		$this->rotor = ($this->rotor + 1) & 0xFF;
		$swap = $c[$this->lastCipher];
		$c[$this->lastCipher] = $c[$this->ratchet];
		$c[$this->ratchet] = $c[$this->lastPlain];
		$c[$this->lastPlain] = $c[$this->rotor];
		$c[$this->rotor] = $swap;
		$this->avalanche = ($this->avalanche + $c[$swap]) & 0xFF;
		$this->lastPlain = $b
			^ $c[($c[$this->ratchet] + $c[$this->rotor]) & 0xFF]
			^ $c[$c[($c[$this->lastPlain] + $c[$this->lastCipher] + $c[$this->avalanche]) & 0xFF]];
		$this->lastCipher = $b;
		return $this->lastPlain;
	}

	/**
	 * SWCipher::personalize(key, decode): keys of the form a-b-c-d-check with a
	 * matching checksum are de-obfuscated; any other key is used as given.
	 */
	public static function personalize(string $buf): string {
		$hash = array_flip(str_split(self::LATS));
		$segs = ['', '', '', '', ''];
		$segn = 0;
		for ($i = 0, $n = strlen($buf); $i < $n && $segn < 5; $i++) {
			if ($buf[$i] === '-') {
				$segn++;
			} else {
				$segs[$segn] .= $buf[$i];
			}
		}
		$chk = $segs[4];
		if (strlen($segs[4]) < 5) {
			$segs[4] = str_pad(substr($segs[4], 0, 4), 4, ' ');  // SWBuf fill byte
		}
		$result = '';
		for ($i = 0; $i < 4; $i++) {
			$csum = 0;
			$l0 = strlen($segs[0]);
			for ($j = 0; $j < strlen($segs[$i]) && $j < $l0; $j++) {
				$h = $hash[$segs[$i][$j]] ?? 0;
				$o = $hash[$segs[0][$j % $l0]] ?? 0;
				$o = ($h + ($i ? $o : 0)) % 62;
				if ($i) {
					$segs[$i][$j] = self::LATS[$o];
				}
				$csum += $h;
			}
			$segs[4][$i] = self::LATS[$csum % 62];
			if ($result !== '') {
				$result .= '-';
			}
			$result .= $i ? $segs[$i] : '';
		}
		return $chk !== $segs[4] ? $buf : $result;
	}
}
