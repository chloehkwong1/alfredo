import type { DiffFile } from "../types";

export interface PrFileGroup {
  label: "Implementation" | "Tests";
  files: DiffFile[];
  additions: number;
  deletions: number;
}

// Covers the test conventions Alfredo's watched repos actually use: JS/TS
// *.test.*/*.spec.* files, Ruby *_spec.rb (RSpec), and any path routed
// through a test/tests/spec/specs/__tests__/__mocks__ directory (which also
// covers Rust's tests/ integration-test convention).
const TEST_PATH_PATTERN =
  /(^|\/)(tests?|specs?|__tests__|__mocks__)(\/|$)|\.(test|spec)\.[^/]+$|[_.](test|spec)\.rb$/i;

function sum(files: DiffFile[], key: "additions" | "deletions"): number {
  return files.reduce((total, f) => total + f[key], 0);
}

/** Splits changed files into Implementation vs Tests, Linear-guide style.
 *  Groups with no files are omitted; input order is preserved within each. */
export function groupPrFilesByCategory(files: DiffFile[]): PrFileGroup[] {
  const implementation: DiffFile[] = [];
  const tests: DiffFile[] = [];
  for (const file of files) {
    (TEST_PATH_PATTERN.test(file.path) ? tests : implementation).push(file);
  }

  const groups: PrFileGroup[] = [];
  if (implementation.length > 0) {
    groups.push({ label: "Implementation", files: implementation, additions: sum(implementation, "additions"), deletions: sum(implementation, "deletions") });
  }
  if (tests.length > 0) {
    groups.push({ label: "Tests", files: tests, additions: sum(tests, "additions"), deletions: sum(tests, "deletions") });
  }
  return groups;
}
