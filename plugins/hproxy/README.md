# HProxy plugin for Claude

Three free proxy tools for Claude from HProxy's hosted MCP server, plus a skill that tells Claude how to use them well. No key, no account, nothing to install or run on your computer.

## Install

In Claude Code, in a terminal:

```bash
claude plugin marketplace add hproxy-com/hproxy-mcp
claude plugin install hproxy@hproxy
```

## The tools

- `proxy_list`: live free proxies from HProxy's public pool, re-checked around the clock, filtered by country, protocol (HTTP, HTTPS, SOCKS4, SOCKS5) and anonymity (elite, anonymous, transparent), up to 200 at a time.
- `proxy_check`: a real live test of up to 25 proxies at once: whether each one answers, which protocols it speaks, its anonymity grade, its latency and where it exits.
- `ip_lookup`: country, region, city, timezone, ASN and the network behind up to 50 IP addresses.

All three only read. The skill `free-proxies` has Claude test proxies before handing them over, and tell you never to send passwords or personal data through a public proxy.

## What the plugin runs, sends and fetches

The plugin runs nothing on your computer. It connects Claude to one remote server, https://mcp.hproxy.com/mcp, which HProxy runs. A tool call sends that server only what the call carries: the filters for `proxy_list`, the proxies you ask about for `proxy_check`, the IP addresses you ask about for `ip_lookup`. Like every MCP connection, the handshake also names the client that is calling. To test a proxy, the server opens a connection through it from HProxy's side.

## Privacy, support and documentation

- Privacy policy: https://hproxy.com/privacy
- Support: https://hproxy.com/contact
- Documentation: https://hproxy.com/tools/ai

## License

MIT.
