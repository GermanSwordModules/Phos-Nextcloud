<?php
// Twin of dev/v11n_oracle.cpp: every verse of every system mapped into every
// other one, printed where it is not the same verse. Compare with
//   g++ -I<sword>/include dev/v11n_oracle.cpp -lsword -o /tmp/o && /tmp/o > a
//   php dev/v11n_map_dump.php > b && diff a b
declare(strict_types=1);
require __DIR__ . '/../lib/Service/Sword/Versification.php';
use OCA\Phos\Service\Sword\Versification;

$names = ['KJV','Leningrad','MT','KJVA','NRSV','NRSVA','Synodal','SynodalProt','Vulg','German','Luther','Catholic','Catholic2','LXX','Orthodox','Calvin','DarbyFr','Segond'];
$only = array_slice($argv, 1);
foreach ($names as $s) {
	if (isset($only[0]) && $only[0] !== $s) continue;
	$src = Versification::get($s);
	foreach ($names as $d) {
		if ($d === $s || (isset($only[1]) && $only[1] !== $d)) continue;
		$dst = Versification::get($d);
		foreach ($src->books as $bi => $b) {
			foreach ($b['v'] as $ci => $max) {
				$c = $ci + 1;
				for ($v = 1; $v <= $max; $v++) {
					$r = $src->mapTo($dst, $b['osis'], $c, $v);
					if ($r === null) {
						// sword: book 1 of testament 1, chapter/verse as translated
						$bk = $b['osis']; $cc = $c; $vv = $v; $re = $v;
						$src->translate($dst, $bk, $cc, $vv, $re);
						$tail = $vv < $re ? sprintf('%d-%d', $vv, $re) : (string)$vv;
						printf("%s %s %s.%d.%d -> %s.%d.%s 1\n", $s, $d, $b['osis'], $c, $v, $dst->books[0]['osis'], $cc, $tail);
						continue;
					}
					[$ob, $oc, $ov, $oe, $oob] = $r;
					if (!$oob && $oe === $ov && $ob === $b['osis'] && $oc === $c && $ov === $v) continue;
					if ($oe > $ov) {
						printf("%s %s %s.%d.%d -> %s.%d.%d-%d %d\n", $s, $d, $b['osis'], $c, $v, $ob, $oc, $ov, $oe, $oob ? 1 : 0);
					} else {
						printf("%s %s %s.%d.%d -> %s.%d.%d %d\n", $s, $d, $b['osis'], $c, $v, $ob, $oc, $ov, $oob ? 1 : 0);
					}
				}
			}
		}
	}
}
