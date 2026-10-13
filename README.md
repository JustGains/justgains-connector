# JustGains MCP server

[![smithery badge](https://smithery.ai/badge/justgains/justgains)](https://smithery.ai/servers/justgains/justgains)

The official [JustGains](https://justgains.com) MCP server. It lets an AI agent build and save workouts, read a person's training history and progress, search the JustGains exercise library, plan routes, and log meals and bodyweight in their JustGains account.

There are two ways to run it: connect to the hosted server (nothing to install), or run the stdio server in [`mcp-server/`](mcp-server) on your own machine.

## Connect to the hosted server

| Endpoint | Transport | Auth |
| --- | --- | --- |
| `https://justgains.com/connect/mcp` | Streamable HTTP | OAuth 2.0 |

Add it as a remote MCP server and complete the browser sign-in with the JustGains account you use on your phone. An unauthenticated request returns `401` with a `WWW-Authenticate` challenge, so MCP clients start the sign-in on their own. Authentication uses the authorization code flow with PKCE S256, dynamic client registration, and the `workouts progress profile` scopes. No API key is needed and no credentials are stored in this repository.

Claude Code:

```sh
claude mcp add --transport http justgains https://justgains.com/connect/mcp
```

Cursor and other clients that read an `mcpServers` file:

```json
{
  "mcpServers": {
    "justgains": {
      "url": "https://justgains.com/connect/mcp"
    }
  }
}
```

### Grok Bot and Cursor plugin

This repository is also the JustGains plugin for Grok Bot and Cursor (`.cursor-plugin/plugin.json`, `mcp.json`, `.mcp.json`), which connects to `https://justgains.com/grok/mcp`, the same server and tools. In Grok Bot, open Marketplace, find JustGains when its listing is available, and choose Add, then complete the JustGains authorization in your browser. Mention JustGains with `@` in a conversation to use it. Marketplace listing requires review; publishing this repository does not mean the listing has been approved. Where custom MCP servers are allowed, add a Remote HTTPS server with either URL. Team policies may restrict custom servers.

## Run it locally (stdio)

`mcp-server/` is a stdio MCP server written in TypeScript on the official MCP SDK. It serves the live JustGains tool catalog, so its schemas always match the hosted server, and executes each call through the JustGains tool API as the signed-in user. It needs [Bun](https://bun.sh).

```sh
git clone https://github.com/JustGains/justgains-connector.git
cd justgains-connector/mcp-server
bun install
bun run login   # opens the JustGains sign-in in your browser
```

`login` runs the same OAuth flow as the hosted server with a loopback redirect and stores the rotating refresh token in `~/.justgains/mcp-credentials.json`. Without signing in, the public tools (exercise search, workout generation and previews) still work. Then point your client at the server:

```json
{
  "mcpServers": {
    "justgains": {
      "command": "bun",
      "args": ["run", "/path/to/justgains-connector/mcp-server/src/index.ts"]
    }
  }
}
```

| Variable | Purpose |
| --- | --- |
| `JUSTGAINS_ACCESS_TOKEN` | Use this access token instead of the stored sign-in. |
| `JUSTGAINS_MEASUREMENT_SYSTEM` | `imperial` or `metric` for summaries and cards. Unset uses imperial. |
| `JUSTGAINS_CREDENTIALS` | Where `login` stores credentials. |

The Dockerfile builds and runs the same stdio server.

## Tools

Tools marked "account" need a signed-in user. Every tool declares its read-only, destructive and open-world hints.

**Workouts**

- `generate_workout`: build a saved workout from a plain-language request ("30-minute dumbbell push day"). Works without an account.
- `show_workout`: show a workout's exercises, sets and rest by ID.
- `create_workout`, `update_workout` (account): save or edit a workout with exact exercises, sets, reps, loads and set types.
- `search_exercises`: search the exercise library by name, muscle group or equipment, returning the exact exercise codes the write tools need.
- `get_exercise_details` (account): instructions, muscles and equipment for one exercise.

**Training history and progress** (account)

- `get_my_workout_logs`, `get_workout_history`: completed workouts with dates, exercises and top sets.
- `get_my_exercise_history`: every recorded set of one lift, plus the personal best.
- `get_my_top_exercises`, `get_progress`, `summarize_my_week`, `analyze_my_consistency`: rankings, volume, weekly recap, streaks and training frequency.

**Programs and routes** (account)

- `search_workout_programs`, `get_workout_program`: browse multi-week programs.
- `create_workout_program`, `set_my_program_engagement`: create a program, or start or leave one.
- `create_route`: plan a road-and-path-snapped run, ride, walk or hike route.

**Food and bodyweight** (account)

- `log_my_food`: log a whole meal in one call, with disclosed estimates when portions are missing; also corrects an earlier entry.
- `get_my_food_diary`, `search_foods`, `remove_my_food`: read the diary and daily macros, search the food catalog, delete entries.
- `log_my_weight`, `get_my_weight_history`: bodyweight entries and trend.
- `get_my_profile`: the user's profile, units and preferences.

Read the live catalog with full input schemas at [justgains.com/mcp/tools](https://justgains.com/mcp/tools), or the [OpenAPI contract](https://justgains.com/mcp/openapi.json).

## Try asking

- "Use JustGains to build a 30-minute dumbbell workout and save it to my account."
- "Show my completed JustGains workouts from the last seven days."
- "Check how my bench press changed this month."
- "Log two eggs, two slices of toast, and a coffee with milk in JustGains for breakfast."

A generated workout is a saved plan. Open its returned JustGains link to review the exercises, start the session, and log the sets you complete. Creating a plan does not record a completed workout. Meal logging uses the connected user's food diary; missing portion details and nutrition estimates are disclosed. The mobile app receives those changes through its usual sync.

Tool responses include text and links, so the server works in hosts without MCP Apps cards. Hosts that support MCP Apps also get interactive workout and food cards. After a write timeout, check the result before retrying. Food logging retries must keep the original `requestId` to avoid duplicate entries.

## Verify

`bun run verify` (from the repository root) validates the plugin manifest and bundled paths, performs MCP initialization and tool discovery against production, searches the public exercise library, checks OAuth metadata and registration, and verifies that unauthenticated requests cannot read a private profile. It never creates workouts or food entries.

## Links

- [JustGains](https://justgains.com)
- [Use JustGains in Claude](https://justgains.com/learn/use-justgains-in-claude), [ChatGPT](https://justgains.com/learn/use-justgains-in-chatgpt) and [Grok Bot](https://justgains.com/learn/use-justgains-in-grok)
- [Privacy policy](https://justgains.com/privacy) and [terms](https://justgains.com/terms)
- Support: support@justgains.com

The MIT license in this repository applies to this connector package and the stdio server, not to the hosted JustGains service.
