The official JustGains connector lets Grok Bot and Cursor build saved workouts, read your training history, and log meals in your JustGains account. It connects to the hosted MCP server at **https://justgains.com/grok/mcp**. No local server, API key, or package installation is needed to use the connection.

In Grok Bot, open Marketplace, find JustGains when its listing is available, and choose Add. Complete the JustGains authorization in your browser. Mention JustGains with `@` in a conversation to use it. Marketplace listing requires review; publishing this repository does not mean the listing has been approved.

Where custom MCP servers are allowed, add a Remote HTTPS server with `https://justgains.com/grok/mcp` and complete browser authorization. Team policies may restrict custom servers. Grok Bot uses the Cursor plugin infrastructure; this repository includes the Cursor plugin manifest and a remote MCP configuration.

In Cursor, add the following server to your MCP configuration and authenticate through the connection's browser sign-in:

```json
{
  "mcpServers": {
    "justgains": {
      "url": "https://justgains.com/grok/mcp"
    }
  }
}
```

Sign in with the JustGains account you use on your phone. Authentication uses OAuth authorization code flow with PKCE S256, dynamic client registration, and the `workouts progress profile` scopes. The plugin contains no credentials. Disconnect the plugin and revoke its JustGains connected session to stop access.

Try asking:

- "Use JustGains to build a 30-minute dumbbell workout and save it to my account."
- "Show my completed JustGains workouts from the last seven days."
- "Check how my bench press changed this month."
- "Log two eggs, two slices of toast, and a coffee with milk in JustGains for breakfast."

A generated workout is a saved plan. Open its returned JustGains link to review the exercises, start the session, and log the sets you complete. Creating a plan does not record a completed workout. Meal logging uses the connected user's food diary; missing portion details and nutrition estimates are disclosed. The mobile app receives those changes through its usual sync.

Tool responses include text and links, so the connector works in hosts without MCP Apps cards. The server also has shared widget resources for hosts that support them. This package does not promise a particular card layout in Grok Bot.

The tool catalog comes from the shared JustGains connector used by Claude and ChatGPT. To inspect it, read [the live catalog](https://justgains.com/mcp/tools) or [the OpenAPI contract](https://justgains.com/mcp/openapi.json). Use the returned schemas and exact exercise codes; do not invent IDs. After a write timeout, check the result before retrying. Food logging retries must retain the original `requestId` to avoid duplicate entries.

To verify this package and the public production connection, run `bun run verify`. The check validates the manifest and bundled paths, performs MCP initialization and tool discovery, searches the public exercise library, checks OAuth metadata and registration, and verifies that unauthenticated requests cannot read a private profile. It never creates workouts or food entries. A successful check does not prove an authenticated Grok Bot session or marketplace approval.

Read [Use JustGains in Grok Bot](https://justgains.com/learn/use-justgains-in-grok) for setup and examples. Account and service use are covered by the [JustGains privacy policy](https://justgains.com/privacy) and [terms](https://justgains.com/terms). The MIT license in this repository applies to this connector package, not to the hosted JustGains service.
