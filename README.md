# HProxy MCP server

A free proxy list, a live proxy checker and an IP lookup for AI assistants, hosted by [HProxy](https://hproxy.com) at one address. No key, no account, nothing to install.

```
https://mcp.hproxy.com/mcp
```

It speaks MCP over Streamable HTTP and is listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=com.hproxy%2Fmcp) as `com.hproxy/mcp`.

## Add it to your assistant

**Claude Code.** In a terminal:

```bash
claude mcp add --transport http hproxy https://mcp.hproxy.com/mcp
```

Or as a plugin, which also adds a skill that tells Claude how to use the tools well:

```
/plugin marketplace add hproxy-com/hproxy-mcp
/plugin install hproxy@hproxy
```

**Claude and Claude Desktop.** Settings, Connectors, Add custom connector, then paste the address:

```
https://mcp.hproxy.com/mcp
```

**ChatGPT.** Settings, Security and login, turn on Developer mode, then create an app with this address and No authentication (Plus, Pro, Business, Enterprise and Education, on the web):

```
https://mcp.hproxy.com/mcp
```

**Cursor.** In ~/.cursor/mcp.json:

```json
{ "mcpServers": { "hproxy": { "url": "https://mcp.hproxy.com/mcp" } } }
```

**VS Code.** In .vscode/mcp.json:

```json
{ "servers": { "hproxy": { "type": "http", "url": "https://mcp.hproxy.com/mcp" } } }
```

**Windsurf.** In ~/.codeium/windsurf/mcp_config.json:

```json
{ "mcpServers": { "hproxy": { "serverUrl": "https://mcp.hproxy.com/mcp" } } }
```

**Gemini CLI.** As an extension, which also gives the model a short guide to the tools:

```bash
gemini extensions install https://github.com/hproxy-com/hproxy-mcp
```

Or by hand, in ~/.gemini/settings.json:

```json
{ "mcpServers": { "hproxy": { "httpUrl": "https://mcp.hproxy.com/mcp" } } }
```

**Any other MCP client.** Add `https://mcp.hproxy.com/mcp` as a remote server (Streamable HTTP) with no authentication.

## The tools

| Tool | What it does | Arguments |
|---|---|---|
| `proxy_list` | Live free proxies from HProxy's public pool, re-checked around the clock: ip, port, protocols, anonymity, country, city, network, latency and 24-hour uptime. | `country` (two-letter code, for example `de`), `protocol` (`http`, `https`, `socks4`, `socks5`), `anonymity` (`elite`, `anonymous`, `transparent`), `limit` (1 to 200, default 25) |
| `proxy_check` | A real live test of each proxy: alive or not, the protocols it speaks, its anonymity grade, latency and where it exits. | `proxies`: up to 25, as `ip:port` |
| `ip_lookup` | Country, region, city, coordinates, timezone, ASN and the network behind any public address, and whether HProxy has seen it acting as a public proxy. | `ips`: up to 50 IPv4 or IPv6 addresses |

All three only read. None of them needs a key.

## Things to ask

- "Give me twenty elite German SOCKS5 proxies and check which are alive."
- "Find five fast US HTTP proxies, test them, and give me only the working ones."
- "Who runs the network behind 8.8.8.8, and where is it?"

## Good to know

- These are public free proxies. Expect fewer than half to answer at any moment, set short timeouts, and never send passwords or personal data through one.
- Limits are per IP address. The checker allows roughly twelve checks a minute with bursts of ten, because every check opens a real connection. Past a limit, the tool says how many seconds to wait.
- For proxies that must hold up against real blocking, HProxy's paid proxies are at [hproxy.com/pricing](https://hproxy.com/pricing).

## The same tools without MCP

Plain HTTP, no key, CORS open:

```bash
curl "https://hproxy.com/api/proxy-list?format=json&protocol=socks5&country=us"
curl "https://hproxy.com/api/proxy-check?proxy=IP:PORT"
curl "https://hproxy.com/api/ip/8.8.8.8"
```

Documentation: [free proxy list API](https://hproxy.com/docs/free-proxy-list), [proxy checker API](https://hproxy.com/docs/free/proxy-checker), [IP lookup API](https://hproxy.com/docs/free/ip-lookup). Written for language models: [hproxy.com/llms.txt](https://hproxy.com/llms.txt).

From a terminal, the `hproxy` command comes with the [free HProxy app](https://hproxy.com/proxy-checker):

```bash
hproxy list --country DE --protocol socks5 --limit 20
hproxy check 203.0.113.7:1080 198.51.100.3:8080
hproxy ip 8.8.8.8
```

The whole list as plain files, updated around the clock: [hproxy-com/free-proxy-list](https://github.com/hproxy-com/free-proxy-list).

## Support

Support is staffed around the clock at [hproxy.com/contact](https://hproxy.com/contact). You may build these tools into your own software, free of charge and without asking.

## License

MIT, for the files in this repository.
