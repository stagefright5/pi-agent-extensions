import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devPolicy } from "./csp.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function artifactHarness(options = {}) {
  const { csp = true, harness = true } = options;

  return {
    name: "artifact-design:harness",
    // serve-only: the harness and relaxed CSP can never reach a build
    apply: "serve",

    configureServer(server) {
      if (!csp) return;
      const policy = devPolicy();
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", policy);
        next();
      });
    },

    transformIndexHtml() {
      if (!harness) return [];
      return [
        {
          tag: "style",
          injectTo: "body",
          children: readFileSync(join(here, "client.css"), "utf8"),
        },
        {
          tag: "script",
          injectTo: "body",
          children: readFileSync(join(here, "client.js"), "utf8"),
        },
      ];
    },
  };
}
