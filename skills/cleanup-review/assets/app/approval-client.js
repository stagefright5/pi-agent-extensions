(() => {
  const api = window.CleanupReview,
    $ = (id) => document.getElementById(id);
  let ready = false,
    preview = [],
    busy = false,
    latest = [],
    lastSignature = "",
    shownApproval = null;
  const dialog = $("approval-dialog");
  function selected() {
    const c = api.choices();
    return api
      .batch()
      .items.filter((r) => !api.completed[r.id] && ["shortlist", "dependenciesOnly"].includes(c[r.id]))
      .map((r) => ({
        id: r.id,
        title: r.title,
        choice: c[r.id],
        paths: c[r.id] === "dependenciesOnly" ? r.dependencies.paths : r.paths,
        note: api.notes?.()[r.id] || "",
      }));
  }
  function attach() {
    let button = $("review-approval");
    if (!button) {
      button = document.createElement("button");
      button.id = "review-approval";
      button.className = "primary batch-approve";
      $("view").after(button);
      button.onclick = open;
    }
    const rows = selected(),
      active = latest.some((a) => ["sending", "approved", "unconfirmed", "moving"].includes(a.status));
    button.textContent = active
      ? "Cleanup approved · follow progress below"
      : rows.length
        ? `Review & approve ${rows.length} shortlisted ${rows.length === 1 ? "item" : "items"}`
        : "Shortlist items to review & approve";
    button.disabled = !rows.length || busy || active;
    const item = api.current();
    if (item && (api.pending?.[item.id] || api.completed[item.id]))
      document.querySelectorAll("[data-value]").forEach((b) => (b.disabled = true));
    if (active) $("undo-choice").disabled = true;
  }
  function open() {
    preview = selected();
    if (!preview.length) return;
    const target = $("approval-paths");
    target.replaceChildren();
    for (const row of preview) {
      const title = document.createElement("h3");
      title.textContent = row.title;
      target.append(title);
      if (row.note) {
        const note = document.createElement("p");
        note.textContent = "Your note: " + row.note;
        target.append(note);
      }
      for (const path of row.paths) {
        const code = document.createElement("code");
        code.className = "path";
        code.textContent = path;
        target.append(code);
      }
    }
    $("approval-status").textContent = ready
      ? "Approval asks the assistant to check and move these exact paths. Progress will appear here."
      : "Connect to this conversation before approving.";
    $("confirm-approval").disabled = !ready || busy;
    dialog.showModal();
  }
  $("cancel-approval").onclick = () => dialog.close();
  $("confirm-approval").onclick = () => {
    if (!ready || busy) return;
    busy = true;
    $("confirm-approval").disabled = true;
    $("approval-status").textContent = "Submitting approval…";
    document.dispatchEvent(
      new CustomEvent("cleanup:approve", {
        detail: {
          requestId: crypto.randomUUID(),
          entries: preview.map(({ id, choice, paths, note }) => ({
            id,
            choice,
            paths,
            note,
          })),
        },
      }),
    );
    attach();
  };
  document.addEventListener("cleanup:connection", (e) => {
    ready = e.detail.ready;
    $("confirm-approval").disabled = !ready || busy;
  });
  document.addEventListener("cleanup:approvalAck", (e) => {
    busy = false;
    const m = e.detail;
    if (m.accepted) {
      dialog.close();
      $("choice-feedback").textContent = "Approved. Waiting for checks and moves.";
    } else {
      $("approval-status").textContent = m.error || "Approval delivery is unconfirmed. Check progress before retrying.";
      $("confirm-approval").disabled = !ready;
    }
    attach();
  });
  function celebrate(id) {
    const key = "cleanup-" + window.CLEANUP_SESSION.id + "-celebrated-" + id;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "yes");
    } catch {}
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.classList.add("celebration");
    svg.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
    svg.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 34; i++) {
      const bit = document.createElementNS(ns, i % 3 ? "rect" : "circle");
      if (i % 3) {
        bit.setAttribute("width", "7");
        bit.setAttribute("height", "12");
        bit.setAttribute("rx", "2");
      } else {
        bit.setAttribute("r", "4");
      }
      bit.setAttribute("fill", ["#ef6586", "#b88bdb", "#55bfa0", "#f2bf69"][i % 4]);
      svg.append(bit);
      const x = innerWidth / 2,
        y = innerHeight * 0.42,
        dx = (Math.random() - 0.5) * Math.min(innerWidth, 850),
        dy = -80 - Math.random() * 200;
      bit.animate(
        [
          { transform: `translate(${x}px,${y}px) rotate(0deg)`, opacity: 0 },
          {
            transform: `translate(${x + dx * 0.7}px,${y + dy}px) rotate(140deg)`,
            opacity: 1,
            offset: 0.35,
          },
          {
            transform: `translate(${x + dx}px,${y + 160 + Math.random() * 220}px) rotate(350deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 1400 + Math.random() * 450,
          delay: Math.random() * 100,
          easing: "cubic-bezier(.15,.6,.4,1)",
          fill: "both",
        },
      );
    }
    document.body.append(svg);
    setTimeout(() => svg.remove(), 2200);
  }
  function renderProgress() {
    const a = latest.at(-1);
    if (!a) return;
    const panel = $("cleanup-progress");
    panel.hidden = false;
    if (shownApproval !== a.id && a.status !== "complete") {
      shownApproval = a.id;
      requestAnimationFrame(() =>
        panel.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "center",
        }),
      );
    }
    panel.replaceChildren();
    const h = document.createElement("h2");
    h.textContent =
      a.status === "complete"
        ? a.items?.some((item) => api.batch().items.some((r) => r.id === item.id))
          ? "All moved and verified"
          : "Previous batch: all moved and verified"
        : a.status === "moving"
          ? "Moving to Trash"
          : a.status === "error"
            ? "Cleanup needs attention"
            : a.status === "failed"
              ? "Approval was not delivered"
              : "Approved · waiting for the assistant";
    panel.append(h);
    if (a.status === "complete") {
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 40 40");
      svg.classList.add("complete-mark");
      svg.innerHTML =
        '<circle cx="20" cy="20" r="19" fill="#e3f6ed"/><path d="m11 20 6 6 12-13" fill="none" stroke="#269b7c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
      h.prepend(svg);
      celebrate(a.id);
    }
    const bar = document.createElement("progress");
    bar.max = a.total || 1;
    bar.value = a.done;
    bar.setAttribute("aria-label", "Verified moves");
    panel.append(bar);
    const p = document.createElement("p");
    p.textContent =
      `${a.done} of ${a.total} paths verified.` +
      (a.error ? " " + a.error : "") +
      (a.status === "complete" ? " Trash has not been emptied." : "");
    panel.append(p);
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      list = document.createElement("ul");
    summary.textContent = "Paths and progress";
    details.append(summary, list);
    for (const e of a.entries) {
      const li = document.createElement("li");
      li.textContent = `${e.status} · ${e.source}` + (e.error ? " · " + e.error : "");
      list.append(li);
    }
    panel.append(details);
    if (a.restore) {
      const p = document.createElement("p");
      p.textContent = "Restore instructions: " + a.restore;
      panel.append(p);
    }
    if (a.batch) {
      const p = document.createElement("p");
      p.textContent = "Trash folder: " + a.batch;
      panel.append(p);
    }
  }
  document.addEventListener("cleanup:progress", (e) => {
    latest = e.detail;
    const signature = JSON.stringify(latest);
    if (signature !== lastSignature) {
      lastSignature = signature;
      renderProgress();
    }
    api.pending = {};
    for (const a of latest)
      for (const row of a.items || []) {
        if (a.status === "complete") api.completed[row.id] = true;
        else if (["sending", "approved", "unconfirmed", "moving"].includes(a.status)) api.pending[row.id] = true;
      }
    attach();
  });
  document.addEventListener("cleanup:item", () => queueMicrotask(attach));
  document.addEventListener("cleanup:choices", () => queueMicrotask(attach));
  attach();
})();
