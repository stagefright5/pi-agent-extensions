// Allowlist in one place: validate.mjs enforces it on builds, devPolicy relaxes it for HMR.
export const ALLOW = {
  script: [
    "https://cdnjs.cloudflare.com",
    "https://cdn.jsdelivr.net/npm/",
    "https://cdn.tailwindcss.com",
    "https://code.jquery.com",
  ],
  style: ["https://fonts.googleapis.com"],
  font: ["https://fonts.gstatic.com"],
};

export const BLOCKED_NOTE =
  "images, media, fetch/XHR/WebSocket and stylesheets from any other host are blocked with no visible error";

export function productionPolicy() {
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${ALLOW.script.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${ALLOW.style.join(" ")}`,
    `font-src 'self' data: ${ALLOW.font.join(" ")}`,
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// Relaxed in two places only: ws: for HMR, 'self' for unbundled modules.
export function devPolicy() {
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${ALLOW.script.join(" ")}`,
    `style-src 'self' 'unsafe-inline' ${ALLOW.style.join(" ")}`,
    `font-src 'self' data: ${ALLOW.font.join(" ")}`,
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
}

export function isAllowed(kind, url) {
  // A connection hint only has to name an origin some bucket already permits.
  const list = kind === "hint" ? Object.values(ALLOW).flat() : ALLOW[kind];
  if (!list) return false;
  return list.some((prefix) => url === prefix || url.startsWith(prefix));
}
