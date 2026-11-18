#!/usr/bin/env node
/* Tests for hproxy-mcp, both faces.
 *
 * Part one runs against a stand-in server on this machine: what the relay forwards, how it
 * reads JSON and event-stream answers, and what it answers when the server is down or answers
 * no JSON-RPC at all. Part two runs against the live server at mcp.hproxy.com and asserts the
 * protocol and the shape, never a value that moves (which proxies are alive changes by the
 * minute).
 *
 *   node test.mjs
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");
const VERSION = (await import("node:fs")).readFileSync(ENTRY, "utf8").match(/const VERSION = "([^"]+)"/)[1];

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
};

/** Starts the relay and talks to it the way an app does: the first line (the handshake) goes
 *  alone, and the rest follow once its answer is back. Then stdin closes. Returns every
 *  message the relay printed. */
function stdio(lines, env = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const p = spawn(process.execPath, [ENTRY], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    const send = (l) => p.stdin.write((typeof l === "string" ? l : JSON.stringify(l)) + "\n");
    const [first, ...rest] = lines;
    let restSent = false;
    const sendRest = () => {
      if (restSent) return;
      restSent = true;
      rest.forEach(send);
      p.stdin.end();
    };
    p.stdout.on("data", (d) => {
      out += d;
      if (out.includes("\n")) sendRest();
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      resolve({
        code,
        ms: Date.now() - started,
        stderr: err,
        messages: out.split("\n").filter(Boolean).map((l) => JSON.parse(l)),
      }),
    );
    send(first);
    if (!rest.length) sendRest();
    setTimeout(() => p.kill(), 90_000).unref();
  });
}

/** Runs the command line and returns its exit code and output. */
function cli(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [ENTRY, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
    setTimeout(() => p.kill(), 90_000).unref();
  });
}

const byId = (messages) => Object.fromEntries(messages.filter((m) => m.id !== undefined).map((m) => [m.id, m]));
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hproxy-mcp-test", version: VERSION } } };
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };

/* ---------------------------------------------------------------- */
/* Part one: a stand-in server on this machine                       */
/* ---------------------------------------------------------------- */

console.log("against a stand-in server");
const seen = [];
let mode = "json";
/* The site's setup lines, shaped like hproxy.com/mcp-setup.json. */
const STAND_SETUP = {
  url: "https://stand-in.example/mcp",
  clients: [
    { name: "Claude Code", where: "In a terminal:", how: "claude mcp add --transport http hproxy https://stand-in.example/mcp" },
    { name: "Cursor", where: "In ~/.cursor/mcp.json:", how: '{ "mcpServers": { "hproxy": { "url": "https://stand-in.example/mcp" } } }' },
    { name: "ChatGPT", where: "Settings, then create an app with this address:", how: "https://stand-in.example/mcp" },
  ],
  plugins: [{ name: "Claude Code plugin", where: "In a terminal:", lines: ["claude plugin install hproxy@hproxy"] }],
};

const stand = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/mcp-setup.json") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(STAND_SETUP));
  }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const msg = JSON.parse(body);
    seen.push({ headers: req.headers, msg });
    if (mode === "html") {
      res.writeHead(502, { "content-type": "text/html" });
      return res.end("<html><body>502 Bad Gateway</body></html>");
    }
    if (msg.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    const result =
      msg.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stand-in", version: "0" } }
        : msg.method === "tools/call"
          ? { content: [{ type: "text", text: JSON.stringify({ echo: msg.params }) }] }
          : { tools: [{ name: "ip_lookup", annotations: { readOnlyHint: true } }] };
    const answer = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
    if (mode === "sse") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end(`event: message\ndata: ${answer}\n\n`);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(answer);
  });
});
await new Promise((r) => stand.listen(0, "127.0.0.1", r));
const STAND = {
  HPROXY_MCP_URL: `http://127.0.0.1:${stand.address().port}/mcp`,
  HPROXY_SETUP_URL: `http://127.0.0.1:${stand.address().port}/mcp-setup.json`,
  HPROXY_API_KEY: "",
};

