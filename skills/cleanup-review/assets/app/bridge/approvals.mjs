import fs from "node:fs";
import path from "node:path";
export function approvalStore(root, home) {
  const dir = path.join(root, "approvals");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  function save(a) {
    const file = path.join(dir, a.id + ".json");
    fs.writeFileSync(file + ".tmp", JSON.stringify(a, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(file + ".tmp", file);
  }
  function create(id, preview, review, items) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw Error("Invalid approval ID");
    if (fs.existsSync(path.join(dir, id + ".json"))) return read(path.join(dir, id + ".json"));
    if (!Array.isArray(preview) || !preview.length || preview.length > 100)
      throw Error("No shortlisted items to approve");
    const seen = new Set();
    const entries = preview.map((row) => {
      const item = items.get(row.id),
        choice = review.choices[row.id];
      if (!item || !["shortlist", "dependenciesOnly"].includes(choice) || row.choice !== choice || seen.has(row.id))
        throw Error("Choices changed. Reopen the approval preview.");
      seen.add(row.id);
      if ((row.note || "") !== (review.notes[row.id] || "")) throw Error("Notes changed. Reopen the approval preview.");
      const paths = choice === "dependenciesOnly" ? item.dependencies?.paths : item.paths;
      if (!paths?.length || JSON.stringify(paths) !== JSON.stringify(row.paths))
        throw Error("Paths changed. Reopen the approval preview.");
      for (const p of paths) {
        const full = path.resolve(p.startsWith("~/") ? path.join(home, p.slice(2)) : p);
        if (!full.startsWith(home + path.sep) || !fs.existsSync(full))
          throw Error("A selected path no longer exists. Refresh the review.");
      }
      return {
        id: row.id,
        title: item.title,
        choice,
        paths,
        note: review.notes[row.id] || "",
        kind: item.kind,
        ...(item.verification ? { verification: item.verification } : {}),
      };
    });
    const active = new Set(
      progress()
        .filter((p) => ["sending", "approved", "unconfirmed", "moving"].includes(p.status))
        .flatMap((p) => p.entries.map((e) => e.source)),
    );
    for (const row of entries)
      for (const p of row.paths) {
        const full = path.resolve(p.startsWith("~/") ? path.join(home, p.slice(2)) : p);
        if ([...active].some((p) => full === p || full.startsWith(p + path.sep) || p.startsWith(full + path.sep)))
          throw Error("These paths already have an active approval. Follow their progress below.");
      }
    const selected = entries.flatMap((e) =>
      e.paths.map((p) => path.resolve(p.startsWith("~/") ? path.join(home, p.slice(2)) : p)),
    );
    for (let i = 0; i < selected.length; i++)
      for (let j = 0; j < i; j++)
        if (
          selected[i] === selected[j] ||
          selected[i].startsWith(selected[j] + path.sep) ||
          selected[j].startsWith(selected[i] + path.sep)
        )
          throw Error("Overlapping paths must be reviewed separately");
    const a = {
      id,
      createdAt: new Date().toISOString(),
      reviewUpdatedAt: review.updatedAt,
      status: "sending",
      entries,
      authorization:
        "User clicked Approve move to Trash after reviewing the exact paths. Move only these paths to ~/.Trash; never empty Trash.",
    };
    save(a);
    return a;
  }
  function list() {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => read(path.join(dir, n)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  function progress() {
    const journals = fs
      .readdirSync(root)
      .filter((n) => n.startsWith("trash-move-") && n.endsWith(".json"))
      .map((n) => {
        try {
          return read(path.join(root, n));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return list().map((a) => {
      const manifest = journals.find((j) => j.approvalId === a.id);
      const expected = a.entries.flatMap((e) =>
        e.paths.map((p) => (p.startsWith("~/") ? path.join(home, p.slice(2)) : p)),
      );
      const entries = expected.map((source) => {
        const e = manifest?.entries?.find((e) => e.source === source);
        return { source, status: e?.status || "pending", error: e?.error };
      });
      const done = entries.filter((e) => e.status === "verified").length;
      const complete = !!manifest?.complete && done === expected.length;
      return {
        id: a.id,
        items: a.entries.map(({ id, choice }) => ({ id, choice })),
        status: complete ? "complete" : entries.some((e) => e.error) ? "error" : manifest ? "moving" : a.status,
        error: manifest?.error || a.error,
        entries,
        done,
        total: expected.length,
        batch: manifest?.batch,
        restore: manifest?.restoreFile,
      };
    });
  }
  return { create, save, progress };
}
