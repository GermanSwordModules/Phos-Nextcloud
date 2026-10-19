// Prints, for every verse of every source system and every target system,
// what VerseKey::positionFrom makes of it: src dst book.c.v -> book.c.v[-v2] err
#include <versekey.h>
#include <versificationmgr.h>
#include <swlog.h>
#include <cstdio>
#include <cstring>
using namespace sword;
int main(int argc, char **argv) {
	SWLog::getSystemLog()->setLogLevel(0);
	VersificationMgr *mgr = VersificationMgr::getSystemVersificationMgr();
	const char *sys[] = {"KJV","Leningrad","MT","KJVA","NRSV","NRSVA","Synodal","SynodalProt","Vulg","German","Luther","Catholic","Catholic2","LXX","Orthodox","Calvin","DarbyFr","Segond",0};
	for (int s = 0; sys[s]; s++) {
		if (argc > 1 && strcmp(argv[1], sys[s])) continue;
		const VersificationMgr::System *src = mgr->getVersificationSystem(sys[s]);
		for (int d = 0; sys[d]; d++) {
			if (d == s) continue;
			if (argc > 2 && strcmp(argv[2], sys[d])) continue;
			for (int b = 0; b < src->getBookCount(); b++) {
				const VersificationMgr::Book *bk = src->getBook(b);
				for (int c = 1; c <= bk->getChapterMax(); c++) {
					for (int v = 1; v <= bk->getVerseMax(c); v++) {
						VerseKey from; from.setVersificationSystem(sys[s]);
						from.setAutoNormalize(false); from.setIntros(true);
						from.setBook(1); from.setTestament(b < src->getBMAX()[0] ? 1 : 2);
						from.setBook(b < src->getBMAX()[0] ? b+1 : b+1-src->getBMAX()[0]);
						from.setChapter(c); from.setVerse(v);
						VerseKey to; to.setVersificationSystem(sys[d]); to.setIntros(true); to.setAutoNormalize(false);
						to.positionFrom(from);
						int err = to.popError();
						bool same = !err && !to.isBoundSet() && !strcmp(to.getOSISBookName(), bk->getOSISName()) && to.getChapter() == c && to.getVerse() == v;
						if (same) continue;
						if (to.isBoundSet())
							printf("%s %s %s.%d.%d -> %s.%d.%d-%d %d\n", sys[s], sys[d], bk->getOSISName(), c, v,
								to.getLowerBound().getOSISBookName(), to.getLowerBound().getChapter(), to.getLowerBound().getVerse(), to.getUpperBound().getVerse(), err ? 1 : 0);
						else
							printf("%s %s %s.%d.%d -> %s.%d.%d %d\n", sys[s], sys[d], bk->getOSISName(), c, v,
								to.getOSISBookName(), to.getChapter(), to.getVerse(), err ? 1 : 0);
					}
				}
			}
		}
	}
}
