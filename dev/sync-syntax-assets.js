#!/usr/bin/env node
// Regenerates syntax-bundle/ (the shareable web/syntax/ bundle: syntax.html/css/js) from the
// desktop repo (BVC) verbatim -- never hand-edited in this repo.
//
// Run it after any change to BVC's web/syntax/.
//
//   node dev/sync-syntax-assets.js
//   BVC_SRC=/path/to/BVC node dev/sync-syntax-assets.js
//
// See BVC/docs/shareable-tool-bundles.md and dev/sync-facts-assets.js, which this mirrors.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BVC = process.env.BVC_SRC || join(process.env.HOME, 'tmp/Projekte/BVC')
const APP_DIR = join(import.meta.dirname, '..')

function copyTree(src, dst) {
	mkdirSync(dst, { recursive: true })
	let n = 0
	for (const name of readdirSync(src)) {
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

const dst = join(APP_DIR, 'syntax-bundle')
rmSync(dst, { recursive: true, force: true })
const n = copyTree(join(BVC, 'web/syntax'), dst)
console.log(`syntax-bundle/: ${n} files`)
