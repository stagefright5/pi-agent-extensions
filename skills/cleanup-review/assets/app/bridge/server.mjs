import http from "node:http";
import os from "node:os";
import { approvalStore } from "./approvals.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

const ROOT = process.env.CLEANUP_ROOT
  ? path.resolve(process.env.CLEANUP_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, "bridge", "state");
fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
const lockFile = path.join(STATE, "server.lock");
if (fs.existsSync(lockFile)) {
  const owner = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error("Inspect the invalid server lock before restarting");
  try {
    process.kill(owner.pid, 0);
    throw Error("A review server already owns this session");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    fs.unlinkSync(lockFile);
  }
}
const lockFd = fs.openSync(lockFile, "wx", 0o600);
fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid }));
fs.closeSync(lockFd);
process.on("exit", () => {
  try {
    if (JSON.parse(fs.readFileSync(lockFile, "utf8")).pid === process.pid) fs.unlinkSync(lockFile);
  } catch {}
});
const PORT = Number(process.env.CLEANUP_PORT || 43127),
  HOST = "127.0.0.1";
const CONNECTION = path.join(STATE, "connection.json");
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const session = readJSON(path.join(ROOT, "session.json"), null);
if (!session?.home || !session?.id) throw Error("Initialize a cleanup session first");
let config = readJSON(CONNECTION, null);
if (!config) {
  config = {
    host: process.env.CLEANUP_HOST || "pi",
    threadId: process.env.CODEX_THREAD_ID,
    token: crypto.randomBytes(32).toString("hex"),
    agentToken: crypto.randomBytes(32).toString("hex"),
    socket: process.env.CODEX_SOCKET || path.join(os.homedir(), ".codex/app-server-control/app-server-control.sock"),
  };
  writeJSON(CONNECTION, config);
}
config.port = PORT;
writeJSON(CONNECTION, config);
if (!["codex", "pi"].includes(config.host)) throw Error("Unsupported host");
if (config.host === "codex" && !config.threadId) throw Error("Set CODEX_THREAD_ID for the current conversation");
const data = readJSON(path.join(ROOT, "review-data.json"), {});
const items = new Map(
  [...data.repos, ...data.dependencies, ...data.docs, ...data.appdata, ...data.shortlist].map((r) => [r.id, r]),
);
const approvals = approvalStore(ROOT, session.home);
const REVIEW_FILE = path.join(ROOT, "review-state.json");
const review = readJSON(REVIEW_FILE, {
  choices: {},
  notes: {},
  updatedAt: null,
});
if (!fs.existsSync(REVIEW_FILE)) writeJSON(REVIEW_FILE, review);
let transcript = readJSON(path.join(STATE, "messages.json"), []);
const receipts = new Map(readJSON(path.join(STATE, "receipts.json"), []));
const clients = new Set();
let upstream,
  ready = false,
  nextId = 1,
  retryTimer,
  shutdown = false,
  status = "Waiting for the agent connection",
  sendChain = Promise.resolve();
