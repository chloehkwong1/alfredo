// Deliberately minimal: only the React hooks rules. rules-of-hooks exists to
// catch hook calls below early returns (the AgentItem React #310 crash in
// v0.21.0-beta.3) — tsc and vitest can't see that class of bug statically.
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
    },
    linterOptions: {
      // A few files carry eslint-disable comments for rules this config
      // doesn't enable (no-console); don't report them as unused noise.
      reportUnusedDisableDirectives: "off",
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
