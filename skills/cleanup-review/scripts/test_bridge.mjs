import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = process.env.CLEANUP_TEST_APP;
if (!app) throw Error("Run through scripts/test.sh");
const require = createRequire(path.join(app, "bridge/package.json"));
const WebSocket = require("ws");
const { approvalStore } = await import(pathToFileURL(path.join(app, "bridge/approvals.mjs")));
const { default: piBridge } = await import(pathToFileURL(path.join(skill, "assets/pi-bridge.ts")));

function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-review-test-")));
  const root = path.join(home, "session");
  fs.mkdirSync(path.join(home, "repo/node_modules"), { recursive: true });
  execFileSync("python3", [path.join(skill, "scripts/cleanup.py"), "init", root, "--home", home]);
  const item = {
    id: "project",
    title: "A test project",
    kind: "repo",
    paths: ["~/repo"],
    bytes: 2000,
    why: "Fixture for reviewing dependencies separately.",
    check: "Keep its source.",
    dependencies: { paths: ["~/repo/node_modules"], bytes: 1000 },
  };
  const input = path.join(home, "curated.json");
  fs.writeFileSync(input, JSON.stringify({ items: [item] }));
  execFileSync("python3", [path.join(skill, "scripts/cleanup.py"), "render", root, "--input", input]);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, root, item };
}

function inbox(ws) {
  const queue = [],
    waiters = [];
  ws.on("message", (raw) => {
    const value = JSON.parse(raw);
    const index = waiters.findIndex((w) => w.type === value.type);
    if (index < 0) queue.push(value);
    else {
      const waiter = waiters.splice(index, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    }
  });
  return (type) => {
    const index = queue.findIndex((m) => m.type === type);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        type,
        resolve,
        timer: setTimeout(() => reject(Error("Timed out waiting for " + type)), 5000),
      };
      waiters.push(waiter);
    });
  };
}

async function server(t, root, host = "pi", extra = {}) {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, [path.join(app, "bridge/server.mjs")], {
    env: {
      ...process.env,
      CLEANUP_ROOT: root,
      CLEANUP_PORT: String(port),
      CLEANUP_HOST: host,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => (stderr += data));
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => {
      throw Error(stderr);
    }),
  ]);
  const config = JSON.parse(fs.readFileSync(path.join(root, "bridge/state/connection.json")));
  return {
    config,
    base: `http://127.0.0.1:${port}`,
    url: `ws://127.0.0.1:${port}/ws?token=${config.token}`,
  };
}