const pending = new Map();
let flushTimer;
const wsURL = `ws://${HOST}:${PORT}/ws?token=${config.token}`;
fs.writeFileSync(
  path.join(ROOT, "bridge-connection.js"),
  `window.CLEANUP_BRIDGE=${JSON.stringify({ url: wsURL, http: `http://${HOST}:${PORT}/${config.token}/index.html` })};\n`,
  { mode: 0o600 },
);
function safeEqual(a, b) {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function broadcast(value) {
  const s = JSON.stringify(value);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(s);
}
function updateStatus(s) {
  status = s;
  broadcast({ type: "status", ready, status });
}
function saveTranscript() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => writeJSON(path.join(STATE, "messages.json"), transcript.slice(-160)), 300);
}
function putMessage(message) {
  const i = transcript.findIndex((m) => m.id === message.id);
  if (i < 0) transcript.push(message);
  else transcript[i] = { ...transcript[i], ...message };
  transcript = transcript.slice(-160);
  broadcast({
    type: "message",
    message: transcript.find((m) => m.id === message.id),
  });
  saveTranscript();
}
function rpc(method, params, timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (upstream?.readyState !== WebSocket.OPEN) return reject(Error("The assistant is disconnected"));
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("Codex response timed out; delivery may be uncertain"));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    upstream.send(JSON.stringify({ id, method, params }));
  });
}
function appendDelta(p) {
  const id = "agent:" + p.itemId;
  let m = transcript.find((x) => x.id === id);
  if (!m) {
    m = {
      id,
      role: "assistant",
      text: "",
      at: new Date().toISOString(),
      turnId: p.turnId,
      streaming: true,
    };
    transcript.push(m);
  }
  m.text = (m.text + p.delta).slice(-100000);
  m.streaming = true;
  broadcast({ type: "message", message: m });
  saveTranscript();
}
function handleNotification(m) {
  const p = m.params || {};
  if (p.threadId !== config.threadId) return;
  if (m.method === "item/agentMessage/delta") appendDelta(p);
  if (m.method === "item/completed" && p.item?.type === "agentMessage")
    putMessage({
      id: "agent:" + p.item.id,
      role: "assistant",
      text: p.item.text,
      at: new Date().toISOString(),
      turnId: p.turnId,
      streaming: false,
      phase: p.item.phase,
    });
  if (m.method === "turn/started") updateStatus("Connected · working");
  if (m.method === "turn/completed") {
    for (const message of transcript)
      if (message.turnId === p.turn?.id && message.streaming) {
        message.streaming = false;
        broadcast({ type: "message", message });
      }
    updateStatus(p.turn?.status === "failed" ? "Connected · last response failed" : "Connected to this conversation");
  }
  if (m.method === "error")
    broadcast({
      type: "notice",
      text: p.error?.message || "Codex reported an error",
    });
  if (m.method === "thread/status/changed")
    updateStatus(p.status?.type === "active" ? "Connected · working" : "Connected to this conversation");
}
async function connect() {
  clearTimeout(retryTimer);
  upstream = new WebSocket(`ws+unix://${config.socket}:/`, {
    maxPayload: 16 * 1024 * 1024,
  });
  upstream.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(Object.assign(Error(m.error.message), { code: m.error.code })) : p.resolve(m.result);
      return;
    }
    // Never approve tools or permissions through this lightweight client.
    if (m.id !== undefined && m.method) {
      upstream.send(
        JSON.stringify({
          id: m.id,
          error: {
            code: -32601,
            message: "Use the main Codex app for tool approvals and interactive requests",
          },
        }),
      );
      return;
    }
    handleNotification(m);
  });
  upstream.on("open", async () => {
    try {
      await rpc("initialize", {
        clientInfo: {
          name: "cleanup_review_bridge",
          title: "Cleanup review",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      });
      upstream.send(JSON.stringify({ method: "initialized", params: {} }));
      await rpc("thread/resume", {
        threadId: config.threadId,
        excludeTurns: true,
      });
      ready = true;
      updateStatus("Connected to this conversation");
    } catch (e) {
      ready = false;
      updateStatus("Connection failed: " + e.message);
      upstream.close();
    }
  });
  upstream.on("error", () => {});
  upstream.on("close", () => {
    ready = false;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Codex connection closed; check delivery before resending"));
    }
    pending.clear();
    updateStatus("Codex disconnected · reconnecting");
    if (!shutdown) retryTimer = setTimeout(connect, 2500);
  });
}
function buildPrompt(text, itemId) {
  const item = items.get(itemId);
  return (
    "Message sent by the user through the local cleanup review page.\n" +
    (item ? "Current item: " + item.title + "\nPaths: " + item.paths.join("\n") + "\n" : "") +
    "\nUser message:\n" +
    text +
    "\n\nThe page review choices are notes, not deletion authorization. Current choices and per-item notes are saved at " +
    REVIEW_FILE +
    ". Reply in this same conversation; your assistant messages are streamed back to the page."
  );
}
async function deliver(message, client) {
  const requestId = message.requestId;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || "")) throw Error("Invalid message ID");
  if (receipts.has(requestId)) {
    client.send(JSON.stringify({ type: "ack", requestId, ...receipts.get(requestId) }));
    return receipts.get(requestId);
  }
  if (!ready) throw Error("The assistant is disconnected. Your draft has not been sent.");
  if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 16000)
    throw Error("Enter a message between 1 and 16,000 characters");
  const itemId = typeof message.itemId === "string" && items.has(message.itemId) ? message.itemId : null;
  const text = message.text.trim();
  putMessage({
    id: "user:" + requestId,
    role: "user",
    text,
    at: new Date().toISOString(),
    itemId,
    status: "sending",
  });
  let receipt;
  receipts.set(requestId, {
    accepted: false,
    uncertain: true,
    error: "Delivery was interrupted. Check this conversation before retrying.",
  });
  writeJSON(path.join(STATE, "receipts.json"), Array.from(receipts).slice(-500));
  try {
    let result;
    if (config.host === "pi") result = await agentSend(requestId, buildPrompt(text, itemId));
    else {
      const recent = await rpc("thread/turns/list", {
        threadId: config.threadId,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      });
      const active = recent.data.find((t) => t.status === "inProgress");
      const input = [{ type: "text", text: buildPrompt(text, itemId) }];
      if (active) {
        try {
          result = await rpc("turn/steer", {
            threadId: config.threadId,
            expectedTurnId: active.id,
            input,
          });
        } catch (e) {
          // Retry as a new turn only when the server explicitly rejected steering because the turn ended.
          if (/no active turn|turn.*not active|turn.*mismatch|expected.*turn/i.test(e.message)) {
            const check = await rpc("thread/turns/list", {
              threadId: config.threadId,
              limit: 1,
              sortDirection: "desc",
              itemsView: "notLoaded",
            });
            if (check.data.some((t) => t.status === "inProgress")) throw e;
            result = await rpc("turn/start", {
              threadId: config.threadId,
              input,
            });
          } else throw e;
        }
      } else result = await rpc("turn/start", { threadId: config.threadId, input });
    }
    receipt = { accepted: true, turnId: result.turnId || result.turn?.id };
    putMessage({ id: "user:" + requestId, status: "delivered" });
  } catch (e) {
    receipt = {
      accepted: false,
      uncertain: /timed out|connection closed/i.test(e.message),
      error: e.message,
    };
    putMessage({ id: "user:" + requestId, status: "failed", error: e.message });
  }
  receipts.set(requestId, receipt);
  writeJSON(path.join(STATE, "receipts.json"), Array.from(receipts).slice(-500));
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "ack", requestId, ...receipt }));
  return receipt;
}
async function approve(message, client) {
  if (!ready) throw Error("The assistant is disconnected. No approval was submitted.");
  const approval = approvals.create(message.requestId, message.entries, review, items);
  if (approval.status !== "sending") {
    client.send(
      JSON.stringify({
        type: "ack",
        requestId: message.requestId,
        accepted: approval.status === "approved",
        error: approval.error,
      }),
    );
    return;
  }
  const text =
    "I reviewed the exact paths in the cleanup page and clicked Approve move to Trash. Please execute this approved selection now. This is explicit authorization to move only the paths in " +
    path.join(ROOT, "approvals", approval.id + ".json") +
    " to ~/.Trash. Keep source and Git history for dependency-only choices, do not empty Trash, and verify every move. Use " +
    path.join(ROOT, "execute-approved-cleanup.py") +
    " --approval " +
    approval.id +
    " if its supported scope matches; otherwise inspect and handle safely. The execution journal must include approvalId " +
    approval.id +
    " so the page can show verified progress. Respect saved notes in the approval. Report any blocked paths in the journal rather than marking them complete.";
  const receipt = await deliver({ requestId: message.requestId, text }, client);
  approval.status = receipt?.accepted ? "approved" : receipt?.uncertain ? "unconfirmed" : "failed";
  approval.error = receipt?.error;
  approvals.save(approval);
  broadcast({ type: "progress", approvals: approvals.progress() });
}
let progressSignature = "";
const progressTimer = setInterval(() => {
  try {
    const progress = approvals.progress(),
      signature = JSON.stringify(progress);
    if (signature !== progressSignature) {
      progressSignature = signature;
      broadcast({ type: "progress", approvals: progress });
    }
  } catch {}
}, 1000);
function saveReview() {
  review.updatedAt = new Date().toISOString();
  writeJSON(REVIEW_FILE, review);
}
function updateChoice(id, value) {
  if (!items.has(id)) throw Error("Unknown review item");
  if (!["keep", "investigate", "shortlist", "dependenciesOnly", ""].includes(value)) throw Error("Unknown choice");
  if (value === "dependenciesOnly" && !items.get(id).dependencies?.paths?.length)
    throw Error("This item has no separate dependency directories");
  if (value) review.choices[id] = value;
  else delete review.choices[id];
  saveReview();
  broadcast({ type: "choice", id, value });
}
function updateNote(id, text) {
  if (!items.has(id) || typeof text !== "string" || text.length > 16000) throw Error("Invalid note");
  if (text) review.notes[id] = text;
  else delete review.notes[id];
  saveReview();
  broadcast({ type: "note", id, text });
}
const server = http.createServer((req, res) => {
  const host = req.headers.host;
  const validHost = [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(host);
  if (!validHost) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === "/health" && !req.headers.origin) {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ running: true, connected: ready }));
    return;
  }
  const origin = req.headers.origin;
  if (origin && ![`http://${HOST}:${PORT}`, `http://localhost:${PORT}`].includes(origin)) {
    res.writeHead(403).end();
    return;
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    res.writeHead(403).end();
    return;
  }
  const prefix = `/${config.token}/`;
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404).end();
    return;
  }
  const filename = url.pathname.slice(prefix.length) || "index.html";
  if (
    ![
      "index.html",
      "bridge-connection.js",
      "bridge-client.js",
      "bridge.css",
      "swipe.css",
      "swipe.js",
      "approval-client.js",
      "detailed-review.html",
      "raw-inventory.html",
      "summary.txt",
    ].includes(filename)
  ) {
    res.writeHead(404).end();
    return;
  }
  try {
    const content = fs.readFileSync(path.join(ROOT, filename));
    res.writeHead(200, {
      "Content-Type": filename.endsWith(".js")
        ? "application/javascript; charset=utf-8"
        : filename.endsWith(".css")
          ? "text/css; charset=utf-8"
          : filename.endsWith(".html")
            ? "text/html; charset=utf-8"
            : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
let agent;
const agentPending = new Map();
function agentSend(requestId, text) {
  return new Promise((resolve, reject) => {
    if (agent?.readyState !== WebSocket.OPEN) return reject(Error("The agent is disconnected"));
    const timer = setTimeout(() => {
      agentPending.delete(requestId);
      reject(Error("Agent response timed out; delivery may be uncertain"));
    }, 20000);
    agentPending.set(requestId, { resolve, reject, timer });
    agent.send(JSON.stringify({ type: "user", requestId, text }));
  });
}
const agentWss = new WebSocketServer({
  noServer: true,
  maxPayload: 256 * 1024,
});
agentWss.on("connection", (client) => {
  if (agent) {
    client.close(1008, "An agent is already connected");
    return;
  }
  agent = client;
  ready = false;
  let bound = false;
  client.on("error", () => {});
  client.on("message", (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === "bind" && typeof m.sessionId === "string" && m.sessionId) {
        if (config.piSessionId && config.piSessionId !== m.sessionId) {
          client.close(1008, "This review belongs to another Pi session");
          return;
        }
        config.piSessionId = m.sessionId;
        writeJSON(CONNECTION, config);
        bound = true;
        ready = true;
        updateStatus("Connected to this Pi conversation");
        return;
      }
      if (!bound) return;
      if (m.type === "ack" && agentPending.has(m.requestId)) {
        const p = agentPending.get(m.requestId);
        agentPending.delete(m.requestId);
        clearTimeout(p.timer);
        m.accepted ? p.resolve({}) : p.reject(Error(m.error || "Agent rejected message"));
      }
      if (m.type === "assistant" && typeof m.text === "string" && typeof m.id === "string")
        putMessage({
          id: "agent:" + m.id,
          role: "assistant",
          text: m.text.slice(-100000),
          streaming: !!m.streaming,
          at: new Date().toISOString(),
        });
    } catch {
      client.close(1008, "Invalid agent message");
    }
  });
  client.on("close", () => {
    if (agent !== client) return;
    agent = null;
    ready = false;
    for (const p of agentPending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Agent connection closed; check delivery before resending"));
    }
    agentPending.clear();
    updateStatus("Agent disconnected. Reconnect from the same Pi conversation.");
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
server.on("upgrade", (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    socket.destroy();
    return;
  }
  const origin = req.headers.origin;
  if (
    config.host === "pi" &&
    url.pathname === "/agent" &&
    !origin &&
    [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.host) &&
    safeEqual(url.searchParams.get("token"), config.agentToken)
  ) {
    agentWss.handleUpgrade(req, socket, head, (c) => agentWss.emit("connection", c));
    return;
  }
  const allowedOrigin =
    !origin || origin === "null" || origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
  if (
    ![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.host) ||
    !allowedOrigin ||
    url.pathname !== "/ws" ||
    !safeEqual(url.searchParams.get("token"), config.token)
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
});
wss.on("connection", (client) => {
  clients.add(client);
  client.send(
    JSON.stringify({
      type: "hello",
      ready,
      status,
      review,
      approvals: approvals.progress(),
      messages: transcript.slice(-80),
    }),
  );
  client.on("close", () => clients.delete(client));
  client.on("error", () => {});
  client.on("message", (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === "ping") {
        client.send(JSON.stringify({ type: "pong", ready }));
        return;
      }
      if (m.type === "choice") {
        updateChoice(m.id, m.value);
        return;
      }
      if (m.type === "note") {
        updateNote(m.id, m.text);
        return;
      }
      if (m.type === "bootstrap") {
        // The server is authoritative; stale browser snapshots cannot restore deleted choices.
        client.send(JSON.stringify({ type: "review", review }));
        return;
      }
      if (m.type === "approve") {
        sendChain = sendChain
          .then(() => approve(m, client))
          .catch((e) => {
            if (client.readyState === WebSocket.OPEN)
              client.send(
                JSON.stringify({
                  type: "ack",
                  requestId: m.requestId,
                  accepted: false,
                  error: e.message,
                }),
              );
          });
        return;
      }
      if (m.type === "send") {
        sendChain = sendChain
          .then(() => deliver(m, client))
          .catch((e) => {
            if (client.readyState === WebSocket.OPEN)
              client.send(
                JSON.stringify({
                  type: "ack",
                  requestId: m.requestId,
                  accepted: false,
                  error: e.message,
                }),
              );
          });
        return;
      }
      throw Error("Unsupported message");
    } catch (e) {
      client.send(JSON.stringify({ type: "notice", text: e.message }));
    }
  });
});
server.listen(PORT, HOST, () => {
  fs.writeFileSync(path.join(STATE, "server.pid"), String(process.pid));
  console.log(`Cleanup review: http://${HOST}:${PORT}/${config.token}/index.html`);
  if (config.host === "codex") connect();
});
function stop() {
  shutdown = true;
  clearInterval(progressTimer);
  clearTimeout(retryTimer);
  clearTimeout(flushTimer);
  writeJSON(path.join(STATE, "messages.json"), transcript.slice(-160));
  for (const c of clients) c.close();
  upstream?.close();
  agent?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