{
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ip_lookup", arguments: { ips: ["8.8.8.8"] } } };
  const r = await stdio([INIT, INITIALIZED, "this is not json", call], STAND);
  const m = byId(r.messages);
  check("the handshake's answer comes back unchanged", m[1]?.result?.serverInfo?.name === "stand-in");
  check("a tool call goes through with its arguments", JSON.parse(m[2]?.result?.content?.[0]?.text ?? "{}").echo?.arguments?.ips?.[0] === "8.8.8.8");
  check("a line that is not JSON gets a parse error", r.messages.some((x) => x.id === null && x.error?.code === -32700));
  check("a notification gets no answer", r.messages.length === 3, `${r.messages.length} messages`);
  check("it leaves on its own once stdin closes", r.code === 0 && r.ms < 10_000, `exit ${r.code} after ${r.ms} ms`);
  const ua = seen.map((s) => s.headers["user-agent"]);
  check("every request names this package", ua.every((u) => u === `hproxy-mcp/${VERSION} (+https://hproxy.com/tools/ai)`), ua.join(" | "));
  const after = seen.find((s) => s.msg.id === 2);
  check("requests after the handshake carry its protocol version", after?.headers["mcp-protocol-version"] === "2025-06-18");
  check("no key is sent when none is set", seen.every((s) => !s.headers.authorization));
}

{
  seen.length = 0;
  mode = "sse";
  const r = await stdio([INIT], STAND);
  check("an event-stream answer is read like a JSON one", r.messages[0]?.result?.serverInfo?.name === "stand-in");
  mode = "json";
  await stdio([INIT], { ...STAND, HPROXY_API_KEY: "hpx_test" });
  check("a key that is set goes in the Authorization header", seen.at(-1)?.headers.authorization === "Bearer hpx_test");
}

{
  mode = "html";
  const call = { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "proxy_list", arguments: {} } };
  const r = await stdio([INIT, call], STAND);
  const m = byId(r.messages);
  check("a page that is no JSON-RPC answer: the handshake gets a JSON-RPC error", m[1]?.error?.code === -32603 && /HTTP 502/.test(m[1]?.error?.message));
  check("and a tool call gets a tool result with isError and a sentence", m[5]?.result?.isError === true && /Retry in a few seconds/.test(m[5]?.result?.content?.[0]?.text));
  mode = "json";
}

{
  const all = await cli(["setup"], STAND);
  check("setup prints every app's line from the site's setup", all.code === 0 && STAND_SETUP.clients.every((c) => all.out.includes(c.how)), all.err);
  check("setup adds the local lines and Codex", all.out.includes("claude mcp add hproxy -- npx -y hproxy-mcp") && all.out.includes("[mcp_servers.hproxy]"));
  check("setup names the plugins and the check", all.out.includes("claude plugin install hproxy@hproxy") && all.out.includes("npx hproxy-mcp doctor"));
  check("ChatGPT gets no local line (it only takes a remote server)", !/ChatGPT\n[^\n]*\n[^\n]*\n  Or start it/.test(all.out));
  const one = await cli(["setup", "cursor"], STAND);
  check("setup cursor prints Cursor alone", one.code === 0 && one.out.includes("~/.cursor/mcp.json") && !one.out.includes("Claude Code") && !one.out.includes("Codex"));
  const json = await cli(["setup", "--json", "cursor"], STAND);
  let parsed = null;
  try {
    parsed = JSON.parse(json.out);
  } catch {}
  check("setup --json is JSON a program can read", parsed?.apps?.length === 1 && parsed.apps[0].name === "Cursor" && parsed.local?.command === "npx");
  const typo = await cli(["setup", "notepad"], STAND);
  check("an app setup does not know says so and names the apps", typo.code === 1 && typo.err.includes("Cursor") && typo.err.includes("Codex"));
  const offline = await cli(["setup"], { ...STAND, HPROXY_SETUP_URL: "http://127.0.0.1:9/mcp-setup.json" });
  check("without the site, setup still prints the address and Claude Code's line", offline.code === 0 && offline.out.includes("claude mcp add --transport http hproxy") && offline.out.includes("could not be reached"));
  const fine = await cli(["doctor"], STAND);
  check("doctor passes against a working server", fine.code === 0 && fine.out.includes("Everything works"), fine.out + fine.err);
}
stand.close();

