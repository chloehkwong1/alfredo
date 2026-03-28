import { createHighlighter, type BundledLanguage, type Highlighter, type ThemedToken } from "shiki";

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

const SUPPORTED_LANGS = [
  "typescript", "tsx", "javascript", "jsx",
  "rust", "json", "css", "html",
  "markdown", "yaml", "toml", "bash",
  "python", "go", "sql",
] as const;

/**
 * Get or create the singleton Shiki highlighter.
 * Lazy-loads on first call; subsequent calls return the cached instance.
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = createHighlighter({
    themes: ["github-dark-default"],
    langs: [...SUPPORTED_LANGS],
  });

  highlighterInstance = await highlighterPromise;
  highlighterPromise = null;
  return highlighterInstance;
}

/**
 * Map a file path to a Shiki language identifier.
 * Returns undefined for unsupported extensions (rendered as plain text).
 */
export function getLangFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    rs: "rust",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    py: "python",
    go: "go",
    sql: "sql",
  };
  return map[ext ?? ""];
}

/**
 * Tokenize a single line of code for syntax highlighting.
 * Returns an array of themed tokens with color info.
 * Falls back to plain text if language is unsupported.
 */
export async function tokenizeLine(
  code: string,
  lang?: string,
): Promise<ThemedToken[]> {
  if (!lang) {
    return [{ content: code, offset: 0, color: undefined }];
  }

  const highlighter = await getHighlighter();
  const tokens = highlighter.codeToTokensBase(code, {
    lang: lang as BundledLanguage,
    theme: "github-dark-default",
  });

  // codeToTokensBase returns Token[][] (lines), we only pass one line
  return tokens[0] ?? [{ content: code, offset: 0, color: undefined }];
}
