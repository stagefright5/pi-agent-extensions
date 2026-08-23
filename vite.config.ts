import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
  },
  staged: {
    "*.{js,jsx,ts,tsx,mjs,cjs}": [
      "vp lint --fix --no-error-on-unmatched-pattern",
      "vp fmt --no-error-on-unmatched-pattern",
    ],
    "*.{json,jsonc,md,mdx,yml,yaml,css,scss,html}": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    printWidth: 120,
    sortPackageJson: false,
    overrides: [
      {
        files: ["extensions/**/*.ts"],
        options: {
          useTabs: true,
          tabWidth: 4,
        },
      },
      {
        files: ["extensions/jenkins-cli-operations/**/*.mjs"],
        options: {
          useTabs: false,
          tabWidth: 4,
          singleQuote: true,
        },
      },
    ],
  },
});
