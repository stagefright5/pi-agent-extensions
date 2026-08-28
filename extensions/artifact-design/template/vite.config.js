// oxlint-disable vite-plus/prefer-vite-plus-imports -- scaffolded projects are
// standalone and depend on plain vite, not the workspace's Vite+ alias.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { artifactHarness } from "__HARNESS_PATH__";

export default defineConfig({
  plugins: [
    // serve-only: theme tri-state, host-ground, CSP headers, agent stub
    artifactHarness(),
    // build-only: inline every chunk and stylesheet into one HTML file
    viteSingleFile(),
  ],
  build: {
    // Images and fonts must inline too, or the single file references files
    // that do not ship. viteSingleFile raises this, set here to be explicit.
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    // Artifacts run in evergreen browsers only; no legacy transpile tax.
    target: "es2022",
    emptyOutDir: true,
  },
});
