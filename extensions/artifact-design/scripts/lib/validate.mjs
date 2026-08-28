import { readFileSync, statSync } from "node:fs";
import { ALLOW, isAllowed } from "./harness/csp.mjs";

const MAX_BYTES = 16 * 1024 * 1024;

const strip = (html) => ({
  styles: [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n"),
});

/** Which CSP bucket a reference falls into, from the tag and its rel/as. */
function kindFor(tag, attrs) {
  if (tag === "script") return "script";
  if (tag !== "link") return "other";
  const rel = ((attrs.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || "").toLowerCase().trim();
  if (/stylesheet/.test(rel)) return "style";
  // Connection hints fetch nothing; they only need to name an allowlisted origin.
  if (rel === "preconnect" || rel === "dns-prefetch") return "hint";
  if (/preload|modulepreload|prefetch/.test(rel)) {
    const as = ((attrs.match(/\bas\s*=\s*["']([^"']+)["']/i) || [])[1] || "").toLowerCase();
    return as === "font" ? "font" : as === "style" ? "style" : as === "script" ? "script" : "other";
  }
  return "other";
}

function externalRefs(html) {
  const out = [];
  const tagRe = /<(script|link|img|video|audio|source|iframe|object|embed)\b([^>]*)>/gi;
  for (const m of html.matchAll(tagRe)) {
    const [, tag, attrs] = m;
    const url = (attrs.match(/\b(?:src|href|data)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!url) continue;
    out.push({ tag, url, kind: kindFor(tag, attrs) });
  }
  for (const m of strip(html).styles.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    out.push({ tag: "css-url", url: m[1], kind: "font" });
  }
  for (const m of strip(html).styles.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/gi)) {
    out.push({ tag: "css-import", url: m[1], kind: "style" });
  }
  return out;
}

function isInline(url) {
  return url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("#");
}

// Brace-matched: theme blocks nest and may sit entirely on one line.
function cutBlocks(css, headerRe) {
  const blocks = [];
  let rest = "";
  let i = 0;
  while (i < css.length) {
    headerRe.lastIndex = i;
    const m = headerRe.exec(css);
    if (!m) {
      rest += css.slice(i);
      break;
    }
    rest += css.slice(i, m.index);
    let depth = 0;
    let j = css.indexOf("{", m.index);
    if (j === -1) {
      rest += css.slice(m.index);
      break;
    }
    const open = j;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    blocks.push(css.slice(open + 1, j));
    i = j + 1;
  }
  return { blocks, rest };
}

// A token defined only inside a theme block is undefined in the unstamped system state.
function themeAudit(css) {
  const media = cutBlocks(css, /@media[^{]*prefers-color-scheme[^{]*(?=\{)/gi);
  const attr = cutBlocks(media.rest, /:root\s*\[data-theme[^{]*(?=\{)/gi);
  const themed = [...media.blocks, ...attr.blocks].join("\n");
  const defined = (src) => new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const inBare = defined(attr.rest);
  return [...defined(themed)].filter((v) => !inBare.has(v));
}

function bodyHasBackground(css) {
  return /(^|[},])\s*(?:html\s*,\s*)?body[^{]*\{[^}]*\bbackground(-color)?\s*:/i.test(css);
}

export function validate(file) {
  const html = readFileSync(file, "utf8");
  const css = strip(html).styles;
  const errors = [];
  const warnings = [];

  const bytes = statSync(file).size;
  if (bytes > MAX_BYTES) {
    errors.push(`Page is ${(bytes / 1048576).toFixed(1)}MB; the limit is 16MB.`);
  }

  for (const { tag, url, kind } of externalRefs(html)) {
    if (isInline(url)) continue;
    if (!/^https?:\/\//i.test(url)) {
      errors.push(`<${tag}> references "${url}" — not inlined, so it will 404 once published.`);
      continue;
    }
    if (kind === "other" || kind === null) {
      errors.push(
        `<${tag}> loads "${url}". Only scripts, stylesheets and fonts may be external; embed this as a data: URI.`,
      );
      continue;
    }
    if (!isAllowed(kind, url)) {
      errors.push(
        `<${tag}> loads "${url}" — not on the ${kind} allowlist (${ALLOW[kind].join(", ")}). It will be blocked with no visible error.`,
      );
    }
  }

  const orphanTokens = themeAudit(css);
  if (orphanTokens.length) {
    errors.push(
      `These custom properties are defined only inside a theme block, so they are undefined in the default "system" state: ${orphanTokens.join(", ")}. Define them on bare :root and redefine them in the theme blocks.`,
    );
  }

  if (css && !bodyHasBackground(css)) {
    warnings.push(
      "No explicit background on body — a transparent body borrows the host's ground and inverts in one theme.",
    );
  }
  if (!/<title>/i.test(html)) {
    warnings.push("No <title> — the artifact falls back to its filename in the gallery.");
  }

  return { file, bytes, errors, warnings };
}

export function report(result) {
  const kb = (result.bytes / 1024).toFixed(0);
  for (const e of result.errors) console.error(`  error    ${e}`);
  for (const w of result.warnings) console.warn(`  warning  ${w}`);
  if (!result.errors.length && !result.warnings.length) {
    console.log(`  clean — ${kb}KB, single file, CSP-safe`);
  } else {
    console.log(`  ${result.errors.length} error(s), ${result.warnings.length} warning(s) — ${kb}KB`);
  }
  return result.errors.length === 0;
}
