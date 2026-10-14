(() => {
  "use strict";
  const api = window.CleanupReview,
    config = window.CLEANUP_BRIDGE;
  const $ = (id) => document.getElementById(id);
  const box = $("message-text"),
    status = $("connection-status"),
    hint = $("message-status");
  const PREFIX = "cleanup-" + window.CLEANUP_SESSION.id,
    STORE = PREFIX + "-notes",
    DRAFTS = PREFIX + "-drafts",
    PENDING = PREFIX + "-pending";
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };
  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  let notes = read(STORE, {}),
    drafts = read(DRAFTS, {}),
    pending = read(PENDING, { choices: {}, notes: {} });
  api.notes = () => ({ ...notes });
  let socket,
    ready = false,
    connected = false,
    contextId = null,
    lastChoices = api.choices(),
    retry;
  let messages = new Map(),
    renderTimer,
    inflight = new Map();
  function say(text, error = false) {
    hint.textContent = text;
    hint.dataset.error = String(error);
  }
  function send(payload) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }
  function setStatus(text, isReady = false) {
    ready = isReady;
    document.dispatchEvent(new CustomEvent("cleanup:connection", { detail: { ready } }));
    status.textContent = text;
    status.dataset.ready = String(ready);
    $("send-message").disabled = !ready || !!inflight.size;
  }
  function currentKey() {
    return contextId || "general";
  }
  function rememberDraft() {
    drafts[currentKey()] = box.value;
    save(DRAFTS, drafts);
  }
  function updateContext() {
    const item = api.current(),
      id = item?.id || null;
    if (id !== contextId) {
      rememberDraft();
      contextId = id;
      box.value = drafts[currentKey()] ?? notes[id] ?? "";
      say(notes[id] ? "Saved note available for this item." : "Drafts stay in this browser. Send to chat for a reply.");
    }
    $("composer-context").textContent = item
      ? "About: " + item.title + " · " + item.paths[0]
      : "General cleanup question or instruction";
    $("save-note").disabled = !item;
  }
  box.addEventListener("input", rememberDraft);
  document.addEventListener("cleanup:item", () => queueMicrotask(updateContext));
  document.addEventListener("cleanup:choices", (e) => {
    const values = e.detail;
    for (const id of new Set([...Object.keys(lastChoices), ...Object.keys(values)]))
      if (lastChoices[id] !== values[id]) {
        pending.choices[id] = values[id] || "";
        save(PENDING, pending);
        send({ type: "choice", id, value: values[id] || "" });
      }
    lastChoices = { ...values };
  });
  function applyChoices(values, replace = false) {
    const incoming = {};
    if (replace)
      for (const id of Object.keys(api.choices()))
        if (!(id in (values || {})) && !(id in pending.choices)) incoming[id] = "";
    for (const [id, value] of Object.entries(values || {})) if (!(id in pending.choices)) incoming[id] = value;
    api.applyChoices(incoming);
    lastChoices = api.choices();
  }
  function messageNode(m) {
    const article = document.createElement("article");
    article.className = "chat-message";
    article.dataset.role = m.role;
    const header = document.createElement("header"),
      who = document.createElement("strong"),
      meta = document.createElement("span"),
      body = document.createElement("p");
    who.textContent = m.role === "user" ? "You" : "Assistant";
    meta.textContent =
      m.role === "user"
        ? m.status === "delivered"
          ? "Delivered"
          : m.status === "failed"
            ? "Delivery failed"
            : "Sending…"
        : m.streaming
          ? "Replying…"
          : "";
    body.textContent = m.text || "";
    header.append(who, meta);
    article.append(header, body);
    return article;
  }
  function renderMessages() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const target = $("chat-messages"),
        expanded = target.querySelector("details")?.open;
      const list = [...messages.values()].filter((m) => m.text),
        recent = list.slice(-3);
      target.replaceChildren();
      if (list.length > 3) {
        const details = document.createElement("details"),
          summary = document.createElement("summary"),
          older = document.createElement("div");
        details.className = "chat-history";
        details.open = !!expanded;
        summary.textContent = "Earlier messages (" + (list.length - 3) + ")";
        for (const m of list.slice(0, -3)) older.append(messageNode(m));
        details.append(summary, older);
        target.append(details);
      }
      for (const m of recent) target.append(messageNode(m));
    }, 80);
  }
  function ingest(m) {
    messages.set(m.id, { ...messages.get(m.id), ...m });
    renderMessages();
  }
  function submit(text, itemId, fromBox = false) {
    if (inflight.size) {
      say("Waiting for the previous message to be delivered.");
      return;
    }
    if (!ready) {
      say("Not connected. Your draft is saved in this browser.", true);
      return;
    }
    if (!text.trim()) {
      say("Type a question or instruction first.");
      box.focus();
      return;
    }
    if (text.length > 16000) {
      say("Please keep each message below 16,000 characters.", true);
      return;
    }
    const requestId = crypto.randomUUID();
    inflight.set(requestId, { text, key: currentKey(), fromBox });
    $("send-message").disabled = true;
    say("Sending to this conversation…");
    if (!send({ type: "send", requestId, text, itemId })) {
      inflight.delete(requestId);
      say("Connection lost. Your draft is still here.", true);
      return;
    }
    setTimeout(() => {
      if (inflight.has(requestId)) {
        inflight.delete(requestId);
        setStatus(status.textContent, ready);
        say(
          "Delivery has not been confirmed. Check the messages below before sending again; your draft is saved.",
          true,
        );
      }
    }, 30000);
  }
  $("send-message").onclick = () => submit(box.value, contextId, true);
  box.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit(box.value, contextId, true);
    }
  });
  $("save-note").onclick = () => {
    if (!contextId) return;
    notes[contextId] = box.value;
    pending.notes[contextId] = box.value;
    const saved = save(STORE, notes) && save(PENDING, pending);
    send({ type: "note", id: contextId, text: box.value });
    say(
      saved
        ? connected
          ? "Saving note to local file…"
          : "Saved in this browser. Will sync when connected."
        : "Browser storage is unavailable. Keep a copy of your note.",
      !saved,
    );
  };
  document.addEventListener("cleanup:sendChoices", () => {
    const choices = api.choices(),
      labels = {
        keep: "Keep",
        investigate: "Review later",
        shortlist: "Shortlist",
        dependenciesOnly: "Only node_modules; keep repo",
      };
    const lines = [
      "Please review my saved cleanup choices and notes. This is for discussion; it does not authorize deletion.",
    ];
    for (const [id, value] of Object.entries(choices)) {
      const r = api.items.get(id);
      if (!r || !labels[value]) continue;
      lines.push(
        labels[value] +
          ": " +
          r.title +
          " (" +
          (value === "dependenciesOnly"
            ? r.dependencies.paths.length + " dependency directories under " + r.paths[0]
            : r.paths[0]) +
          ")",
      );
    }
    let text = lines.join("\n");
    if (text.length > 14000)
      text = text.slice(0, 13500) + "\n[Remaining choices are in the saved review-state.json file.]";
    text +=
      "\nPlease read review-state.json for exact dependency-only paths and all saved notes; match IDs against review-data.json.";
    submit(text, null);
    $("conversation").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("cleanup:approve", (e) => {
    const request = e.detail;
    if (!ready || inflight.size) {
      document.dispatchEvent(
        new CustomEvent("cleanup:approvalAck", {
          detail: {
            accepted: false,
            error: "Wait for a connected, idle message channel before approving.",
          },
        }),
      );
      return;
    }
    inflight.set(request.requestId, { approval: true });
    if (!send({ type: "approve", ...request })) {
      inflight.delete(request.requestId);
      document.dispatchEvent(
        new CustomEvent("cleanup:approvalAck", {
          detail: {
            accepted: false,
            error: "Connection lost. No approval was sent.",
          },
        }),
      );
      return;
    }
    setTimeout(() => {
      if (inflight.has(request.requestId)) {
        inflight.delete(request.requestId);
        document.dispatchEvent(
          new CustomEvent("cleanup:approvalAck", {
            detail: {
              accepted: false,
              uncertain: true,
              error: "Delivery is unconfirmed. Check progress and chat before retrying.",
            },
          }),
        );
      }
    }, 30000);
  });
  function connect() {
    clearTimeout(retry);
    if (!config?.url) {
      setStatus("Local bridge not running");
      say("Notes and choices still save in this browser. Start the local bridge for this session to connect.");
      return;
    }
    try {
      socket = new WebSocket(config.url);
    } catch {
      setStatus("Connection failed");
      return;
    }
    socket.onmessage = (event) => {
      let m;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }
      if (m.type === "hello") {
        document.dispatchEvent(new CustomEvent("cleanup:progress", { detail: m.approvals || [] }));
        connected = true;
        setStatus(m.status, m.ready);
        for (const message of m.messages || []) ingest(message);
        send({ type: "bootstrap", choices: api.choices(), notes });
        for (const [id, value] of Object.entries(pending.choices)) send({ type: "choice", id, value });
        for (const [id, text] of Object.entries(pending.notes)) send({ type: "note", id, text });
        applyChoices(m.review?.choices, true);
        for (const id of Object.keys(notes))
          if (!(id in (m.review?.notes || {})) && !(id in pending.notes)) delete notes[id];
        for (const [id, text] of Object.entries(m.review?.notes || {})) if (!(id in pending.notes)) notes[id] = text;
        save(STORE, notes);
        say("Choices and saved notes sync to review-state.json. Send to chat for a reply.");
      }
      if (m.type === "progress")
        document.dispatchEvent(new CustomEvent("cleanup:progress", { detail: m.approvals || [] }));
      if (m.type === "status") setStatus(m.status, m.ready);
      if (m.type === "review") {
        applyChoices(m.review.choices, true);
        for (const [id, text] of Object.entries(m.review.notes)) if (!(id in pending.notes)) notes[id] = text;
        save(STORE, notes);
      }
      if (m.type === "choice") {
        if (pending.choices[m.id] === m.value) {
          delete pending.choices[m.id];
          save(PENDING, pending);
        }
        applyChoices({ [m.id]: m.value });
      }
      if (m.type === "note") {
        if (pending.notes[m.id] === m.text) {
          delete pending.notes[m.id];
          save(PENDING, pending);
          if (contextId === m.id) say("Note saved to review-state.json. Use Send to this chat when you want a reply.");
        }
        if (!(m.id in pending.notes)) {
          notes[m.id] = m.text;
          save(STORE, notes);
        }
      }
      if (m.type === "message") ingest(m.message);
      if (m.type === "notice") say(m.text, true);
      if (m.type === "ack") {
        const submitted = inflight.get(m.requestId);
        if (submitted?.approval) document.dispatchEvent(new CustomEvent("cleanup:approvalAck", { detail: m }));
        inflight.delete(m.requestId);
        setStatus(status.textContent, ready);
        if (m.accepted) {
          if (submitted?.fromBox && drafts[submitted.key] === submitted.text) {
            drafts[submitted.key] = "";
            save(DRAFTS, drafts);
            if (currentKey() === submitted.key && box.value === submitted.text) box.value = "";
          }
          say("Delivered to this conversation. The reply will appear below.");
        } else
          say((m.uncertain ? "Delivery unconfirmed: " : "Not delivered: ") + m.error + " Your draft is saved.", true);
      }
    };
    socket.onclose = () => {
      connected = false;
      setStatus("Disconnected · reconnecting");
      retry = setTimeout(connect, 2500);
    };
    socket.onerror = () => {};
  }
  contextId = api.current()?.id || null;
  box.value = drafts[currentKey()] ?? notes[contextId] ?? "";
  updateContext();
  connect();
})();
