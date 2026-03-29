import { createHighlighter, type BundledLanguage, type Highlighter, type ThemedToken } from "shiki";

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

const TOKEN_CACHE_MAX = 10_000;
const tokenCache = new Map<string, ThemedToken[]>();

const SUPPORTED_LANGS = [
  "typescript", "tsx", "javascript", "jsx",
  "rust", "json", "css", "html",
  "markdown", "yaml", "toml", "bash",
  "python", "go", "sql", "ruby", "erb",
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
    rb: "ruby",
    rake: "ruby",
    gemspec: "ruby",
    erb: "erb",
  };
  return map[ext ?? ""];
}

// Concurrency-limited tokenization queue to prevent UI jank during scrolling.
// Without this, scrolling through a large diff fires dozens of concurrent
// tokenizations that saturate the main thread.
const MAX_CONCURRENT = 6;
let activeCount = 0;
const pendingQueue: Array<() => void> = [];

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    function run() {
      activeCount++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeCount--;
          const next = pendingQueue.shift();
          if (next) next();
        });
    }

    if (activeCount < MAX_CONCURRENT) {
      run();
    } else {
      pendingQueue.push(run);
    }
  });
}

/**
 * Tokenize a single line of code for syntax highlighting.
 * Returns an array of themed tokens with color info.
 * Falls back to plain text if language is unsupported.
 * Concurrency-limited to MAX_CONCURRENT to avoid UI jank.
 */
export async function tokenizeLine(
  code: string,
  lang?: string,
): Promise<ThemedToken[]> {
  if (!lang) {
    return [{ content: code, offset: 0, color: undefined }];
  }

  const cacheKey = `${lang}:${code}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;

  return enqueue(async () => {
    // Re-check cache — another queued call may have populated it
    const rechecked = tokenCache.get(cacheKey);
    if (rechecked) return rechecked;

    const highlighter = await getHighlighter();
    const tokens = highlighter.codeToTokensBase(code, {
      lang: lang as BundledLanguage,
      theme: "github-dark-default",
    });

    const result = tokens[0] ?? [{ content: code, offset: 0, color: undefined }];

    if (tokenCache.size >= TOKEN_CACHE_MAX) {
      tokenCache.clear();
    }
    tokenCache.set(cacheKey, result);

    return result;
  });
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
