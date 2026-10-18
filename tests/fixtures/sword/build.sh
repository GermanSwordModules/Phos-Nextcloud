#!/bin/sh
# Rebuilds the fixture modules with libsword's own tools (osis2mod, imp2ld).
# Text: KJV excerpts (public domain). tinyzc is ciphered with 'Fixture-Key-1'
# (not in its conf, like a synced module: the key travels as a moduleKey record).
# A ciphered RawText is left out: libsword cannot read back what osis2mod -c writes there.
set -e
cd "$(dirname "$0")"
rm -rf modules mods.d && mkdir -p mods.d
mk() {  # mk <Name> <driver> <dir> <osis2mod options…>
  name=$1 drv=$2 dir=$3; shift 3
  mkdir -p modules/texts/$dir/$name
  osis2mod modules/texts/$dir/$name tiny.osis.xml "$@" >/dev/null
}
mk tinyz    zText     ztext   -z z
mk tinyz4   zText4    ztext   -z z -s 4
mk tinyraw  RawText   rawtext
mk tinyraw4 RawText4  rawtext -s 4
mk tinyzc   zText     ztext   -z z -c 'Fixture-Key-1'
conf() {  # conf <Name> <driver> <dir> [extra lines]
  { printf '[%s]\nDataPath=./modules/texts/%s/%s/\nModDrv=%s\nSourceType=OSIS\nEncoding=UTF-8\nLang=en\nVersification=KJV\nDescription=Fixture %s\n' \
      "$(echo $1 | tr a-z A-Z)" "$3" "$1" "$2" "$1"; [ -n "$4" ] && printf '%s\n' "$4"; true; } > mods.d/$1.conf
}
conf tinyz zText ztext 'CompressType=ZIP
BlockType=BOOK'
conf tinyz4 zText4 ztext 'CompressType=ZIP
BlockType=BOOK'
conf tinyraw RawText rawtext
conf tinyraw4 RawText4 rawtext
conf tinyzc zText ztext 'CompressType=ZIP
BlockType=BOOK'
for d in rawld:'' rawld4:-4 zld:'-z z'; do
  drv=${d%%:*}; opt=${d#*:}
  mkdir -p modules/lexdicts/$drv/tinylex
  imp2ld lex.imp -o modules/lexdicts/$drv/tinylex/tinylex $opt >/dev/null
  case $drv in rawld) M=RawLD;; rawld4) M=RawLD4;; zld) M=zLD;; esac
  printf '[TINYLEX_%s]\nDataPath=./modules/lexdicts/%s/tinylex/tinylex\nModDrv=%s\nSourceType=TEI\nEncoding=UTF-8\nCompressType=ZIP\nFeature=GreekDef\nDescription=Fixture lexicon %s\n' \
    $(echo $drv | tr a-z A-Z) $drv $M $M > mods.d/tinylex_$drv.conf
done
rm -rf modules/*/*/*/lucene
# AndBible reading plan (+ Phos companion text)
mkdir -p modules/genbook/rawgenbook/tinyplan
printf '1=Gen.1;John.3.16-John.3.17\n# comment\n2=Rev.22.21,Gen.1.1\n' > modules/genbook/rawgenbook/tinyplan/tinyplan.properties
printf '{"2": ["Rev.22.21", "Zum Nachdenken.", "Gen.1.1"]}\n' > modules/genbook/rawgenbook/tinyplan/tinyplan.json
printf '[TINYPLAN]\nDataPath=./modules/genbook/rawgenbook/tinyplan/\nModDrv=RawGenBook\nCategory=And Bible\nAndBibleProvidesReadingPlan=tinyplan.properties\nPhosReadingPlanText=tinyplan.json\nVersification=KJV\nEncoding=UTF-8\nDescription=Fixture reading plan\n' > mods.d/tinyplan.conf
