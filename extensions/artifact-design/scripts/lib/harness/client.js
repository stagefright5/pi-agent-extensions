const THEMES = ["system", "light", "dark"];
const KEY = "__artifact_harness_theme";
const GROUND = { light: "#faf9f5", dark: "#141413" };

function readTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function effective(theme) {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function applyTheme(theme) {
  const root = document.documentElement;
  // "system" stamps NOTHING. That is the state most viewers are in, and the
  // state a [data-theme]-only stylesheet renders wrong.
  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "";
  } else {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private window: the default is fine */
  }
}

// Paints the opposite theme's ground behind the document, so a transparent body shows.
function applyGround(theme, enabled) {
  const opposite = effective(theme) === "dark" ? "light" : "dark";
  document.documentElement.style.background = enabled ? GROUND[opposite] : "";
}

function bodyIsTransparent() {
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg === "transparent" || bg === "rgba(0, 0, 0, 0)";
}

function mount() {
  let theme = readTheme();
  let ground = false;

  const bar = document.createElement("div");
  bar.id = "__artifact_harness";
  bar.setAttribute("data-harness", "");
  bar.innerHTML = `
    <div class="ah-group" role="radiogroup" aria-label="Theme">
      ${THEMES.map(
        (t) => `<button type="button" data-theme-btn="${t}" role="radio" aria-checked="false">${t}</button>`,
      ).join("")}
    </div>
    <button type="button" data-ground aria-pressed="false" title="Paint the opposite theme's ground behind the document">ground</button>
    <span class="ah-warn" data-warn hidden>body is transparent</span>
  `;
  document.body.appendChild(bar);

  const sync = () => {
    applyTheme(theme);
    applyGround(theme, ground);
    bar.querySelectorAll("[data-theme-btn]").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.themeBtn === theme));
    });
    bar.querySelector("[data-ground]").setAttribute("aria-pressed", String(ground));
    requestAnimationFrame(() => {
      bar.querySelector("[data-warn]").hidden = !bodyIsTransparent();
    });
  };

  bar.addEventListener("click", (e) => {
    const t = e.target.closest("[data-theme-btn]");
    if (t) {
      theme = t.dataset.themeBtn;
      sync();
      return;
    }
    if (e.target.closest("[data-ground]")) {
      ground = !ground;
      sync();
    }
  });

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (theme === "system") sync();
  });

  sync();
}

// window.claude is aliased so pages written against the published runtime still run.
function installAgentStub() {
  const log = (name, args) => console.info(`[artifact-harness] ${name}()`, ...args, "— stubbed in dev");

  const agent = {
    async complete(prompt) {
      log("complete", [prompt]);
      return "[stub completion — the published runtime answers this]";
    },
    async getUser() {
      log("getUser", []);
      return { id: "dev-user", name: "Dev Viewer", email: null };
    },
    async readState(key) {
      log("readState", [key]);
      try {
        const v = localStorage.getItem(`__artifact_state:${key}`);
        return v === null ? null : JSON.parse(v);
      } catch {
        return null;
      }
    },
    async writeState(key, value) {
      log("writeState", [key, value]);
      try {
        localStorage.setItem(`__artifact_state:${key}`, JSON.stringify(value));
      } catch {
        /* blocked site data */
      }
      return true;
    },
    async listAssets() {
      log("listAssets", []);
      return [];
    },
    async publish() {
      log("publish", []);
      throw new Error("publish() is not available in the local dev harness");
    },
  };

  Object.defineProperty(window, "artifactAgent", { value: Object.freeze(agent), writable: false });
  if (!("claude" in window)) {
    Object.defineProperty(window, "claude", { value: window.artifactAgent, writable: false });
  }
}

installAgentStub();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