{
  const call = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ip_lookup", arguments: { ips: ["8.8.8.8"] } } };
  const r = await stdio([INIT, call], { HPROXY_MCP_URL: "http://127.0.0.1:9/mcp" });
  const m = byId(r.messages);
  check("a server that cannot be reached: every request still gets its answer", m[1]?.error?.code === -32603 && m[7]?.result?.isError === true);
  check("and the reason is in words", /could not be reached/.test(m[7]?.result?.content?.[0]?.text ?? ""));
  const down = await cli(["ip", "8.8.8.8"], { HPROXY_MCP_URL: "http://127.0.0.1:9/mcp" });
  check("the command line exits 1 when the server cannot be reached", down.code === 1 && down.err.includes("hproxy-mcp:"));
  const sick = await cli(["doctor"], { HPROXY_MCP_URL: "http://127.0.0.1:9/mcp" });
  check("doctor fails with the reason when the server cannot be reached", sick.code === 1 && sick.out.includes("FAIL") && sick.out.includes("could not be reached"));
}

/* ---------------------------------------------------------------- */
/* Part two: the live server                                         */
/* ---------------------------------------------------------------- */

console.log("against the live server");
const LIVE = { HPROXY_MCP_URL: "", HPROXY_SETUP_URL: "", HPROXY_API_KEY: "" };
{
  const lookup = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ip_lookup", arguments: { ips: ["8.8.8.8"] } } };
  const list = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "proxy_list", arguments: { protocol: "socks5", limit: 2 } } };
  const nope = { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } };
  const r = await stdio([INIT, INITIALIZED, { jsonrpc: "2.0", id: 5, method: "tools/list" }, lookup, list, nope], LIVE);
  const m = byId(r.messages);
  check("the live handshake names HProxy's server", m[1]?.result?.serverInfo?.name === "hproxy", JSON.stringify(m[1]));
  const tools = m[5]?.result?.tools ?? [];
  check("the live server lists its tools", tools.length >= 3 && ["proxy_list", "proxy_check", "ip_lookup"].every((n) => tools.some((t) => t.name === n)));
  check("every free tool says it only reads", tools.filter((t) => ["proxy_list", "proxy_check", "ip_lookup"].includes(t.name)).every((t) => t.annotations?.readOnlyHint === true));
  const ip = JSON.parse(m[2]?.result?.content?.[0]?.text ?? "{}");
  check("a live lookup answers for the address asked", ip.ip === "8.8.8.8" || ip.results?.[0]?.ip === "8.8.8.8", JSON.stringify(ip).slice(0, 200));
  const listed = m[3]?.result;
  const rows = listed?.isError ? null : JSON.parse(listed?.content?.[0]?.text ?? "{}");
  check("a live list answers, or says why it cannot", (rows && Array.isArray(rows.proxies) && rows.proxies.length <= 2) || (listed?.isError && listed.content?.[0]?.text?.length > 10));
  check("an unknown tool is the server's own protocol error", m[4]?.error?.code === -32602);
}
{
  const ip = await cli(["ip", "8.8.8.8"], LIVE);
  let parsed = null;
  try {
    parsed = JSON.parse(ip.out);
  } catch {}
  check("hproxy-mcp ip exits 0 and prints JSON", ip.code === 0 && parsed !== null, `exit ${ip.code} ${ip.err}`);
  const list = await cli(["list", "--protocol", "socks5", "--limit", "2"], LIVE);
  check("hproxy-mcp list exits 0", list.code === 0, list.err);
  const wrong = await cli(["list", "--limit", "lots"], LIVE);
  check("a wrong argument exits 1 with the server's own sentence", wrong.code === 1 && /whole number/.test(wrong.err), wrong.err);
  const tools = await cli(["tools"], LIVE);
  check("hproxy-mcp tools prints the tool list", tools.code === 0 && JSON.parse(tools.out).some((t) => t.name === "proxy_check"));
  const setupLive = await cli(["setup"], LIVE);
  check("hproxy-mcp setup prints the site's live lines", setupLive.code === 0 && setupLive.out.includes("claude mcp add --transport http hproxy https://mcp.hproxy.com/mcp") && !setupLive.out.includes("could not be reached"), setupLive.err);
  const doctorLive = await cli(["doctor"], LIVE);
  check("hproxy-mcp doctor passes from this machine", doctorLive.code === 0 && doctorLive.out.includes("Everything works"), doctorLive.out);
  const help = await cli(["--help"]);
  check("--help prints the usage", help.code === 0 && help.out.includes("hproxy-mcp list"));
  const version = await cli(["--version"]);
  check("--version prints the version", version.out.trim() === VERSION);
  const bad = await cli(["nonsense"]);
  check("an unknown command exits 2", bad.code === 2);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
