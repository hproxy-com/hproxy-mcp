#!/usr/bin/env node
/* ============================================================
   hproxy-mcp: HProxy's MCP server for apps that start their servers
   on your own computer, and a small command line.

   HProxy runs its MCP server at https://mcp.hproxy.com/mcp: a live
   free proxy list, a real proxy checker and an IP lookup, with no key
   and no account. An app that can reach a remote MCP server takes that
   address and needs nothing else. Some apps only start a program on
   your computer and talk to it over stdin and stdout; for them, this
   package is that program. It hands every message to the hosted server
   and passes the answer back unchanged, so the tools, their words and
   their limits are always the hosted server's own, and a change there
   reaches every copy of this package without a new release.

     MCP   npx -y hproxy-mcp              JSON-RPC 2.0 over stdio
                                          (stdout carries the protocol,
                                          every log line goes to stderr)
     CLI   npx hproxy-mcp list --country de --protocol socks5 --limit 5
           npx hproxy-mcp check 203.0.113.7:1080
           npx hproxy-mcp ip 8.8.8.8

   Zero dependencies on purpose: Node 18 and newer has fetch, and an
   assistant that must install a tree of packages first will not wait.

   This file is written into github.com/hproxy-com/hproxy-mcp by HProxy's
   MCP engine, like every file there. Changes made on GitHub by hand are
   replaced on its next round.
   ============================================================ */

const VERSION = "1.0.0";
const SERVER = process.env.HPROXY_MCP_URL || "https://mcp.hproxy.com/mcp";
const REPO = "https://github.com/hproxy-com/hproxy-mcp";
/* Every app's setup line, as hproxy.com prints it on its pages: one source for the site, the
   repository's front page and `hproxy-mcp setup`, so a line changed there is changed here too. */
const SETUP_URL = process.env.HPROXY_SETUP_URL || "https://hproxy.com/mcp-setup.json";
const UA = `hproxy-mcp/${VERSION} (+https://hproxy.com/tools/ai)`;
/* The server answers within 30 seconds (its own ceiling); a checker call on many dead
   proxies comes close to that, so the wait here is longer and only catches a lost line. */
const WAIT_MS = 45_000;
/* Sent only when it is set. The free tools need no key; the hosted server reads a key
   from the Authorization header for account tools, and ignores it while those are off. */
const KEY = process.env.HPROXY_API_KEY || "";

/* What the handshake settled, sent on every later request as the protocol asks. The
   hosted server keeps no session today; if it ever starts one, its id goes back with
   each request. */
let protocolVersion = null;
let sessionId = null;

/* ---------------------------------------------------------------- */
/* One message to the hosted server, its answers back                */
/* ---------------------------------------------------------------- */

/** POSTs one JSON-RPC message (or a batch) and returns every message that came back. */
async function post(message) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": UA,
  };
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (KEY) headers.authorization = `Bearer ${KEY}`;

  const res = await fetch(SERVER, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(WAIT_MS),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (res.status === 202) return []; // only notifications went out; nothing comes back

  const text = await res.text();
  const type = res.headers.get("content-type") || "";
  const messages = type.includes("text/event-stream") ? fromEventStream(text) : fromJson(text);
  if (!messages.length) {
    throw new Error(`the server answered HTTP ${res.status} without a JSON-RPC message`);
  }
  return messages;
}

/** A JSON body: one message, or a batch of them. */
function fromJson(text) {
  try {
    const body = JSON.parse(text);
    return (Array.isArray(body) ? body : [body]).filter(isMessage);
  } catch {
    return [];
  }
}

/** A Server-Sent Events body: each event's data lines joined, each event one message. */
function fromEventStream(text) {
  const out = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) out.push(...fromJson(data));
  }
  return out;
}

const isMessage = (m) => m !== null && typeof m === "object" && m.jsonrpc === "2.0";
const isRequest = (m) => isMessage(m) && typeof m.method === "string" && m.id !== undefined && m.id !== null;

/** The reason a call failed, in words a person and a model can act on. */
function reason(e) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `no answer within ${WAIT_MS / 1000} seconds`;
  const cause = e?.cause?.code || e?.cause?.message;
  return cause ? `${e.message} (${cause})` : String(e?.message ?? e);
}

/* ---------------------------------------------------------------- */
/* MCP over stdio                                                    */
/* ---------------------------------------------------------------- */

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

