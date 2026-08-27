// Deliberately minimal: only the React hooks rules. rules-of-hooks exists to
// catch hook calls below early returns (the AgentItem React #310 crash in
// v0.21.0-beta.3) — tsc and vitest can't see that class of bug statically.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
