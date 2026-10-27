#!/usr/bin/env node
// Regenerates the files this app serves verbatim from the desktop repo (BVC):
//   facts-bundle/   the shareable web/facts/ bundle (facts.html/css/js, charts.js, maps.json, maps/)
//   data/facts/     topic-scores.txt + topic-titles-<lang>.csv, the data the bundle is fed from
//
// Run it after any change to BVC's web/facts/ or data/topic-*.
//
//   node dev/sync-facts-assets.js
//   BVC_SRC=/path/to/BVC node dev/sync-facts-assets.js
//
// See BVC/docs/shareable-tool-bundles.md: the bundle's files are authored once in BVC and
// copied here verbatim -- never hand-edited in this repo.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BVC = process.env.BVC_SRC || join(process.env.HOME, 'tmp/Projekte/BVC')
const APP_DIR = join(import.meta.dirname, '..')

// fixtures/ is dev-only sample payloads (built from a real Bible); README.md is the bundle's
// own doc. Neither belongs in what this app ships.
const SKIP = new Set(['fixtures', 'README.md'])

function copyTree(src, dst) {
	mkdirSync(dst, { recursive: true })
	let n = 0
	for (const name of readdirSync(src)) {
		if (SKIP.has(name)) {
			continue
		}
		const s = join(src, name)
		const d = join(dst, name)
		if (statSync(s).isDirectory()) {
			n += copyTree(s, d)
		} else {
			copyFileSync(s, d)
			n++
		}
	}
	return n
}

function syncBundle() {
	const dst = join(APP_DIR, 'facts-bundle')
	rmSync(dst, { recursive: true, force: true })
	const n = copyTree(join(BVC, 'web/facts'), dst)
	console.log(`facts-bundle/: ${n} files`)
}

function syncData() {
	const dst = join(APP_DIR, 'data/facts')
	mkdirSync(dst, { recursive: true })
	const files = ['topic-scores.txt', ...readdirSync(join(BVC, 'data')).filter((f) => /^topic-titles-[a-z]+\.csv$/.test(f))]
	for (const f of files) {
		copyFileSync(join(BVC, 'data', f), join(dst, f))
	}
	console.log(`data/facts/: ${files.join(', ')}`)
}

syncBundle()
syncData()