/** The answer for a request the hosted server could not take. A tool call gets a tool
 *  result with isError, so the model reads why and can try again later; anything else
 *  gets a JSON-RPC error, so the app shows that the server is unavailable. */
function unavailable(request, e) {
  const why = `HProxy's MCP server could not be reached: ${reason(e)}.`;
  if (request.method === "tools/call") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: `${why} Retry in a few seconds.` }], isError: true },
    };
  }
  return { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: why } };
}

let inFlight = 0;
let stdinClosed = false;

async function relay(message) {
  inFlight++;
  try {
    const answers = await post(message);
    for (const answer of answers) {
      // The handshake's answer names the protocol version every later request carries.
      if (!protocolVersion && typeof answer?.result?.protocolVersion === "string") {
        protocolVersion = answer.result.protocolVersion;
      }
      write(answer);
    }
  } catch (e) {
    // Every request still gets its answer, so the app never waits on one that will not come.
    const requests = (Array.isArray(message) ? message : [message]).filter(isRequest);
    for (const request of requests) write(unavailable(request, e));
    process.stderr.write(`hproxy-mcp: ${reason(e)}\n`);
  } finally {
    inFlight--;
    leaveWhenDone();
  }
}

/** Once the app closed stdin and every answer is out, leave; stdout is flushed first. */
function leaveWhenDone() {
  if (stdinClosed && inFlight === 0) process.stdout.write("", () => process.exit(0));
}

function serve() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: a line on stdin was not JSON" } });
        continue;
      }
      relay(message);
    }
  });
  process.stdin.on("end", () => {
    stdinClosed = true;
    leaveWhenDone();
  });
  process.stderr.write(`hproxy-mcp ${VERSION}: MCP over stdio, answered by ${SERVER}\n`);
}

/* ---------------------------------------------------------------- */
/* The same tools as a command line                                  */
/* ---------------------------------------------------------------- */

const USAGE = `hproxy-mcp ${VERSION}: HProxy's free proxy tools, no key needed

Set it up
  hproxy-mcp setup [app] [--json]      the exact steps for your AI app (Claude Code,
                                       Claude Desktop, ChatGPT, Cursor, VS Code,
                                       Windsurf, Gemini CLI, Codex), or for all of them
  hproxy-mcp doctor                    check that everything works from this computer

Run it
  hproxy-mcp                           run as an MCP server over stdio

Use the tools from a terminal (every command prints JSON)
  hproxy-mcp list [--country de] [--protocol http|https|socks4|socks5]
                  [--anonymity elite|anonymous|transparent] [--limit 25]
                                       live free proxies
  hproxy-mcp check <ip:port> [...]     a real live test of each proxy
  hproxy-mcp ip <address> [...]        where an address is and who runs it
  hproxy-mcp tools                     the tools the server offers today

Nothing to install for apps that take a remote MCP server: ${SERVER}
Every app's setup, on one page: ${REPO}
Support, around the clock: https://hproxy.com/contact
`;

/* ---------------------------------------------------------------- */
/* setup: the exact steps for each app                               */
/* ---------------------------------------------------------------- */

/* The same server started on this computer, for apps that only run local programs. These lines
   belong to this package, so they live here; the hosted lines come from SETUP_URL. */
const LOCAL = {
  claudeCode: "claude mcp add hproxy -- npx -y hproxy-mcp",
  json: '{ "mcpServers": { "hproxy": { "command": "npx", "args": ["-y", "hproxy-mcp"] } } }',
  vscode: '{ "servers": { "hproxy": { "type": "stdio", "command": "npx", "args": ["-y", "hproxy-mcp"] } } }',
  codex: '[mcp_servers.hproxy]\ncommand = "npx"\nargs = ["-y", "hproxy-mcp"]',
};

/* What setup prints when hproxy.com cannot be reached: the hosted address and the one line
   that works in Claude Code. Every other app's line is on the repository's front page. */
const FALLBACK = {
  url: SERVER,
  clients: [{ name: "Claude Code", where: "In a terminal:", how: `claude mcp add --transport http hproxy ${SERVER}` }],
};

