#!/usr/bin/env node
// Regenerates the files under src/docs/ that are derived, not authored, from the desktop
// repo (BVC) -- themes.js and phos-deck.css. Run it after any change to BVC's web/themes/*.json
// or web/reveal/theme/phos.css.
//
//   node dev/sync-desktop-assets.js
//   BVC_SRC=/path/to/BVC node dev/sync-desktop-assets.js
//
// What's NOT covered here: src/docs/deck.js is a hand-maintained port of unit_presrender.pas
// (different language, not a derived copy) and stays that way -- see
// BVC/docs/shareable-tool-bundles.md, "What a bundle is not".
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_DIR = join(HERE, '..')
const BVC = process.env.BVC_SRC || join(process.env.HOME, 'tmp/Projekte/BVC')

function syncThemes() {
	const dir = join(BVC, 'web/themes')
	const themes = {}
	for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
		themes[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'))
	}
	const out =
		'// Built-in deck themes, copied from BVC web/themes/*.json (the desktop\'s own).\n' +
		'export const THEMES = ' + JSON.stringify(themes, null, '\t') + '\n'
	writeFileSync(join(APP_DIR, 'src/docs/themes.js'), out)
	console.log(`themes.js: ${Object.keys(themes).length} themes (${Object.keys(themes).join(', ')})`)
}

function syncDeckCss() {
	const src = readFileSync(join(BVC, 'web/reveal/theme/phos.css'), 'utf8')
	const extra = readFileSync(join(HERE, 'phos-deck-web-extra.css'), 'utf8')
	const subs = [
		[':root {', '.phos-deckhost {'],
		['html, body { background: var(--pres-bg); }', '.phos-deckhost { background: var(--pres-bg); }'],
		['.reveal-viewport, html, body { background: var(--pres-bg) !important; }',
			'.reveal-viewport { background: var(--pres-bg) !important; }'],
	]
	let css = src
	for (const [from, to] of subs) {
		if (!css.includes(from)) throw new Error(`phos.css: expected substring not found: ${JSON.stringify(from)}`)
		css = css.replace(from, to)
	}
	const banner =
		'/* Scoped copy of BVC web/reveal/theme/phos.css (the desktop deck theme):\n' +
		'   :root and html/body rules moved onto .phos-deckhost so the deck can live\n' +
		'   inside the Nextcloud page. Regenerate from the desktop file, do not edit. */\n'
	writeFileSync(join(APP_DIR, 'src/docs/phos-deck.css'), banner + css + '\n' + extra)
	console.log('phos-deck.css: regenerated')
}

syncThemes()
syncDeckCss()
