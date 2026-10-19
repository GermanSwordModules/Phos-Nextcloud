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