test("real Pi adapter exchanges messages, saves notes, approves exact dependency paths, and streams verified progress", async (t) => {
  const { root, home, item } = fixture(t);
  const { config, base, url } = await server(t, root);
  assert.throws(
    () =>
      execFileSync(process.execPath, [path.join(app, "bridge/server.mjs")], {
        env: {
          ...process.env,
          CLEANUP_ROOT: root,
          CLEANUP_PORT: "43199",
          CLEANUP_HOST: "pi",
        },
        stdio: "pipe",
      }),
    /already owns this session/,
  );
  assert.equal((await fetch(base + "/" + config.token + "/review-state.json")).status, 404);
  assert.equal((await fetch(base + "/" + config.token + "/index.html")).status, 200);
  const denied = async (address, origin) =>
    new Promise((resolve) => {
      const socket = new WebSocket(address, origin ? { origin } : {});
      socket.on("unexpected-response", (req, res) => {
        resolve(res.statusCode);
        req.destroy();
      });
      socket.on("error", () => {});
      socket.on("open", () => {
        socket.close();
        resolve(101);
      });
    });
  assert.equal(await denied(url.replace(config.token, "wrong")), 403);
  assert.equal(await denied(url, "https://unrelated.example"), 403);
  assert.equal(await denied(url.replace("/ws?", "/agent?")), 403);
  const page = new WebSocket(url);
  const next = inbox(page);
  t.after(() => page.terminate());
  await once(page, "open");
  assert.equal((await next("hello")).ready, false);
  page.send(
    JSON.stringify({
      type: "send",
      requestId: "offline-message",
      text: "Hello",
    }),
  );
  assert.equal((await next("ack")).accepted, false);

  const commands = new Map(),
    events = new Map(),
    delivered = [];
  const ctx = {
    isIdle: () => false,
    sessionManager: { getSessionId: () => "fixture-pi-conversation" },
    ui: { notify() {} },
  };
  piBridge({
    registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => events.set(name, handler),
    sendUserMessage: (text, options) => delivered.push({ text, options }),
  });
  t.after(() => events.get("session_shutdown")());
  await commands.get("cleanup-connect").handler(root, ctx);
  assert.equal((await next("status")).ready, true);
  page.send(JSON.stringify({ type: "choice", id: item.id, value: "dependenciesOnly" }));
  await next("choice");
  page.send(
    JSON.stringify({
      type: "note",
      id: item.id,
      text: "Keep the repo. Free text: café <b>literal</b>",
    }),
  );
  await next("note");
  page.send(
    JSON.stringify({
      type: "send",
      requestId: "two-way-message",
      text: "Can I retain the source?",
      itemId: item.id,
    }),
  );
  assert.equal((await next("ack")).accepted, true);
  assert.match(delivered[0].text, /Can I retain the source/);
  assert.equal(delivered[0].options.deliverAs, "followUp");
  page.send(
    JSON.stringify({
      type: "send",
      requestId: "two-way-message",
      text: "Can I retain the source?",
    }),
  );
  await next("ack");
  assert.equal(delivered.length, 1);
  events.get("message_update")(
    {
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "never forward" },
          { type: "text", text: "Keep the source." },
        ],
      },
    },
    ctx,
  );
  let reply;
  do {
    reply = await next("message");
  } while (reply.message.role !== "assistant");
  assert.equal(reply.message.text, "Keep the source.");
  assert.equal(reply.message.streaming, true);
  events.get("message_end")(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Keep the source and Git history." }],
      },
    },
    ctx,
  );
  assert.equal((await next("message")).message.streaming, false);
  page.send(
    JSON.stringify({
      type: "approve",
      requestId: "fixture-approval",
      entries: [
        {
          id: item.id,
          choice: "dependenciesOnly",
          paths: item.dependencies.paths,
          note: "Keep the repo. Free text: café <b>literal</b>",
        },
      ],
    }),
  );
  assert.equal((await next("ack")).accepted, true);
  // Wait for the server to persist the receipt after sending the acknowledgement.
  let progress;
  do {
    progress = await next("progress");
  } while (!progress.approvals.some((a) => a.id === "fixture-approval"));
  const approval = JSON.parse(fs.readFileSync(path.join(root, "approvals/fixture-approval.json")));
  assert.deepEqual(approval.entries[0].paths, ["~/repo/node_modules"]);
  assert.match(approval.entries[0].note, /Keep the repo/);
  assert.equal(approval.status, "approved");
  assert.equal(delivered.length, 2);
  assert.match(delivered[1].text, /explicit authorization/);
  fs.writeFileSync(
    path.join(root, "trash-move-fixture.json"),
    JSON.stringify({
      approvalId: "fixture-approval",
      complete: true,
      batch: "fixture-trash",
      restoreFile: "fixture-restore",
      entries: [{ source: path.join(home, "repo/node_modules"), status: "verified" }],
    }),
  );
  do {
    progress = await next("progress");
  } while (progress.approvals[0].status !== "complete");
  assert.equal(progress.approvals[0].done, 1);
  assert.equal(progress.approvals[0].restore, "fixture-restore");
  // A stale page bootstrap must not recreate a choice another page removed.
  page.send(JSON.stringify({ type: "choice", id: item.id, value: "" }));
  await next("choice");
  page.send(JSON.stringify({ type: "bootstrap", choices: { [item.id]: "shortlist" } }));
  assert.equal((await next("review")).review.choices[item.id], undefined);
  events.get("session_shutdown")();
  assert.equal((await next("status")).ready, false);
});

test("approval store refuses changed previews and overlapping scopes", (t) => {
  const { root, home, item } = fixture(t);
  const store = approvalStore(root, home),
    items = new Map([[item.id, item]]);
  const review = { choices: { project: "dependenciesOnly" }, notes: {} };
  assert.throws(
    () =>
      store.create("wrong-preview", [{ id: item.id, choice: "dependenciesOnly", paths: item.paths }], review, items),
    /Paths changed/,
  );
  assert.throws(
    () =>
      store.create(
        "changed-note",
        [
          {
            id: item.id,
            choice: "dependenciesOnly",
            paths: item.dependencies.paths,
            note: "A stale note",
          },
        ],
        review,
        items,
      ),
    /Notes changed/,
  );
  store.create(
    "correct-preview",
    [
      {
        id: item.id,
        choice: "dependenciesOnly",
        paths: item.dependencies.paths,
      },
    ],
    review,
    items,
  );
  review.choices.project = "shortlist";
  assert.throws(
    () => store.create("overlap-preview", [{ id: item.id, choice: "shortlist", paths: item.paths }], review, items),
    /active approval/,
  );
});