async function fetchSetup() {
  try {
    const res = await fetch(SETUP_URL, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const setup = await res.json();
    if (!Array.isArray(setup?.clients) || !setup.clients.length) throw new Error("no clients in the answer");
    return { setup, live: true };
  } catch (e) {
    return { setup: FALLBACK, live: false, why: reason(e) };
  }
}

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** The local line for one app (in the same settings file as its hosted line where it has one),
 *  or null for an app that only takes a remote server. */
function localLine(client) {
  const n = squash(client.name);
  if (n.includes("claudecode")) return LOCAL.claudeCode;
  if (n.includes("chatgpt")) return null;
  if (n.includes("vscode")) return `In .vscode/mcp.json:\n${LOCAL.vscode}`;
  if (n.includes("desktop")) return `In Claude Desktop's settings file (Settings, Developer, Edit Config):\n${LOCAL.json}`;
  const file = /^In \S+:$/.test(String(client.where ?? "")) ? client.where : "In the app's MCP settings file:";
  return `${file}\n${LOCAL.json}`;
}

async function setup(app, asJson) {
  const { setup: s, live, why } = await fetchSetup();
  const wanted = app ? squash(app) : "";
  const codex = !wanted || "codex".includes(wanted) || wanted.includes("codex");
  const clients = (s.clients ?? []).filter((c) => !wanted || squash(c.name).includes(wanted));

  if (asJson) {
    return JSON.stringify(
      {
        hosted: { url: s.url ?? SERVER, transport: "streamable-http", authentication: "none" },
        local: { command: "npx", args: ["-y", "hproxy-mcp"], transport: "stdio" },
        apps: clients.map((c) => ({ name: c.name, where: c.where, line: c.how, local: localLine(c) })),
        ...(codex ? { codex: { file: "~/.codex/config.toml", local: LOCAL.codex } } : {}),
        plugins: wanted ? undefined : s.plugins,
        source: live ? SETUP_URL : `built in (${SETUP_URL} could not be reached: ${why})`,
        repository: REPO,
      },
      null,
      2,
    );
  }

  if (wanted && !clients.length && !codex) {
    const names = [...(s.clients ?? []).map((c) => c.name), "Codex"].join(", ");
    throw new Error(`no app called "${app}". The apps: ${names}. Without a name, setup prints all of them.`);
  }

  const out = [];
  out.push("Add HProxy's free proxy tools to your AI app. No key, no account.");
  out.push("");
  out.push("Apps that take a remote MCP server need nothing installed. The address:");
  out.push(`  ${s.url ?? SERVER}`);
  for (const c of clients) {
    out.push("");
    out.push(c.name);
    out.push(`  ${c.where}`);
    for (const line of String(c.how).split("\n")) out.push(`  ${line}`);
    const local = localLine(c);
    if (local) {
      out.push("  Or start it on this computer instead (Node 18 or newer):");
      for (const line of local.split("\n")) out.push(`  ${line}`);
    }
  }
  if (codex) {
    out.push("");
    out.push("Codex");
    out.push("  In ~/.codex/config.toml:");
    for (const line of LOCAL.codex.split("\n")) out.push(`  ${line}`);
  }
  if (!wanted && Array.isArray(s.plugins)) {
    for (const p of s.plugins) {
      out.push("");
      out.push(p.name);
      out.push(`  ${p.where}`);
      for (const line of p.lines ?? []) out.push(`  ${line}`);
    }
  }
  if (!wanted) {
    out.push("");
    out.push("Any other app");
    out.push(`  A remote MCP server at ${s.url ?? SERVER} (Streamable HTTP, no authentication),`);
    out.push('  or a local one: command "npx", arguments "-y" and "hproxy-mcp".');
  }
  out.push("");
  if (!live) out.push(`(${SETUP_URL} could not be reached: ${why}. Every app's line: ${REPO})`);
  out.push("Check it from this computer: npx hproxy-mcp doctor");
  out.push('Then ask your assistant: "Find 5 free SOCKS5 proxies in Germany and check which ones work."');
  return out.join("\n");
}

/* ---------------------------------------------------------------- */
/* doctor: does it work from this computer?                          */
/* ---------------------------------------------------------------- */

async function doctor() {
  const out = [];
  let ok = true;
  const step = (good, what) => {
    out.push(`${good ? "  ok    " : "  FAIL  "}${what}`);
    if (!good) ok = false;
  };
  const timed = async (fn) => {
    const t0 = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  };

  out.push(`hproxy-mcp ${VERSION} doctor`);
  const major = Number(process.versions.node.split(".")[0]);
  step(major >= 18, `Node ${process.versions.node}${major >= 18 ? "" : ": this package needs Node 18 or newer"}`);

  try {
    const hello = await timed(() =>
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hproxy-mcp-doctor", version: VERSION } } }),
    );
    const result = hello.value[0]?.result;
    step(!!result?.serverInfo, `${SERVER} answers the handshake (protocol ${result?.protocolVersion ?? "?"}, ${hello.ms} ms)`);
    if (result?.protocolVersion) protocolVersion = result.protocolVersion;

    const listed = await timed(() => post({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const tools = (listed.value[0]?.result?.tools ?? []).map((t) => t.name);
    step(tools.length > 0, `it offers ${tools.length} tools: ${tools.join(", ")} (${listed.ms} ms)`);

    const call = await timed(() => post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ip_lookup", arguments: { ips: ["8.8.8.8"] } } }));
    const answer = call.value[0]?.result;
    step(answer && !answer.isError, `a real tool call works: ip_lookup 8.8.8.8 (${call.ms} ms)${answer?.isError ? `: ${answer.content?.[0]?.text}` : ""}`);
  } catch (e) {
    step(false, `${SERVER} could not be reached: ${reason(e)}`);
  }

  const proxied = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxied && !process.env.NODE_USE_ENV_PROXY) {
    out.push("  note  a proxy is set in HTTPS_PROXY or HTTP_PROXY, and Node connects directly unless NODE_USE_ENV_PROXY=1 (Node 24 and newer)");
  }
  out.push("");
  out.push(ok ? "Everything works. Add it to your app: npx hproxy-mcp setup" : "Something above failed. Help, around the clock: https://hproxy.com/contact");
  return { text: out.join("\n"), ok };
}

/* Switches that take no value: `setup --json cursor` keeps "cursor" as the app's name. */
const SWITCHES = new Set(["json"]);

/** `--name value` pairs, `--switch`es and the words around them. */
function parse(args) {
  const flags = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split("=", 2);
      flags[name] = SWITCHES.has(name) ? true : (inline ?? args[++i]);
    } else {
      words.push(a);
    }
  }
  return { flags, words };
}

async function callTool(name, args) {
  const [answer] = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  if (answer?.error) throw new Error(answer.error.message);
  const text = answer?.result?.content?.find((c) => c.type === "text")?.text ?? "";
  if (answer?.result?.isError) throw new Error(text);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function cli(argv) {
  const [cmd, ...rest] = argv;
  const { flags, words } = parse(rest);
  if (cmd === "list") {
    const args = {};
    for (const key of ["country", "protocol", "anonymity"]) if (flags[key] !== undefined) args[key] = flags[key];
    // A whole number goes as one; anything else goes as written, and the server says what it wants.
    if (flags.limit !== undefined) args.limit = /^\d+$/.test(flags.limit) ? Number(flags.limit) : flags.limit;
    return callTool("proxy_list", args);
  }
  if (cmd === "check") return callTool("proxy_check", { proxies: words });
  if (cmd === "ip") return callTool("ip_lookup", { ips: words });
  if (cmd === "tools") {
    const [answer] = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    if (answer?.error) throw new Error(answer.error.message);
    const tools = (answer?.result?.tools ?? []).map((t) => ({ name: t.name, title: t.title, description: t.description }));
    return JSON.stringify(tools, null, 2);
  }
  if (cmd === "setup") return setup(words[0], flags.json === true);
  if (cmd === "doctor") {
    const { text, ok } = await doctor();
    if (!ok) process.exitCode = 1;
    return text;
  }
  return null;
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "mcp") {
  serve();
} else if (["--help", "-h", "help"].includes(argv[0])) {
  process.stdout.write(USAGE);
} else if (["--version", "-v"].includes(argv[0])) {
  process.stdout.write(VERSION + "\n");
} else {
  cli(argv)
    .then((out) => {
      if (out === null) {
        process.stderr.write(USAGE);
        process.exitCode = 2;
        return;
      }
      process.stdout.write(out + "\n");
    })
    .catch((e) => {
      process.stderr.write(`hproxy-mcp: ${reason(e)}\n`);
      process.exitCode = 1;
    });
}
