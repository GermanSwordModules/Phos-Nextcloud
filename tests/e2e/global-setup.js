import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** A fresh user with the fixture modules, a label and two bookmarks (seed.py). */
export default async function () {
	const dir = path.dirname(fileURLToPath(import.meta.url))
	const out = execFileSync('python3', ['-I', path.join(dir, 'seed.py'),
		process.env.PHOS_URL || 'http://127.0.0.1:8090',
		process.env.PHOS_ADMIN || 'admin', process.env.PHOS_ADMIN_PW || 'phos-dev-pw'], { encoding: 'utf8' })
	const creds = JSON.parse(out.trim().split('\n').pop())
	process.env.PHOS_USER = creds.user
	process.env.PHOS_PW = creds.password
}
