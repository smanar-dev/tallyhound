// Lint covers new TypeScript code. The kit's JavaScript (packages/, tools/, test/, reference/) is checked by its tests and the fuzzer.
const js = require("@eslint/js"), ts = require("typescript-eslint"), hooks = require("eslint-plugin-react-hooks");
module.exports = ts.config(
  { ignores: ["node_modules/", "packages/", "tools/", "test/", "reference/", "apps/web/dist/", "eslint.config.js", ".data/"] },
  js.configs.recommended, ...ts.configs.recommended,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
  { files: ["apps/web/src/**/*.{ts,tsx}"], plugins: { "react-hooks": hooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } }
);
