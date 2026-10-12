#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { getAccessToken, login, ORIGIN } from './auth.ts'

// A stdio MCP server for JustGains. It serves the same tool catalog as the
// hosted server at https://justgains.com/connect/mcp, read from the live
// catalog so schemas never drift, and executes each call through the JustGains
// tool API with the signed-in user's token.

const VERSION = '1.1.0'

interface CatalogTool extends Tool {
	securitySchemes?: { type: string }[]
	path: string
}

interface ToolResponse {
	success?: boolean
	content?: CallToolResult['content']
	data?: Record<string, unknown>
	error?: string
	message?: string
}

const headers = (token?: string): Record<string, string> => ({
	'Content-Type': 'application/json',
	'User-Agent': `justgains-mcp-server/${VERSION}`,
	'X-JustGains-Client': 'mcp',
	...(process.env.JUSTGAINS_MEASUREMENT_SYSTEM
		? { 'X-JustGains-Measurement-System': process.env.JUSTGAINS_MEASUREMENT_SYSTEM }
		: {}),
	...(token ? { Authorization: `Bearer ${token}` } : {}),
})

let catalog: Promise<CatalogTool[]> | undefined

function loadCatalog(): Promise<CatalogTool[]> {
	catalog ??= fetch(`${ORIGIN}/mcp/tools`, { headers: headers(), signal: AbortSignal.timeout(30_000) })
		.then(async response => {
			if (!response.ok) throw new Error(`JustGains tool catalog unavailable (HTTP ${response.status}).`)

			return ((await response.json()) as { tools: CatalogTool[] }).tools
		})
		.catch(error => {
			catalog = undefined
			throw error
		})

	return catalog
}

const requiresAccount = (tool: CatalogTool) =>
	!(tool.securitySchemes ?? []).some(scheme => scheme.type === 'noauth')

function text(message: string, isError = true): CallToolResult {
	return { content: [{ type: 'text', text: message }], isError }
}

async function callTool(name: string, args: unknown): Promise<CallToolResult> {
	const tool = (await loadCatalog()).find(item => item.name === name)
	if (!tool) return text(`Unknown JustGains tool: ${name}.`)
	const token = await getAccessToken()
	if (!token && requiresAccount(tool)) {
		return text(
			'This needs a connected JustGains account. Run `bun run mcp-server/src/index.ts login` (or set JUSTGAINS_ACCESS_TOKEN) and try again.',
		)
	}
	const response = await fetch(new URL(tool.path, ORIGIN), {
		method: 'POST',
		headers: headers(token),
		body: JSON.stringify(args ?? {}),
		signal: AbortSignal.timeout(120_000),
	})
	const body = (await response.json().catch(() => ({}))) as ToolResponse
	if (response.status === 401) {
		return text('The JustGains sign-in has expired. Run `bun run mcp-server/src/index.ts login` again.')
	}
	if (!response.ok || body.success === false) {
		const detail = body.content ?? [{ type: 'text', text: body.message ?? body.error ?? `HTTP ${response.status}` }]

		return { content: detail, isError: true }
	}

	return {
		content: body.content ?? [{ type: 'text', text: JSON.stringify(body.data ?? {}) }],
		...(body.data ? { structuredContent: body.data } : {}),
	}
}

async function serve() {
	const server = new Server(
		{ name: 'JustGains', title: 'JustGains', version: VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'JustGains is a fitness platform: workouts, programs, exercise library, training history and food logging. Resolve real exercise codes with search_exercises before create_workout or update_workout. Account tools need a signed-in user.',
		},
	)
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: (await loadCatalog()).map(({ name, title, description, inputSchema, annotations }) => ({
			name,
			title,
			description,
			inputSchema,
			annotations,
		})),
	}))
	server.setRequestHandler(CallToolRequestSchema, async request => {
		try {
			return await callTool(request.params.name, request.params.arguments)
		} catch (error) {
			return text(error instanceof Error ? error.message : 'JustGains is unavailable right now.')
		}
	})
	await server.connect(new StdioServerTransport())
}

if (process.argv[2] === 'login') {
	await login()
} else {
	await serve()
}
