/**
 * Validate a git branch name against the same rules as `git check-ref-format --branch`.
 * Returns a human-readable error message, or `null` if the name is valid.
 *
 * Empty input returns `"Branch name is required"` so callers can render the
 * message only once the user has typed something — see callers for the
 * "show error iff non-empty" convention.
 */
function validateBranchName(name: string): string | null {
  if (name.length === 0) return "Branch name is required";

  if (name === "@") return "Branch name cannot be '@'";
  if (name.startsWith("-")) return "Branch name cannot start with '-'";
  if (name.startsWith("/")) return "Branch name cannot start with '/'";
  if (name.endsWith("/")) return "Branch name cannot end with '/'";
  if (name.endsWith(".")) return "Branch name cannot end with '.'";
  if (name.endsWith(".lock")) return "Branch name cannot end with '.lock'";
  if (name.includes("..")) return "Branch name cannot contain '..'";
  if (name.includes("//")) return "Branch name cannot contain consecutive slashes";
  if (name.includes("@{")) return "Branch name cannot contain '@{'";

  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    if (ch < 0x20 || ch === 0x7f) {
      return "Branch name cannot contain control characters";
    }
    const c = name[i];
    if (c === " ") return "Branch name cannot contain spaces";
    if (c === "~") return "Branch name cannot contain '~'";
    if (c === "^") return "Branch name cannot contain '^'";
    if (c === ":") return "Branch name cannot contain ':'";
    if (c === "?") return "Branch name cannot contain '?'";
    if (c === "*") return "Branch name cannot contain '*'";
    if (c === "[") return "Branch name cannot contain '['";
    if (c === "\\") return "Branch name cannot contain '\\'";
  }

  for (const segment of name.split("/")) {
    if (segment.startsWith(".")) {
      return "Branch name segments cannot start with '.'";
    }
    if (segment.endsWith(".lock")) {
      return "Branch name segments cannot end with '.lock'";
    }
  }

  return null;
}

export { validateBranchName };
