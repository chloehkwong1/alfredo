import { useEffect, useState } from "react";
import { listOutputStyles, type CustomOutputStyle } from "../api";

const BUILTIN_STYLES = ["Default", "Explanatory", "Learning"] as const;

export interface OutputStyleOption {
  value: string;
  label: string;
  source: "builtin" | "user" | "project";
}

const builtinOptions: OutputStyleOption[] = BUILTIN_STYLES.map((name) => ({
  value: name,
  label: name,
  source: "builtin",
}));

/**
 * Returns the list of output style options to show in selectors:
 * built-in styles + any custom markdown styles found in
 * `~/.claude/output-styles/` (user) and `<repoPath>/.claude/output-styles/` (project).
 *
 * Custom styles with a name matching a built-in are skipped (built-ins win).
 */
export function useOutputStyles(repoPath?: string | null): OutputStyleOption[] {
  const [custom, setCustom] = useState<CustomOutputStyle[]>([]);

  useEffect(() => {
    let cancelled = false;
    listOutputStyles(repoPath ?? null)
      .then((styles) => {
        if (!cancelled) setCustom(styles);
      })
      .catch(() => {
        if (!cancelled) setCustom([]);
      });
    return () => { cancelled = true; };
  }, [repoPath]);

  const builtinNames = new Set<string>(BUILTIN_STYLES);
  const customOptions: OutputStyleOption[] = custom
    .filter((s) => !builtinNames.has(s.name))
    .map((s) => ({ value: s.name, label: s.name, source: s.source }));

  return [...builtinOptions, ...customOptions];
}
