import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, '.cursor-plugin/plugin.json'), 'utf8'))
assert.equal(manifest.name, 'justgains')
assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
assert.equal(manifest.repository, 'https://github.com/JustGains/justgains-connector')
for (const path of [manifest.logo, manifest.mcpServers, 'README.md', 'LICENSE']) {
  assert.equal(typeof path, 'string')
  assert(!path.startsWith('/') && !path.includes('..'))
  await access(resolve(root, path))
}
const config = JSON.parse(await readFile(resolve(root, manifest.mcpServers), 'utf8'))
assert.deepEqual(config, { mcpServers: { justgains: { url: 'https://justgains.com/grok/mcp' } } })
console.log('PASS package manifest and remote MCP configuration')

const origin = 'https://justgains.com'
let sessionId: string | null = null
let protocolVersion = '2025-03-26'
let requestId = 0

async function rpc(method: string, params: unknown = {}, notification = false) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': protocolVersion,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++requestId }), method, params }),
    signal: AbortSignal.timeout(45000),
  })
  assert(response.ok, `${method}: HTTP ${response.status}`)
  sessionId = response.headers.get('mcp-session-id') ?? sessionId
  if (notification) return
  const body = await response.text()
  const envelope = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(item => item.id === requestId)
    : JSON.parse(body)
  assert(envelope, `${method}: missing JSON-RPC response`)
  assert(!envelope.error, `${method}: JSON-RPC error`)
  return envelope.result
}

const initialized = await rpc('initialize', {
  protocolVersion,
  capabilities: {},
  clientInfo: { name: 'justgains-connector-verification', version: manifest.version },
})
assert(initialized.serverInfo.name)
protocolVersion = initialized.protocolVersion
await rpc('notifications/initialized', {}, true)
const discovery = await rpc('tools/list')
const names = discovery.tools.map((tool: { name: string }) => tool.name)
for (const name of ['search_exercises', 'create_workout', 'get_my_profile', 'get_my_workout_logs', 'log_my_food']) {
  assert(names.includes(name), `Missing ${name}`)
}
const catalog = await fetch(`${origin}/mcp/tools`).then(response => response.json())
assert.deepEqual([...names].sort(), catalog.tools.map((tool: { name: string }) => tool.name).sort())
console.log(`PASS MCP initialization and ${names.length} tools, matching the live REST catalog`)

const search = await rpc('tools/call', { name: 'search_exercises', arguments: { query: 'bench press', limit: 2 } })
assert(!search.isError)
assert(JSON.stringify(search).includes('exerciseCode'))
console.log('PASS public MCP exercise search')

const resources = await rpc('resources/list')
const templates = new Set<string>()
for (const name of ['show_workout', 'generate_workout', 'create_workout', 'get_my_food_diary', 'log_my_food', 'remove_my_food', 'create_route']) {
  const tool = discovery.tools.find((item: { name: string }) => item.name === name)
  const resourceUri = tool?._meta?.ui?.resourceUri
  assert.equal(typeof resourceUri, 'string', `${name}: missing MCP Apps card`)
  assert.equal(resourceUri, tool._meta['openai/outputTemplate'], `${name}: card differs between hosts`)
  assert(resources.resources.some((item: { uri: string }) => item.uri === resourceUri))
  templates.add(resourceUri)
}
for (const uri of templates) {
  const card = await rpc('resources/read', { uri })
  const content = card.contents[0]
  assert.equal(content.mimeType, 'text/html;profile=mcp-app')
  assert(content.text.includes('ui/initialize'), `${uri}: missing MCP Apps initialization`)
  assert(content.text.length > 1000, `${uri}: missing card content`)
  assert.equal(content._meta['openai/widgetDomain'], 'https://widget.justgains.com')
}
console.log(`PASS ${templates.size} shared MCP Apps cards for workouts, nutrition, and routes`)

const privateResponse = await fetch(`${origin}/mcp/tools/get_my_profile`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
})
assert.equal(privateResponse.status, 401)
console.log('PASS private profile requires authorization')

for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
  const response = await fetch(`${origin}${path}`)
  assert(response.ok)
  const metadata = await response.json()
  if ('authorization_endpoint' in metadata) {
    assert.equal(metadata.authorization_endpoint, `${origin}/oauth/authorize`)
    assert(metadata.code_challenge_methods_supported.includes('S256'))
  } else {
    assert.equal(metadata.resource, `${origin}/mcp`)
  }
}
const registration = await fetch(`${origin}/oauth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Grok Bot',
    redirect_uris: ['https://www.cursor.com/bot/mcp/oauth/callback'],
    token_endpoint_auth_method: 'none',
  }),
})
assert.equal(registration.status, 201)
const registered = await registration.json()
assert(registered.client_id.startsWith('mcp_grok-bot_'))
assert.equal(registered.token_endpoint_auth_method, 'none')
console.log('PASS OAuth metadata and public PKCE client registration')

const challenge = await fetch(`${origin}/grok/mcp`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
})
assert.equal(challenge.status, 401)
assert(challenge.headers.get('www-authenticate')?.includes(`${origin}/.well-known/oauth-protected-resource/grok/mcp`))
const protectedMetadata = await fetch(`${origin}/.well-known/oauth-protected-resource/grok/mcp`).then(response => response.json())
assert.equal(protectedMetadata.resource, `${origin}/grok/mcp`)
console.log('PASS Grok Bot endpoint starts the standard OAuth browser connection')

for (const callback of ['https://www.cursor.com/bot/mcp/oauth/callback', 'https://www.cursor.com/agents/mcp/oauth/callback']) {
  const params = new URLSearchParams({ response_type: 'code', client_id: registered.client_id, redirect_uri: callback, state: 'connector-verification' })
  const response = await fetch(`${origin}/oauth/authorize?${params}`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.origin + location.pathname, callback)
  assert.equal(location.searchParams.get('error'), 'invalid_request')
  assert.equal(location.searchParams.get('state'), 'connector-verification')
}
console.log('PASS Grok Bot/Cursor callbacks are accepted and require PKCE')
