#!/usr/bin/env node
// Promote a beta release to stable by flipping its prerelease flag and
// setting it as the "latest" release on GitHub. Stable users pick up the
// change on their next auto-update check.
//
// Usage: npm run promote-beta -- v0.8.0-beta.1

import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: npm run promote-beta -- <tag>");
  console.error("Example: npm run promote-beta -- v0.8.0-beta.1");
  process.exit(1);
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

try {
  run("gh auth status");
} catch {
  console.error("gh CLI is not authenticated. Run 'gh auth login' first.");
  process.exit(1);
}

let release;
try {
  release = JSON.parse(
    run(`gh release view ${tag} --json tagName,isPrerelease,name`),
  );
} catch {
  console.error(`Release ${tag} not found.`);
  process.exit(1);
}

console.log(`Release: ${release.name ?? release.tagName}`);
console.log(`  tag:        ${release.tagName}`);
console.log(`  prerelease: ${release.isPrerelease}`);

if (!release.isPrerelease) {
  console.error(
    `\nRelease ${tag} is already marked stable. Nothing to promote.`,
  );
  process.exit(1);
}

const rl = createInterface({ input, output });
const answer = await rl.question(
  `\nPromote ${tag} to stable? Stable users will see this on next update check. [y/N] `,
);
rl.close();
if (answer.trim().toLowerCase() !== "y") {
  console.log("Aborted.");
  process.exit(0);
}

run(`gh release edit ${tag} --prerelease=false --latest`);
console.log(`\n${tag} is now the latest stable release.`);
console.log(
  "Stable users will pick it up on their next auto-update check (within 30 min, or immediately on app restart / manual check).",
);