test("rendered website keeps dependency-only scope after reload and escapes item content", async (t) => {
  const { root, item } = fixture(t);
  const storage = new Map();
  const run = () => {
    const nodes = new Map();
    let blob;
    const node = (id) => {
      if (!nodes.has(id))
        nodes.set(id, {
          innerHTML: "",
          textContent: "",
          dataset: {},
          appendChild() {},
          click() {},
          remove() {},
        });
      return nodes.get(id);
    };
    const document = {
      getElementById: node,
      dispatchEvent() {},
      body: node("body"),
      createElement: () => node("download"),
      querySelectorAll() {
        return [];
      },
    };
    const context = vm.createContext({
      document,
      window: { scrollTo() {} },
      localStorage: {
        getItem: (k) => storage.get(k),
        setItem: (k, v) => storage.set(k, v),
      },
      Event: class {},
      CustomEvent: class {},
      Blob,
      URL: {
        createObjectURL: (b) => {
          blob = b;
          return "blob:test";
        },
        revokeObjectURL() {},
      },
      setTimeout() {},
    });
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    return {
      nodes,
      context,
      blob: () => blob,
      eval: (text) => vm.runInContext(text, context),
    };
  };
  const h = run();
  h.eval("choose('dependenciesOnly');mode='summary';render();exportChoices()");
  assert.match(h.nodes.get("view").innerHTML, /Keep the repo/);
  const exported = await h.blob().text();
  assert.ok(exported.includes("  ~/repo/node_modules"));
  assert.ok(!exported.split("\n").includes("  ~/repo"));
  assert.equal(run().context.window.CleanupReview.choices()[item.id], "dependenciesOnly");
  assert.equal(h.eval("escape('<script>')"), "&lt;script&gt;");
});

test("Codex bridge uses the selected thread and filters replies from other threads", async (t) => {
  const { root } = fixture(t);
  const http = await import("node:http");
  const upstream = http.createServer();
  const wss = new WebSocket.WebSocketServer({ server: upstream });
  // Unix socket paths have a small platform limit; keep this fixture path short.
  const socketPath = path.join("/tmp", "cleanup-" + process.pid + "-" + Date.now() + ".sock");
  let connection;
  const requests = [];
  wss.on("connection", (client) => {
    connection = client;
    client.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.id === undefined) return;
      requests.push(message);
      client.send(
        JSON.stringify({
          id: message.id,
          result:
            message.method === "thread/turns/list"
              ? { data: [] }
              : message.method === "turn/start"
                ? { turn: { id: "fixture-turn" } }
                : {},
        }),
      );
    });
  });
  upstream.listen(socketPath);
  await once(upstream, "listening");
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    upstream.close();
    try {
      fs.unlinkSync(socketPath);
    } catch {}
  });
  const { url } = await server(t, root, "codex", {
    CODEX_THREAD_ID: "fixture-thread",
    CODEX_SOCKET: socketPath,
  });
  const page = new WebSocket(url);
  const next = inbox(page);
  t.after(() => page.terminate());
  await once(page, "open");
  const hello = await next("hello");
  if (!hello.ready) assert.equal((await next("status")).ready, true);
  page.send(
    JSON.stringify({
      type: "send",
      requestId: "codex-send-message",
      text: "Fixture message",
    }),
  );
  assert.equal((await next("ack")).accepted, true);
  assert.equal(requests.find((r) => r.method === "thread/resume").params.threadId, "fixture-thread");
  assert.equal(requests.find((r) => r.method === "turn/start").params.threadId, "fixture-thread");
  connection.send(
    JSON.stringify({
      method: "item/agentMessage/delta",
      params: {
        threadId: "other-thread",
        itemId: "hidden",
        delta: "do not forward",
      },
    }),
  );
  connection.send(
    JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        item: { id: "visible", type: "agentMessage", text: "Fixture reply" },
      },
    }),
  );
  let reply;
  do {
    reply = await next("message");
  } while (reply.message.role !== "assistant");
  assert.equal(reply.message.text, "Fixture reply");
});

test("swipe animation commits once and respects reduced motion", async () => {
  let reduced = false,
    finish,
    animations = 0,
    commits = 0;
  const handlers = new Map(),
    choices = [];
  const stamp = { textContent: "", dataset: {}, style: {} };
  const card = {
    dataset: {},
    style: {},
    clientWidth: 600,
    classList: {
      remove() {},
      add() {},
      contains() {
        return false;
      },
    },
    querySelector: () => stamp,
    querySelectorAll: () => [],
    addEventListener: (name, handler) => handlers.set(name, handler),
    animate() {
      animations++;
      return {
        finished: new Promise((resolve) => {
          finish = resolve;
        }),
      };
    },
  };
  const context = vm.createContext({
    window: { CleanupReview: { choose: (value) => choices.push(value) } },
    document: { querySelector: () => card, addEventListener() {} },
    matchMedia: () => ({ matches: reduced }),
    innerWidth: 900,
    queueMicrotask,
  });
  vm.runInContext(fs.readFileSync(path.join(app, "swipe.js"), "utf8"), context);
  const swipe = context.window.CleanupSwipe;
  const pending = swipe.choose("keep", () => commits++);
  await swipe.choose("shortlist", () => commits++);
  assert.equal(commits, 0);
  assert.equal(swipe.busy, true);
  finish();
  await pending;
  assert.equal(commits, 1);
  assert.equal(swipe.busy, false);
  reduced = true;
  const before = animations;
  await swipe.choose("dependenciesOnly", () => commits++);
  assert.equal(commits, 2);
  assert.equal(animations, before);
  handlers.get("keydown")({
    target: card,
    key: "ArrowLeft",
    preventDefault() {},
  });
  assert.deepEqual(choices, ["keep"]);
});
