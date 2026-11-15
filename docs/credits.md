# Credits

Third-party code is listed in `composer.lock` and `package-lock.json`. The data and media that
ship with the app:

| Source | Used for | Licence |
|---|---|---|
| [OpenBible.info Topics](https://www.openbible.info/topics/) | Topic scores and passage rankings of the facts pages (`data/facts/topic-scores.txt`), topic titles in German, Swedish and Swahili derived from them | CC BY |
| [Composite Gospel](http://www.semanticbible.com/cg/) (SemanticBible) | Pericope structure of the gospel synopsis (`src/synopsis/pericopes.json`) | not stated by the source |
| [The SWORD Project](https://crosswire.org/sword/) (CrossWire) | Versification tables and mapping rules (`lib/Service/Sword/v11n.json`, `v11n-maps.json`), generated from libsword's `canon_*.h` by `dev/gen_v11n.py`; the PHP readers follow the file formats of libsword's drivers | GPL-2.0 (libsword); the tables are canon data |
| Wikimedia Commons relief maps (Eric Gaba, DEMIS/Commons, Nzeemin) | Map backgrounds of the facts pages, see `facts-bundle/maps/CREDITS.md` | CC BY-SA 3.0 |
| King James Version | Verses in the test fixture modules under `tests/fixtures/sword/` | public domain |
| [reveal.js](https://revealjs.com/) | Presentations | MIT |
| [epub.js](https://github.com/futurepress/epub.js) | E-book reader | BSD-2-Clause |

The e-book fixtures under `tests/fixtures/ebooks/` and the lexicon, book and map fixture modules
were written for the tests and contain no third-party text.
