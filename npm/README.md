# hproxy-mcp

[HProxy](https://hproxy.com)'s MCP server for AI assistants, and a small command line: a live free proxy list, a real proxy checker and an IP lookup. No key, no account, zero dependencies.

**The quickest way.** Ask your assistant to run this and follow what it prints, or run it yourself:

```bash
npx -y hproxy-mcp setup
```

It prints the exact steps for each app (Claude Code, Claude Desktop, ChatGPT, Cursor, VS Code, Windsurf, Gemini CLI, Codex), read live from hproxy.com. `npx -y hproxy-mcp setup cursor` prints one app, `--json` gives the same to a program, and `npx -y hproxy-mcp doctor` checks that everything works from your computer.

## Run it as an MCP server

For apps that start MCP servers on your computer: Claude Desktop, Cursor, Windsurf, VS Code, Gemini CLI, Codex and others. It needs Node 18 or newer.

**Claude Code.** In a terminal:

```bash
claude mcp add hproxy -- npx -y hproxy-mcp
```

**Claude Desktop, Cursor, Windsurf, Gemini CLI.** In the app's MCP settings file:

```json
{ "mcpServers": { "hproxy": { "command": "npx", "args": ["-y", "hproxy-mcp"] } } }
```

**VS Code.** In .vscode/mcp.json:

```json
{ "servers": { "hproxy": { "type": "stdio", "command": "npx", "args": ["-y", "hproxy-mcp"] } } }
```

**Codex.** In ~/.codex/config.toml:

```toml
[mcp_servers.hproxy]
command = "npx"
args = ["-y", "hproxy-mcp"]
```

**Nothing to install.** An app that takes a remote MCP server can use HProxy's hosted server directly, the same server this package talks to:

```
https://mcp.hproxy.com/mcp
```

The line for each app is on [github.com/hproxy-com/hproxy-mcp](https://github.com/hproxy-com/hproxy-mcp). The server is listed in the official MCP Registry as `com.hproxy/mcp`.

## The tools

| Tool | What it does | Arguments |
|---|---|---|
| `proxy_list` | Fetch live free proxies from HProxy's public pool, re-checked around the clock. No key. Returns ip, port, protocols, anonymity, country, city, network, latency and 24h uptime per proxy. Use this when the user wants free proxies to test with. Free proxies are public and come and go, so check them before relying on one. | `anonymity`: one of `elite`, `anonymous`, `transparent`. Only proxies of exactly this anonymity grade: elite hides both your address and the fact that a proxy is used, anonymous hides your address, transparent passes it on.<br>`country`: ISO 3166 alpha-2 country code, e.g. 'de'. Omit for every country.<br>`limit`: 1 to 200, default 25. How many to return. The full list is thousands; ask for what you need.<br>`protocol`: one of `http`, `https`, `socks4`, `socks5`. Only proxies speaking this protocol. |
| `proxy_check` | Run a real live test on one or more proxies: is it alive, which protocols it speaks, its anonymity grade, latency and location. No key. Each check opens a real connection, so a dead proxy can take a few seconds. Up to 25 per call. | `proxies` (required): Proxies as ip:port, e.g. ['203.0.113.7:1080']. Up to 25. |
| `ip_lookup` | Look up any public IP address: country, region, city, coordinates, timezone, ASN and the network that runs it. No key. Up to 50 per call. | `ips` (required): IPv4 or IPv6 addresses. One is the common case. |

All three only read. None of them needs a key.

## Use it as a command line

```bash
npx hproxy-mcp list --country de --protocol socks5 --limit 20
npx hproxy-mcp check 203.0.113.7:1080 198.51.100.3:8080
npx hproxy-mcp ip 8.8.8.8
npx hproxy-mcp tools
```

Every command prints JSON, so it pipes into `jq`. `npm install -g hproxy-mcp` puts `hproxy-mcp` on your path.

## How it works

The package speaks MCP over stdin and stdout and hands every message to HProxy's hosted server at https://mcp.hproxy.com/mcp, which answers it. So the tools, their descriptions and their limits are always the hosted server's own, and a new tool there reaches you without an update. When the server cannot be reached, every request still gets an answer: a tool call returns a sentence the model can read, asking it to try again in a few seconds.

What it sends: each message your assistant writes to it, with a user agent naming this package. What HProxy keeps for each call is in the privacy policy: https://hproxy.com/privacy

## Good to know

- These are public free proxies. Expect fewer than half to answer at any moment, set short timeouts, and never send passwords or personal data through one.
- Limits are per IP address. The checker takes 120 requests in a burst, then 5 a second, and 300,000 proxies a day, because every check opens a real connection. Past a limit, the tool says how many seconds to wait.
- For proxies that must hold up against real blocking, HProxy sells [residential proxies](https://hproxy.com/residential-proxies?utm_source=npm&utm_medium=readme&utm_campaign=hproxy-mcp): 30M+ addresses in 200+ countries, rotating or sticky, paid by the GB.

## Support

Support is staffed around the clock at [hproxy.com/contact](https://hproxy.com/contact). You may build these tools into your own software, free of charge and without asking.

## License

MIT.
