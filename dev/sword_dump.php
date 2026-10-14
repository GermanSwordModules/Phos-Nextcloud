<?php
// Dumps a module in mod2imp's format, for comparing the PHP reader with libsword:
//   php dev/sword_dump.php <sword-root> <conf-file> [cipherkey] > a.imp
//   mod2imp <Module> > b.imp; diff a.imp b.imp
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use OCA\Phos\Service\Sword\Conf;
use OCA\Phos\Service\Sword\LexStore;
use OCA\Phos\Service\Sword\LocalModuleFiles;
use OCA\Phos\Service\Sword\SwordModule;
use OCA\Phos\Service\Sword\Text;

[, $root, $confFile] = $argv;
$conf = new Conf((string)file_get_contents($confFile));
$fs = new LocalModuleFiles($root);
$m = new SwordModule($conf, $fs, $argv[3] ?? null);
if ($m->kind === SwordModule::DICTIONARY) {
	$lex = new LexStore($fs, $conf->get('ModDrv'), $conf->dataPath(), $conf->get('CompressType', 'ZIP'),
		$argv[3] ?? ($conf->get('CipherKey') ?: null));
	for ($i = 0; $i < $lex->count(); $i++) {
		$t = $lex->textAt($i);
		if ($t !== '') {
			echo '$$$', $lex->keyAt($i), "\n", Text::prep($t), "\n";
		}
	}
	exit;
}
$v = $m->versification();
foreach ($m->books() as $b) {
	$osis = $v->books[$b]['osis'];
	for ($c = 1; $c <= $v->chapterCount($b); $c++) {
		$ch = $m->chapter($osis, $c);
		$out = [];
		if ($c === 1) {
			$out["$osis 0:0"] = $ch['bookIntro'];
		}
		$out["$osis $c:0"] = $ch['intro'];
		foreach ($ch['verses'] as $n => $t) {
			$out["$osis $c:$n"] = isset($ch['links'][$n]) ? '' : $t;   // mod2imp skips linked entries
		}
		foreach ($out as $k => $t) {
			if ($t !== '') {
				echo '$$$', $k, "\n", $t, "\n";
			}
		}
	}
}
