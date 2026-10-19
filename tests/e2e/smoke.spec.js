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
	await expect(side.locator('.sermons')).toContainText('Keine eigene Predigt')
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
