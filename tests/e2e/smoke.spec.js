import { test, expect } from '@playwright/test'

const user = () => process.env.PHOS_USER
const pw = () => process.env.PHOS_PW

/** OCS call as the test user — plays "Phos Desktop", a second device. */
async function api(request, method, path, body) {
	const r = await request.fetch(`/ocs/v2.php/apps/phos/api/v1${path}`, {
		method,
		headers: {
			'OCS-APIRequest': 'true', Accept: 'application/json',
			Authorization: 'Basic ' + Buffer.from(`${user()}:${pw()}`).toString('base64'),
		},
		data: body,
	})
	expect(r.ok(), `${method} ${path}`).toBeTruthy()
	return (await r.json()).ocs.data
}

async function record(request, type, key) {
	const d = await api(request, 'GET', `/changes?cursor=0&limit=1000&types=${type}`)
	return d.changes.find(r => r.key === key && !r.deleted) || null
}

let desktopClock = 1800000000000
async function desktopPush(request, change) {
	const d = await api(request, 'POST', '/push', {
		device: 'dddddddddddddddd',
		changes: [{ changeId: crypto.randomUUID(), op: 'upsert', hlc: `${desktopClock++}-0000-dddddddddddddddd`, ...change }],
	})
	return d.results[0]
}

test.beforeEach(async ({ page }) => {
	// Nextcloud's first-run wizard opens late and covers the page
	await page.route(/\/apps\/firstrunwizard\//, r => r.abort())
	await page.goto('/login')
	await page.fill('#user', user())
	await page.fill('#password', pw())
	await page.click('button[type=submit]')
	await page.waitForURL(/apps/)
	await page.goto('/index.php/apps/phos/#/bible/TINYZ/Gen/1')
	await expect(page.locator('.bible__text')).toBeVisible()   // app and router are up
})

test('reads a chapter: heading, verses, footnote', async ({ page }) => {
	const text = page.locator('.bible__text')
	await expect(text).toContainText('The Creation')
	await expect(text.locator('[data-v="1"]')).toContainText('In the beginning')
	await text.locator('[data-v="2"] .phos-note').first().click()
	await expect(page.locator('.phos-popover')).toContainText('Or, upon the face of the deep.')
	// navigation by reference
	await page.getByLabel(/Gehe zu/).fill('Joh 3,16')
	await page.getByLabel(/Gehe zu/).press('Enter')
	await expect(page.locator('.bible__text [data-v="16"] .phos-jesus')).toContainText('For God so loved the world')
	await expect(page.locator('[data-v="16"]')).toHaveClass(/bible__row--selected/)
})

test('bookmark and note made in the web reach the server; a desktop edit comes back', async ({ page, request }) => {
	await page.locator('.bible__text [data-v="3"] .bible__vnum').click()
	await page.getByRole('button', { name: 'Lesezeichen setzen' }).click()
	const sidebar = page.locator('.app-sidebar')
	await sidebar.getByRole('button', { name: /Gebet/ }).click()
	await sidebar.getByText('Notiz hinzufügen …').click()
	await sidebar.locator('textarea').fill('Licht!\nzweite Zeile')
	await sidebar.getByRole('button', { name: 'Speichern' }).click()
	await expect(page.locator('.app-navigation')).toContainText('Abgeglichen', { timeout: 15000 })

	let bm = null
	await expect.poll(async () => {
		const d = await api(request, 'GET', '/changes?cursor=0&limit=1000&types=bookmark')
		bm = d.changes.find(r => !r.deleted && r.payload?.vStart === 3 && r.payload?.bookOsis === 'Gen')
		return bm?.payload?.noteMd
	}).toBe('Licht!\nzweite Zeile')
	expect(bm.payload.labelNames).toEqual(['Gebet'])
	expect(bm.payload.kind).toBe('verse')
	expect(bm.key).toBe('bm:' + bm.payload.id)

	// the desktop changes the second line; the web picks it up on the next sync
	const res = await desktopPush(request, { type: 'bookmark', key: bm.key, baseRev: bm.rev, payload: { ...bm.payload, noteMd: 'Licht!\nvom Desktop' } })
	expect(res.status).toBe('accepted')
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	await expect(sidebar).toContainText('vom Desktop')
})

test('same line edited on both sides: conflict, resolved in the web', async ({ page, request }) => {
	const before = await record(request, 'bookmark', 'bm:seed1')
	await page.goto('/index.php/apps/phos/#/notes')
	const item = page.locator('.bms__item', { hasText: 'Genesis 1,1' })
	await item.getByText('steht Gott').click()
	// meanwhile the desktop rewrites the same line
	await desktopPush(request, { type: 'bookmark', key: 'bm:seed1', baseRev: before.rev, payload: { ...before.payload, noteMd: 'Desktop-Fassung' } })
	await item.locator('textarea').fill('Web-Fassung')
	await item.getByRole('button', { name: 'Speichern' }).click()
	await expect(page.locator('.app-navigation')).toContainText('Konflikte')
	await page.goto('/index.php/apps/phos/#/conflicts')
	const c = page.locator('.conflicts__item').first()
	await expect(c).toContainText('Desktop-Fassung')
	await expect(c).toContainText('Web-Fassung')
	await c.locator('textarea').first().fill('Beide Fassungen')
	await c.getByRole('button', { name: 'Ergebnis speichern' }).click()
	await expect(page.getByText('Keine offenen Konflikte')).toBeVisible()
	await expect.poll(async () => (await record(request, 'bookmark', 'bm:seed1'))?.payload.noteMd).toBe('Beide Fassungen')
})

test('reading plan: today’s passages, day marked done', async ({ page, request }) => {
	await page.goto('/index.php/apps/phos/#/plan/TINYPLAN')
	await expect(page.locator('.plan__content h3')).toHaveText('Tag 1')
	await expect(page.locator('.plan__card').first()).toContainText('In the beginning')
	await page.getByRole('button', { name: 'Erledigt' }).click()
	await expect(page.locator('.plan__content h3')).toHaveText('Tag 2')
	await expect(page.locator('.plan__content')).toContainText('Zum Nachdenken.')
	await expect.poll(async () => (await record(request, 'planProgress', 'plan:TINYPLAN'))?.payload.doneDays).toEqual([1])
})

test('study pad lists the label’s bookmarks; own note added', async ({ page, request }) => {
	await page.goto('/index.php/apps/phos/#/pads')
	await expect(page.locator('.pads__item').first()).toContainText('Genesis 1,1')
	await page.getByRole('button', { name: 'Eigene Notiz hinzufügen' }).click()
	await page.locator('.pads__add textarea').fill('Gedanke zum Thema')
	await page.locator('.pads__add').getByRole('button', { name: 'Speichern' }).click()
	await expect(page.locator('.pads__item').last()).toContainText('Gedanke zum Thema')
	await expect.poll(async () => {
		const d = await api(request, 'GET', '/changes?cursor=0&limit=1000&types=bookmark')
		return d.changes.find(r => r.payload?.noteMd === 'Gedanke zum Thema')?.payload.kind
	}).toBe('entry')
})

test('start page “Bibellesen”: plan, sermons and the Bible next to them', async ({ page, request }) => {
	await desktopPush(request, {
		type: 'sermon', key: 'sermon:e2e-gen1',
		payload: { uuid: 'e2e-gen1', title: 'Am Anfang', passage: '1. Mose 1,1–5', passage_osis: 'Gen.1.1-Gen.1.5', main_idea: 'Gott spricht, und es wird.', outline: [{ title: 'Licht', blocks: [] }], modified: '2026-10-19T10:00:00' },
	})
	await page.goto('/index.php/apps/phos/#/')
	await expect(page).toHaveURL(/#\/read\/TINYZ\/Gen\/1/)
	const side = page.locator('.reading__side')
	await expect(side.locator('.plan__dayhead h3')).toHaveText(/Tag \d/)
	await page.getByRole('button', { name: 'Abgleichen' }).click()
	await expect(side.locator('.sermons')).toContainText('Am Anfang')
	await expect(side.locator('.sermons')).toContainText('Gott spricht, und es wird.')
	// a plan passage opens in the Bible on the left, still on this page
	await side.locator('.plan__ref').first().click()
	await expect(page).toHaveURL(/#\/read\/TINYZ\//)
	await expect(page.locator('.bible__text')).toBeVisible()
	// the sermon belongs to Genesis 1 only
	await page.getByLabel(/Gehe zu/).fill('Joh 3,16')
	await page.getByLabel(/Gehe zu/).press('Enter')
	// a map module's entry citing the chapter, as a picture tile
	const tile = side.locator('.media__tile')
	await expect(tile).toHaveCount(1)
	await expect(tile).toContainText('Galiläa')
	await expect.poll(() => tile.locator('img').evaluate(img => img.complete && img.naturalWidth)).toBe(1)
	// a sermon book (module) citing the chapter in an entry's opening
	const hit = side.locator('.sermons__books .sermons__item')
	await expect(hit).toContainText('Joh 3,16 – Kapitel 2')
	await expect(hit).toContainText('Fixture book')
	await hit.getByRole('link').click()
	await expect(page).toHaveURL(/#\/book\/TINYBOOK\?e=/)
	await expect(page.locator('.book__entry h3')).toHaveText('Kapitel 2')
})

test('library tree opens a book: contents, next/previous, pictures; a lexicon by lookup', async ({ page }) => {
	await page.goto('/index.php/apps/phos/#/library')
	const tree = page.locator('.library__tree')
	await expect(tree).toContainText('Bibel')
	await expect(tree).not.toContainText('Fixture reading plan')     // plans have their own page
	await tree.getByRole('button', { name: /Bücher/ }).click()
	await tree.getByRole('button', { name: /Deutsch/ }).click()
	await tree.getByRole('link', { name: /Fixture book/ }).click()
	await expect(page).toHaveURL(/#\/book\/TINYBOOK/)
	const entry = page.locator('.book__entry')
	await expect(entry.locator('h3')).not.toBeEmpty()
	// it opens where the user is reading (other tests moved that); from the start:
	await page.locator('.book__toc').getByText('Vorwort').click()
	await expect(entry.locator('h3')).toHaveText('Vorwort')
	await entry.getByRole('button', { name: 'Weiter' }).click()
	await expect(entry.locator('h3')).toHaveText('Teil Eins')
	await entry.getByRole('button', { name: 'Weiter' }).click()
	await expect(entry.locator('h3')).toHaveText('Kapitel 1')
	await expect(entry.locator('.book__trail')).toContainText('Teil Eins')
	await expect(page.locator('.book__toc')).toContainText('Kapitel 2')    // the way to the entry is open
	await expect.poll(() => entry.locator('img.phos-img').evaluate(img => img.complete && img.naturalWidth)).toBe(1)
	await page.locator('.book__toc').getByText('Anhang').click()
	await expect(entry.locator('h3')).toHaveText('Anhang')
	await expect(entry.getByRole('button', { name: 'Weiter' })).toBeDisabled()

	await page.goto('/index.php/apps/phos/#/dict/TINYLEX_ZLD')
	await expect(page.locator('.dict__entry h3')).not.toBeEmpty()
	await page.getByLabel('Nachschlagen').fill('g25')
	await page.getByLabel('Nachschlagen').press('Enter')
	await expect(page.locator('.dict__entry h3')).toHaveText('G0025')
	await expect(page.locator('.dict__key--current')).toHaveText('G0025')
})

test('parallel text in another versification follows the main Bible’s numbering', async ({ page }) => {
	// TINYSYN counts the Psalms like the Synodal (LXX): KJV Ps 23 = Ps 22 there
	await page.goto('/index.php/apps/phos/#/bible/TINYZ/Ps/23?p=TINYSYN')
	const row = page.locator('.bible__text [data-v="1"]')
	await expect(row.locator('.bible__cell').first()).toContainText('The LORD is my shepherd')
	await expect(row.locator('.bible__cell').nth(1)).toContainText('The LORD is my shepherd')
	await expect(row.locator('.bible__from')).toHaveText('Psalm 22,1')
	await expect(page.locator('.bible__text [data-v="2"] .bible__cell').nth(1)).toContainText('green pastures')
})

test('search: Bible on the server, own notes in the browser; a word in “Gehe zu” searches', async ({ page, request }) => {
	await desktopPush(request, {
		type: 'bookmark', key: 'bm:e2e-senfkorn',
		payload: { id: 'e2e-senfkorn', kind: 'verse', bookOsis: 'Gen', bookIdx: 0, chap: 1, vStart: 2, vEnd: 2, labelNames: [],
			noteHtml: '<p>Glaube wie ein <b>Senfk&ouml;rnlein</b></p>', sortOrder: 0, created: 1791200000, modified: 1791200000 },
	})
	await page.getByRole('button', { name: 'Abgleichen' }).click()
	await page.goto('/index.php/apps/phos/#/search?m=TINYZ&q=god')
	await expect(page.locator('.search__count')).toHaveText('4 Verse')
	await expect(page.locator('.search__hit').first()).toContainText('In the beginning')
	await expect(page.locator('.search__hit mark').first()).toHaveText('God')
	// Strong's number, phrase, scope
	await page.getByLabel('Suchen nach').fill('H430')
	await page.getByLabel('Suchen nach').press('Enter')
	await expect(page.locator('.search__count')).toHaveText('1 Vers')
	await expect(page.locator('.search__hit .phos-hit')).toHaveText('God')
	await page.getByLabel('Suchen nach').fill('"so loved the world"')
	await page.getByLabel('Suchen nach').press('Enter')
	await expect(page.locator('.search__hit')).toContainText('so loved the world')
	await expect(page.locator('.search__count')).toHaveText('1 Vers')
	await page.locator('.search__hit .search__ref').click()
	await expect(page).toHaveURL(/#\/bible\/TINYZ\/John\/3\?v=16/)
	await expect(page.locator('[data-v="16"]')).toHaveClass(/bible__row--selected/)

	await page.getByLabel(/Gehe zu/).fill('senfkör*')
	await page.getByLabel(/Gehe zu/).press('Enter')
	await expect(page).toHaveURL(/#\/search\?q=senfk/)
	await page.getByRole('tab', { name: 'Meine Notizen' }).click()
	// a desktop note (HTML from RTF) is found too, umlaut or not
	const hit = page.locator('.search__hit').first()
	await expect(hit).toContainText('Notiz')
	await expect(hit.locator('mark')).toHaveText('Senfkörnlein')
	await hit.locator('.search__ref').click()
	await expect(page).toHaveURL(/#\/bible\/.*\/Gen\/1\?v=2/)
})

test('query builder: the shared web/querybuilder/ bundle, restricted to what server search can run (Phase 3, Scope 4)', async ({ page }) => {
	await page.goto('/index.php/apps/phos/#/search?m=TINYZ')
	await page.getByRole('button', { name: 'Baukasten' }).click()
	const qb = page.frameLocator('.qb-panel__frame')
	// only the fields this server's search index actually executes are offered
	await expect(qb.locator('#palette .chip')).toHaveCount(4)
	await expect(qb.locator('#palette .chip')).toHaveText(['Wort', 'Wortanfang', 'Strong', 'Phrase'])
	// no proximity/OR ops, no inline scope -- this host's search takes book-scope as its own param
	await expect(qb.locator('#foot input.scope')).toHaveCount(0)
	await qb.locator('#palette .chip').getByText('Wort', { exact: true }).click()
	await qb.locator('.block input').fill('god')
	await expect(page.getByRole('button', { name: 'Suche', exact: true })).toBeEnabled()
	await page.getByRole('button', { name: 'Suche', exact: true }).click()
	await expect(page).toHaveURL(/#\/search\?.*q=god/)
	await expect(page.locator('.search__count')).toHaveText('4 Verse')
})

test('continue reading: the desktop’s workspace on the start page; book positions both ways', async ({ page, request }) => {
	await desktopPush(request, {
		type: 'workspace', key: 'ws:7d1c0b6a2f9e4c1d8b3a5e6f7a8b9c0d',
		payload: { id: '7d1c0b6a2f9e4c1d8b3a5e6f7a8b9c0d', name: 'Arbeitsbereich 1', panels: [
			{ module: 'TINYZ', kind: 'Bible', width: 1, groupId: 0, strongsAsTag: false, bookIndex: 42, chapIndex: 2, verseIndex: 16 },
			{ module: 'NotOnline', kind: 'Bible', width: 1, groupId: 0, strongsAsTag: false, bookIndex: 0, chapIndex: 0, verseIndex: 3 },
		] },
	})
	await desktopPush(request, { type: 'readingPosition', key: 'pos:mod:TINYBOOK', payload: { entryKey: '/Teil Eins/Kapitel 2', scroll: 0 } })
	await page.goto('about:blank')   // a fresh start pulls them
	await page.goto('/index.php/apps/phos/#/')
	// the desktop's position is newer than anything read in this browser
	await expect(page).toHaveURL(/#\/read\/TINYZ\/John\/3\?at=16/)
	const cont = page.locator('.continue')
	await expect(cont).toContainText('Johannes 3,16')
	await expect(cont).toContainText('TINYZ · Arbeitsbereich 1')
	await expect(cont).toContainText('NotOnline (nicht online)')
	await cont.getByRole('link', { name: 'Genesis 1,3' }).click()
	await expect(page).toHaveURL(/#\/read\/TINYZ\/Gen\/1\?at=3/)

	await page.goto('/index.php/apps/phos/#/book/TINYBOOK')
	const entry = page.locator('.book__entry')
	await expect(entry.locator('h3')).toHaveText('Kapitel 2')
	await entry.getByRole('button', { name: 'Zurück' }).click()
	await expect(entry.locator('h3')).toHaveText('Kapitel 1')
	await expect.poll(async () => (await record(request, 'readingPosition', 'pos:mod:TINYBOOK'))?.payload.entryKey).toBe('/Teil Eins/Kapitel 1')
})

// ---------- W-5 / W-6: documents, presentations, e-books ----------

const uuid = () => crypto.randomUUID()

test('sermon: a desktop sermon opens, edits reach the server, a desktop edit comes back; a new one starts here', async ({ page, request }) => {
	const id = uuid()
	const key = 'sermon:' + id
	const r = await desktopPush(request, { type: 'sermon', key, payload: {
		uuid: id, title: 'E2E-Predigt', passage: 'Joh 3,16', passage_osis: 'John.3.16', exegesis: '', planner_event: '', project: '', deck: '',
		bible: 'TINYZ', main_idea: 'Gott liebt die Welt', goal: '', audience: '', intro: '', conclusion: '',
		created: '2026-10-20T08:00:00', modified: '2026-10-20T08:00:00',
		outline: [{ title: 'Liebe', refs: '3,16', blocks: [{ kind: 'verse', text: 'Also hat Gott', ref: 'Joh 3,16', osis: 'John.3.16' }] }],
	} })
	expect(r.status).toBe('accepted')
	await page.goto(`/index.php/apps/phos/#/sermons/${id}`)
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	await expect(page.getByLabel('Titel')).toHaveValue('E2E-Predigt')
	await expect(page.getByLabel('Punkt 1')).toHaveValue('Liebe')
	await page.getByLabel('Hauptgedanke').fill('Gott liebt die Welt\nund dich')
	await page.getByRole('button', { name: 'Baustein hinzufügen' }).click()
	await page.getByLabel('Notiz').last().fill('Neuer Baustein aus dem Web')
	await expect.poll(async () => (await record(request, 'sermon', key))?.payload.outline[0].blocks.length, { timeout: 15000 }).toBe(2)
	const after = (await record(request, 'sermon', key)).payload
	expect(after.main_idea).toBe('Gott liebt die Welt\nund dich')
	expect(after.outline[0].blocks[1]).toMatchObject({ kind: 'note', text: 'Neuer Baustein aus dem Web' })
	expect(after.uuid).toBe(id)

	// the desktop changes the title
	const cur = await record(request, 'sermon', key)
	await desktopPush(request, { type: 'sermon', key, baseRev: cur.rev, payload: { ...cur.payload, title: 'Vom Desktop umbenannt' } })
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	await expect(page.getByLabel('Titel')).toHaveValue('Vom Desktop umbenannt')

	await page.getByRole('button', { name: 'Neue Predigt' }).click()
	await expect(page).not.toHaveURL(new RegExp(id))
	const newId = page.url().split('/').pop()
	await expect.poll(async () => (await record(request, 'sermon', 'sermon:' + newId))?.payload.uuid, { timeout: 15000 }).toBe(newId)
})

test('projects and exegeses: RTF notes and exegesis text are shown, links between them', async ({ page, request }) => {
	const pid = uuid()
	const eid = uuid()
	const rtf = String.raw`{\rtf1\ansi\ansicp1252{\fonttbl{\f0 Noto Sans;}}\f0\fs22 Durch die \b Gnade\b0  seid ihr errettet \u8211? Eph 2,8.\par Zweiter Absatz.\par}`
	await desktopPush(request, { type: 'project', key: 'project:' + pid, payload: {
		uuid: pid, title: 'E2E-Projekt', kind: 'study', status: 'aktiv', created: '20-10-26 08:00:00', modified: '20-10-26 08:00:00',
		project: { uuid: pid, title: 'E2E-Projekt', question: 'Was ist Gnade?', category: 'Tests', kind: 'study',
			checklist: [{ title: 'Frage festlegen', tab: '', done: true }, { title: 'Exegese', tab: 'exegesen', done: false }], concepts: [{ lexeme: 'G5485', gloss: 'Gnade' }] },
		notesRtf: String.raw`{\rtf1\ansi Projektnotiz mit \i Kursivem\i0 .\par}`,
	} })
	await desktopPush(request, { type: 'pericope', key: 'pericope:' + eid, payload: {
		uuid: eid, bookStart: 49, chapStart: 2, verseStart: 8, bookEnd: 49, chapEnd: 2, verseEnd: 10, title: 'Aus Gnade',
		savedDate: '20-10-26 08:00:00', bibleModule: 'TINYZ', project: pid, docMode: 'internal', docPath: '', commentModules: [], rtf,
		state: { bibleW: '400' },
	} })
	await page.goto(`/index.php/apps/phos/#/projects/${pid}`)
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	const doc = page.locator('.projects__doc')
	await expect(doc.locator('h2')).toHaveText('E2E-Projekt')
	await expect(doc).toContainText('Was ist Gnade?')
	await expect(doc.locator('.phos-rtf em')).toHaveText('Kursivem')
	await expect(doc).toContainText('G5485 – Gnade')
	await expect(doc.locator('.projects__check li')).toHaveText(['☑ Frage festlegen', '☐ Exegese'])
	await doc.getByRole('link', { name: /Epheser 2,8-10/ }).click()
	await expect(page).toHaveURL(new RegExp('#/exegesis/' + eid))
	const ex = page.locator('.exegesis')
	await expect(ex.locator('h2')).toContainText('Aus Gnade')
	await expect(ex.locator('.phos-rtf strong')).toHaveText('Gnade')
	await expect(ex.locator('.phos-rtf')).toContainText('errettet – Eph 2,8.')
	await expect(ex.locator('.phos-rtf p')).toHaveCount(2)
	await expect(ex.getByRole('link', { name: 'E2E-Projekt' })).toBeVisible()
})

test('presentation: a desktop deck plays with reveal.js — theme, passage from the server, steps, notes', async ({ page, request }) => {
	const id = uuid()
	await desktopPush(request, { type: 'presentation', key: 'presentation:' + id, payload: {
		uuid: id, title: 'E2E-Folien', kind: 'sermon', theme: 'Dunkel', created: 46315.3, modified: 46315.3,
		deck: { uuid: id, title: 'E2E-Folien', kind: 'sermon', theme: 'Dunkel', slides: [
			{ id: 'a', blocks: [{ kind: 'title', text: 'Willkommen' }, { kind: 'subtitle', text: '20.10.2026' }] },
			{ id: 'b', notes: 'Langsam **lesen**', blocks: [{ kind: 'passage', module: 'TINYZ', osis: 'Gen.1.1-Gen.1.2', step: 'verse' }] },
			{ id: 'c', blocks: [{ kind: 'bullets', text: '- Erstens\n- Zweitens' }, { kind: 'image', image: '/home/x/elsewhere/bild.png' }] },
		] },
	} })
	await page.goto(`/index.php/apps/phos/#/decks/${id}`)
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	const stage = page.locator('.decks__stage')
	await expect(stage.locator('.slides > section')).toHaveCount(3)
	await expect(stage.locator('section.present h1.phos-title')).toHaveText('Willkommen')
	await expect(page.locator('.decks__pos')).toHaveText('Folie 1 von 3')
	// the deck's theme reaches the slides
	expect(await stage.evaluate(el => getComputedStyle(el).getPropertyValue('--pres-bg').trim())).toBe('#12181f')
	await stage.focus()
	await page.keyboard.press('ArrowRight')
	await expect(page.locator('.decks__pos')).toHaveText('Folie 2 von 3')
	const passage = stage.locator('section.present .phos-passage')
	await expect(passage.locator('.phos-ref')).toContainText(/ 1,1-2 \(TINYZ\)/)
	await expect(passage.locator('#v1_1')).toContainText('In the beginning')
	await expect(passage.locator('.verse.fragment')).toHaveCount(2)
	await expect(page.locator('.decks__notes strong')).toHaveText('lesen')
	await page.keyboard.press('ArrowRight')    // verse 1 appears
	await expect(passage.locator('#v1_1')).toHaveClass(/visible/)
	await page.keyboard.press('ArrowRight')
	await page.keyboard.press('ArrowRight')
	await expect(page.locator('.decks__pos')).toHaveText('Folie 3 von 3')
	await expect(stage.locator('section.present .phos-bullets li')).toHaveCount(2)
	await expect(stage.locator('section.present .phos-caption')).toHaveText('Bild fehlt: bild.png')
})

test('e-books: list with title from book.conf, ePub reader with contents and shared position, PDF inline', async ({ page, request }) => {
	const fs = await import('node:fs')
	const path = await import('node:path')
	const crypt = await import('node:crypto')
	const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures', 'ebooks')
	const auth = 'Basic ' + Buffer.from(`${user()}:${pw()}`).toString('base64')
	const dav = p => request.fetch(`/remote.php/dav/files/${user()}/${p}`, { method: p.endsWith('/') ? 'MKCOL' : 'PUT', headers: { Authorization: auth } })
	const put = (p, data) => request.fetch(`/remote.php/dav/files/${user()}/${p}`, { method: 'PUT', headers: { Authorization: auth }, data })
	for (const p of ['Phos/', 'Phos/E-Books/', 'Phos/E-Books/Fixture-Buch/', 'Phos/E-Books/Fixture-PDF/']) {
		await dav(p)
	}
	const manifest = async (ref, names) => {
		const files = []
		for (const [p, src] of names) {
			const buf = fs.readFileSync(path.join(dir, src))
			expect((await put(`Phos/E-Books/${ref}/${p}`, buf)).ok()).toBeTruthy()
			files.push({ p, s: buf.length, h: crypt.createHash('md5').update(buf).digest('hex') })
		}
		return { files, total: files.reduce((a, f) => a + f.s, 0) }
	}
	await desktopPush(request, { type: 'ebook', key: 'ebook:Fixture-Buch', payload: await manifest('Fixture-Buch', [['book.conf', 'book.conf'], ['book.epub', 'book.epub']]) })
	await desktopPush(request, { type: 'ebook', key: 'ebook:Fixture-PDF', payload: await manifest('Fixture-PDF', [['book.pdf', 'book.pdf']]) })
	// the desktop was reading chapter 2
	await desktopPush(request, { type: 'readingPosition', key: 'pos:ebook:Fixture-Buch', payload: { entryKey: 'Text/ch2.xhtml', scroll: 0 } })

	await page.goto('/index.php/apps/phos/#/ebooks')
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	const grid = page.locator('.ebooks__grid')
	await expect(grid.locator('.ebooks__card', { hasText: 'Fixture-Buch' })).toContainText('Phos Tests')
	await expect(grid.locator('.ebooks__card', { hasText: 'Fixture PDF' })).toContainText('PDF')

	await grid.locator('.ebooks__card', { hasText: 'Fixture-Buch' }).click()
	const frame = page.frameLocator('.ebooks__viewer iframe')
	await expect(frame.locator('h1')).toHaveText('Zweites Kapitel')       // where the desktop left off
	await page.getByRole('button', { name: 'Vorige Seite' }).click()
	await expect(frame.locator('h1')).toHaveText('Erstes Kapitel')
	expect(await page.title()).not.toBe('bad')                            // the book's script did not run
	await expect.poll(async () => (await record(request, 'readingPosition', 'pos:ebook:Fixture-Buch'))?.payload.entryKey, { timeout: 15000 })
		.toBe('Text/ch1.xhtml')

	await page.goto('/index.php/apps/phos/#/ebooks/Fixture-PDF')
	const src = await page.locator('iframe.ebooks__pdf').getAttribute('src')
	const r = await request.fetch(src, { headers: { Authorization: auth } })
	expect(r.ok()).toBeTruthy()
	expect(r.headers()['content-type']).toBe('application/pdf')
	expect(r.headers()['content-disposition']).toMatch(/^inline/)
	// anything that could carry script stays a download
	const conf = await request.fetch(src.replace('Fixture-PDF/book.pdf', 'Fixture-Buch/book.epub') + '?download=1', { headers: { Authorization: auth } })
	expect(conf.headers()['content-disposition']).toMatch(/^attachment/)
})

// 1×1 PNGs (red, blue)
const PNG_RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const PNG_BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', 'base64')

test('presentation: pictures from elsewhere and the user\'s themes (background, logo) come with the deck', async ({ page, request }) => {
	const crypt = await import('node:crypto')
	const id = uuid()
	const auth = 'Basic ' + Buffer.from(`${user()}:${pw()}`).toString('base64')
	const dav = (p, data) => request.fetch(`/remote.php/dav/files/${user()}/${p}`, { method: data ? 'PUT' : 'MKCOL', headers: { Authorization: auth }, data })
	for (const p of ['Phos/', 'Phos/Praesentationen/', `Phos/Praesentationen/${id}/`, `Phos/Praesentationen/${id}/_ext/`]) {
		await dav(p)
	}
	// what the desktop's MirrorExternalMedia writes
	const index = JSON.stringify({
		files: { '/home/jens/Bilder/Kreuz.png': 'aa11-Kreuz.png', '/home/jens/Bilder/grund.png': 'bb22-grund.png', 'C:/Logos/ort.png': 'cc33-ort.png' },
		themes: { 'Nur im Deck': { ...{ name: 'Nur im Deck', bg: '#334455', fg: '#ffffff' }, bgMode: 'solid' } },
	})
	const files = []
	for (const [p, data] of [['_ext/index.json', Buffer.from(index)], ['_ext/aa11-Kreuz.png', PNG_RED], ['_ext/bb22-grund.png', PNG_BLUE], ['_ext/cc33-ort.png', PNG_RED]]) {
		expect((await dav(`Phos/Praesentationen/${id}/${p}`, data)).ok()).toBeTruthy()
		files.push({ p, s: data.length, h: crypt.createHash('md5').update(data).digest('hex') })
	}
	await desktopPush(request, { type: 'presAssets', key: 'presAssets:' + id, payload: { files, total: files.reduce((a, f) => a + f.s, 0) } })
	// the user's own theme, synced as presTheme
	await desktopPush(request, { type: 'presTheme', key: 'presTheme:Gemeinde Ost', payload: {
		name: 'Gemeinde Ost', bg: '#fefefe', fg: '#111111', accent: '#aa0000', bgMode: 'image', bgImage: '/home/jens/Bilder/grund.png',
		logo: 'C:\\Logos\\ort.png', logoCorner: 'tr', logoHeight: 10, logoOpacity: 50,
	} })
	await desktopPush(request, { type: 'presentation', key: 'presentation:' + id, payload: {
		uuid: id, title: 'E2E-Medien', kind: 'sermon', theme: 'Gemeinde Ost', created: 46315.3, modified: 46315.3,
		deck: { uuid: id, title: 'E2E-Medien', kind: 'sermon', theme: 'Gemeinde Ost', slides: [
			{ id: 'a', blocks: [{ kind: 'image', image: '/home/jens/Bilder/Kreuz.png', text: 'Das Kreuz' }] },
			{ id: 'b', theme: 'Nur im Deck', blocks: [{ kind: 'title', text: 'Dunkle Folie' }] },
		] },
	} })
	await page.goto(`/index.php/apps/phos/#/decks/${id}`)
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	const stage = page.locator('.decks__stage')
	const img = stage.locator('section.present .phos-image img')
	await expect(img).toHaveAttribute('src', /\/_ext\/aa11-Kreuz\.png$/)
	await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBe(1)
	expect(await stage.evaluate(el => getComputedStyle(el).getPropertyValue('--pres-bg').trim())).toBe('#fefefe')
	expect(await stage.evaluate(el => getComputedStyle(el).getPropertyValue('--pres-bg-image').trim())).toMatch(/_ext\/bb22-grund\.png/)
	const logo = stage.locator('.phos-deck-logo.phos-logo-tr img')
	await expect(logo).toHaveAttribute('src', /\/_ext\/cc33-ort\.png$/)
	await expect.poll(() => logo.evaluate(el => el.complete && el.naturalWidth)).toBe(1)
	await stage.focus()
	await page.keyboard.press('ArrowRight')
	// a theme the user does not have, carried by the deck
	await expect(stage.locator('section.present[data-theme="Nur im Deck"]')).toHaveAttribute('style', /--pres-bg: ?#334455/)
})

test('presentation: presenter window and the deck follow each other; the phone remote steers', async ({ page, request }) => {
	const id = uuid()
	await desktopPush(request, { type: 'presentation', key: 'presentation:' + id, payload: {
		uuid: id, title: 'E2E-Vortrag', kind: 'teaching', theme: 'Hell', created: 46315.3, modified: 46315.3,
		deck: { uuid: id, title: 'E2E-Vortrag', kind: 'teaching', theme: 'Hell', slides: [
			{ id: 'a', title: 'Anfang', notes: 'Begrüßen', blocks: [{ kind: 'title', text: 'Eins' }] },
			{ id: 'b', notes: 'Langsam', blocks: [{ kind: 'title', text: 'Zwei' }] },
			{ id: 'c', blocks: [{ kind: 'title', text: 'Drei' }] },
		] },
	} })
	await page.goto(`/index.php/apps/phos/#/decks/${id}`)
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	await expect(page.locator('.decks__pos')).toHaveText('Folie 1 von 3')

	// presenter view: own window, current + next slide, notes, timer
	const [pres] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Referentenansicht' }).click()])
	await expect(pres.locator('.presenter__current section.present h1')).toHaveText('Eins')
	await expect(pres.locator('.presenter__next section.present h1')).toHaveText('Zwei')
	await expect(pres.locator('.presenter__notes')).toHaveText('Begrüßen')
	await expect(pres.locator('.presenter__timer')).toHaveText(/^\d\d:\d\d$/)
	await pres.locator('.presenter__current').focus()
	await pres.keyboard.press('ArrowRight')
	await expect(page.locator('.decks__pos')).toHaveText('Folie 2 von 3')          // the deck window followed
	await expect(pres.locator('.presenter__next section.present h1')).toHaveText('Drei')
	await page.locator('.decks__stage').focus()
	await page.keyboard.press('ArrowRight')
	await expect(pres.locator('.presenter__current section.present h1')).toHaveText('Drei')   // and back
	await expect(pres.locator('.presenter__end')).toBeVisible()
	await pres.keyboard.press('b')
	await expect(page.locator('.decks__stage .reveal')).toHaveClass(/paused/)
	await pres.keyboard.press('b')
	await expect(page.locator('.decks__stage .reveal')).not.toHaveClass(/paused/)
	await pres.close()

	// phone remote: same account, other page
	await page.keyboard.press('Home')
	await expect(page.locator('.decks__pos')).toHaveText('Folie 1 von 3')
	await page.getByRole('button', { name: 'Handy-Fernbedienung' }).click()
	await expect(page.locator('.decks__remote a')).toHaveText(/#\/remote$/)
	const phone = await page.context().newPage()
	await phone.route(/\/apps\/firstrunwizard\//, r => r.abort())
	await phone.goto('/index.php/apps/phos/#/remote')
	await expect(phone.locator('.remote__deck')).toHaveText('E2E-Vortrag')
	await expect(phone.locator('.remote__pos')).toContainText('Folie 1 von 3')
	await expect(phone.locator('.remote__notes')).toContainText('Begrüßen')
	await phone.getByRole('button', { name: 'Weiter' }).click()
	await expect(page.locator('.decks__pos')).toHaveText('Folie 2 von 3')
	await expect(phone.locator('.remote__notes')).toContainText('Langsam')
	await phone.getByRole('button', { name: 'Alle Folien' }).click()
	await phone.locator('.remote__list button', { hasText: '3. Drei' }).click()
	await expect(page.locator('.decks__pos')).toHaveText('Folie 3 von 3')
	await phone.getByRole('button', { name: 'Schwarzbild' }).click()
	await expect(page.locator('.decks__stage .reveal')).toHaveClass(/paused/)
	// switching it off ends the remote's view
	await page.getByRole('button', { name: 'Handy-Fernbedienung' }).click()
	await expect(phone.getByText('Keine Präsentation läuft')).toBeVisible()
})

test('sharing from the web: a project goes with its exegesis and passage list, a deck with its pictures; and comes back', async ({ page, request }) => {
	const crypt = await import('node:crypto')
	const pid = uuid()
	const eid = uuid()
	const did = uuid()
	const auth = 'Basic ' + Buffer.from(`${user()}:${pw()}`).toString('base64')
	await desktopPush(request, { type: 'project', key: 'project:' + pid, payload: {
		uuid: pid, title: 'E2E-Teilprojekt', kind: 'study', project: { uuid: pid, title: 'E2E-Teilprojekt', question: 'Teilen?' },
	} })
	await desktopPush(request, { type: 'projectOcc', key: 'projectOcc:' + pid, payload: { data: { hits: ['Eph.2.8'] } } })
	await desktopPush(request, { type: 'pericope', key: 'pericope:' + eid, payload: {
		uuid: eid, bookStart: 49, chapStart: 2, verseStart: 8, bookEnd: 49, chapEnd: 2, verseEnd: 9, title: 'Teil-Exegese',
		bibleModule: 'TINYZ', project: pid, docMode: 'internal', rtf: String.raw`{\rtf1 x\par}`, state: {},
	} })
	// a deck with one picture in its media folder
	const dav = (p, data) => request.fetch(`/remote.php/dav/files/${user()}/${p}`, { method: data ? 'PUT' : 'MKCOL', headers: { Authorization: auth }, data })
	for (const p of ['Phos/', 'Phos/Praesentationen/', `Phos/Praesentationen/${did}/`]) {
		await dav(p)
	}
	expect((await dav(`Phos/Praesentationen/${did}/bild.png`, PNG_RED)).ok()).toBeTruthy()
	await desktopPush(request, { type: 'presAssets', key: 'presAssets:' + did, payload: {
		files: [{ p: 'bild.png', s: PNG_RED.length, h: crypt.createHash('md5').update(PNG_RED).digest('hex') }], total: PNG_RED.length,
	} })
	await desktopPush(request, { type: 'presentation', key: 'presentation:' + did, payload: {
		uuid: did, title: 'E2E-Teilfolien', kind: 'sermon', theme: 'Hell',
		deck: { uuid: did, title: 'E2E-Teilfolien', theme: 'Hell', slides: [{ id: 'a', blocks: [{ kind: 'image', image: `/home/j/phos/presentations/${did}/bild.png` }] }] },
	} })

	// the project into a new collection
	await page.goto(`/index.php/apps/phos/#/projects/${pid}`)
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	await page.locator('.projects__doc').getByRole('button', { name: 'Teilen …' }).click()
	const dlg = page.getByRole('dialog', { name: '„E2E-Teilprojekt“ teilen' })
	await expect(dlg.getByText('Seine Exegesen und Belegstellen kommen mit.')).toBeVisible()
	await dlg.getByLabel('Name der neuen Sammlung').fill('E2E-Teilen')
	await dlg.getByRole('button', { name: 'Teilen', exact: true }).click()
	await expect(page).toHaveURL(/#\/shared\?c=/)
	const coll = decodeURIComponent(/c=([^&]+)/.exec(page.url())[1])
	const box = page.locator('#coll-' + coll)
	await expect(box).toHaveClass(/shared__coll--focus/)
	await expect(box.locator('h3')).toHaveText('E2E-Teilen')
	await expect(box.locator('.shared__items')).toContainText('E2E-Teilprojekt')
	await expect(box.locator('.shared__items')).toContainText('Teil-Exegese')
	for (const [type, key] of [['project', 'project:' + pid], ['projectOcc', 'projectOcc:' + pid], ['pericope', 'pericope:' + eid]]) {
		await expect.poll(async () => (await record(request, type, key))?.collection, { message: key }).toBe(coll)
	}

	// the deck into the same, existing collection; its picture is still there
	await page.goto(`/index.php/apps/phos/#/decks/${did}`)
	await page.locator('.decks__top').getByRole('button', { name: 'Teilen …' }).click()
	const dlg2 = page.getByRole('dialog', { name: '„E2E-Teilfolien“ teilen' })
	await dlg2.locator('.vs__dropdown-toggle').click()
	await page.locator('.vs__dropdown-option', { hasText: 'E2E-Teilen' }).click()
	await dlg2.getByRole('button', { name: 'Teilen', exact: true }).click()
	await expect(page.locator('#coll-' + coll + ' .shared__items')).toContainText('E2E-Teilfolien')
	await expect.poll(async () => (await record(request, 'presAssets', 'presAssets:' + did))?.collection).toBe(coll)
	await page.goto(`/index.php/apps/phos/#/decks/${did}`)
	await expect(page.locator('.decks__top').getByRole('button', { name: 'Geteilt' })).toBeVisible()
	const img = page.locator('.decks__stage section.present .phos-image img')
	await expect(img).toHaveAttribute('src', new RegExp(`/files/${coll}/Praesentationen/${did}/bild\\.png$`))
	await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth)).toBe(1)

	// and the project back out: personal again, with what belongs to it
	await page.goto(`/index.php/apps/phos/#/shared?c=${coll}`)
	page.once('dialog', d => d.accept())
	await page.locator('#coll-' + coll + ' .shared__items li', { hasText: 'E2E-Teilprojekt' }).getByRole('button', { name: 'Aus der Sammlung nehmen' }).click()
	await expect(page.locator('#coll-' + coll + ' .shared__items')).not.toContainText('E2E-Teilprojekt')
	const personal = (await api(request, 'GET', '/status')).personalCollection
	for (const [type, key] of [['project', 'project:' + pid], ['projectOcc', 'projectOcc:' + pid], ['pericope', 'pericope:' + eid]]) {
		await expect.poll(async () => (await record(request, type, key))?.collection, { message: key }).toBe(personal)
	}
})

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

	test('phone layout: nothing wider than the screen, Bible and “today” one at a time', async ({ page }) => {
		for (const r of ['read/TINYZ/Gen/1', 'bible/TINYZ/Gen/1?p=TINYSYN', 'library', 'search', 'bookmarks', 'pads', 'plan', 'sermons', 'decks', 'shared', 'remote']) {
			await page.goto('/index.php/apps/phos/#/' + r)
			await page.waitForTimeout(800)
			const wide = await page.evaluate(() => [...document.querySelectorAll('#content-vue *')]
				.filter(e => e.offsetParent && !e.closest('.v-popper, .reveal') && e.getBoundingClientRect().right > window.innerWidth + 1)
				.map(e => e.tagName + '.' + e.className).slice(0, 3))
			expect(wide, r).toEqual([])
		}
		await page.goto('/index.php/apps/phos/#/read/TINYZ/Gen/1')
		await expect(page.locator('.bible__text')).toBeVisible()
		await expect(page.locator('.reading__side')).toBeHidden()
		await page.getByRole('tab', { name: 'Heute und mehr' }).click()
		await expect(page.locator('.reading__side')).toBeVisible()
		await expect(page.locator('.bible__text')).toBeHidden()
		// the chapter navigation fits on one line
		await page.getByRole('tab', { name: 'Bibel' }).click()
		const nav = await page.locator('.bible__nav').boundingBox()
		expect(nav.height).toBeLessThan(60)
	})
})

test('modules on both sides: what only a desktop has shows greyed, not readable; the tab has the bulb', async ({ page, request }) => {
	await desktopPush(request, { type: 'moduleInventory', key: 'inv:dddddddddddddddd', payload: {
		device: 'Arbeitszimmer',
		modules: [
			{ name: 'TINYZ', description: 'Fixture tinyz', modDrv: 'zText', lang: 'en', category: '', readingPlan: false },
			{ name: 'NurLokal', description: 'Nur am Desktop', modDrv: 'zText', lang: 'de', category: '', readingPlan: false },
			{ name: 'LokalLex', description: 'Lexikon am Desktop', modDrv: 'RawLD4', lang: 'de', category: '', readingPlan: false },
		],
	} })
	await page.goto('/index.php/apps/phos/#/library')
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()
	await page.locator('.library__filter input').fill('desktop')
	const local = page.locator('.library__node--local', { hasText: 'Nur am Desktop' })
	await expect(local).toBeVisible()
	await expect(local).toContainText('nur auf Arbeitszimmer')
	expect(await local.evaluate(el => el.tagName)).toBe('SPAN')               // not a link
	await expect(page.locator('.library__node--local', { hasText: 'Lexikon am Desktop' })).toBeVisible()
	await page.locator('.library__filter input').fill('tinyz')
	await expect(page.locator('.library__node--module', { hasText: 'Fixture tinyz' })).toHaveCount(1)   // online: once, readable
	await expect(page.locator('.library__node--local')).toHaveCount(0)
	// the Bible picker lists it, but it cannot be chosen
	await page.goto('/index.php/apps/phos/#/bible/TINYZ/Gen/1')
	await page.locator('.bible__module').first().locator('.vs__dropdown-toggle').click()
	const opt = page.locator('.vs__dropdown-option', { hasText: 'NurLokal' })
	await expect(opt).toContainText('nur auf Arbeitszimmer')
	await expect(opt).toHaveClass(/vs__dropdown-option--disabled/)
	// favicon: the light bulb
	const href = await page.locator('link[rel="icon"][type="image/svg+xml"]').last().getAttribute('href')
	expect(href).toMatch(/phos\/img\/favicon\.svg/)
})

test('syntax diagram saved on the desktop shows read-only in the sidebar (Phase 3, Scope 3)', async ({ page, request }) => {
	const diagram = {
		osis: 'John.3.16',
		els: [
			{ k: 't', x: 40, y: 60, t: 'For God', c: 'wd', r: 0, w: -1 },
			{ k: 'l', x1: 30, y1: 80, x2: 200, y2: 80, c: 'base' },
		],
		w: 400, h: 140,
	}
	await desktopPush(request, { type: 'syntaxDiagram', key: 'syntaxDiagram:John.3.16', payload: diagram })
	await page.goto('/index.php/apps/phos/#/bible/TINYZ/John/3')
	await expect(page.locator('.bible__text')).toBeVisible()
	await page.getByRole('button', { name: 'Jetzt abgleichen' }).click()

	const marker = page.locator('.bible__text [data-v="16"] .bible__syntaxmark')
	await expect(marker).toBeVisible()
	// a verse with no diagram gets no marker
	await expect(page.locator('.bible__text [data-v="15"] .bible__syntaxmark')).toHaveCount(0)

	await marker.click()
	const sidebar = page.locator('.app-sidebar')
	await expect(sidebar).toContainText('Satzdiagramm')
	const diagramFrame = page.frameLocator('.syn-panel__frame')
	await expect(diagramFrame.locator('#view svg text').first()).toContainText('For God')
	await expect(diagramFrame.locator('#tools')).toHaveCount(0)   // read-only: no drawing toolbar
})
