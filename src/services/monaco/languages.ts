// Languages we explicitly bundle into Monaco. Mirrors the eager set in
// services/syntaxHighlighter.ts so behaviour matches the old renderer.
export const BUNDLED_LANGUAGES = [
  "typescript", "javascript", "tsx", "jsx",
  "rust", "json", "css", "html", "markdown",
  "yaml", "toml", "bash", "python", "go",
  "sql", "ruby",
] as const;

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  rs: "rust",
  json: "json", jsonc: "json",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  yml: "yaml", yaml: "yaml",
  toml: "toml",
  sh: "shell", bash: "shell", zsh: "shell",
  py: "python",
  go: "go",
  sql: "sql",
  rb: "ruby", erb: "ruby",
};

export function pathToLanguageId(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MAP[ext] ?? "plaintext";
}
