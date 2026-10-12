import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// Credentials come from one of two places:
// 1. JUSTGAINS_ACCESS_TOKEN, for hosts that inject a token themselves.
// 2. `login`, which runs the same OAuth 2.0 + PKCE flow the hosted connector
//    uses and stores the rotating refresh token in the user's home directory.
// Without either, the public tools (exercise search, workout generation and
// previews) still work and account tools return a sign-in message.

export const ORIGIN = process.env.JUSTGAINS_ORIGIN ?? 'https://justgains.com'
const SCOPES = 'workouts progress profile'
const STORE = process.env.JUSTGAINS_CREDENTIALS ?? join(homedir(), '.justgains', 'mcp-credentials.json')

interface StoredCredential {
	origin: string
	clientId: string
	accessToken: string
	refreshToken?: string
	expiresAt?: number
}

async function readStore(): Promise<StoredCredential | null> {
	try {
		const stored = JSON.parse(await readFile(STORE, 'utf8')) as StoredCredential

		return stored.origin === ORIGIN ? stored : null
	} catch {
		return null
	}
}

async function writeStore(credential: StoredCredential) {
	await mkdir(dirname(STORE), { recursive: true })
	await writeFile(STORE, JSON.stringify(credential, null, 2), { mode: 0o600 })
	await chmod(STORE, 0o600).catch(() => {})
}

async function exchange(clientId: string, params: Record<string, string>): Promise<StoredCredential> {
	const response = await fetch(`${ORIGIN}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: clientId, ...params }),
	})
	if (!response.ok) throw new Error(`JustGains sign-in failed (HTTP ${response.status}).`)
	const token = (await response.json()) as {
		access_token: string
		refresh_token?: string
		expires_in?: number
	}

	return {
		origin: ORIGIN,
		clientId,
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
	}
}

/** The bearer token for account tools, refreshed when it is about to expire. */
export async function getAccessToken(): Promise<string | undefined> {
	if (process.env.JUSTGAINS_ACCESS_TOKEN) return process.env.JUSTGAINS_ACCESS_TOKEN
	const stored = await readStore()
	if (!stored) return undefined
	const fresh = !stored.expiresAt || stored.expiresAt - Date.now() > 60_000
	if (fresh || !stored.refreshToken) return stored.accessToken
	try {
		const refreshed = await exchange(stored.clientId, {
			grant_type: 'refresh_token',
			refresh_token: stored.refreshToken,
		})
		await writeStore({ ...refreshed, refreshToken: refreshed.refreshToken ?? stored.refreshToken })

		return refreshed.accessToken
	} catch {
		return undefined
	}
}

/** Browser sign-in with a loopback redirect. Prints progress to stderr. */
export async function login() {
	const verifier = randomBytes(48).toString('base64url')
	const challenge = createHash('sha256').update(verifier).digest('base64url')
	const state = randomBytes(16).toString('hex')
	let settle: (code: string) => void = () => {}
	let fail: (error: Error) => void = () => {}
	const received = new Promise<string>((resolve, reject) => {
		settle = resolve
		fail = reject
	})
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch(request) {
			const url = new URL(request.url)
			if (url.pathname !== '/callback') return new Response('Not found', { status: 404 })
			const code = url.searchParams.get('code')
			if (url.searchParams.get('state') !== state || !code) {
				fail(new Error('JustGains sign-in was cancelled or did not complete.'))

				return new Response('Sign-in did not complete. You can close this tab.', { status: 400 })
			}
			settle(code)

			return new Response('Signed in to JustGains. You can close this tab and return to your agent.')
		},
	})
	const redirectUri = `http://127.0.0.1:${server.port}/callback`
	try {
		const registration = (await fetch(`${ORIGIN}/oauth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_name: 'JustGains MCP server (local)',
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: 'none',
			}),
		}).then(response => response.json())) as { client_id: string }
		const authorizeUrl = `${ORIGIN}/oauth/authorize?${new URLSearchParams({
			response_type: 'code',
			client_id: registration.client_id,
			redirect_uri: redirectUri,
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state,
			scope: SCOPES,
		})}`
		console.error(`Open this link to sign in to JustGains:\n\n${authorizeUrl}\n`)
		const opener = process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : process.platform === 'darwin' ? ['open'] : ['xdg-open']
		Bun.spawn([...opener, authorizeUrl], { stdout: 'ignore', stderr: 'ignore' })
		const code = await Promise.race([
			received,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Timed out waiting for the JustGains sign-in.')), 5 * 60_000),
			),
		])
		await writeStore(
			await exchange(registration.client_id, {
				grant_type: 'authorization_code',
				code,
				code_verifier: verifier,
				redirect_uri: redirectUri,
			}),
		)
		console.error(`Signed in. Credentials saved to ${STORE}.`)
	} finally {
		server.stop(true)
	}
}
