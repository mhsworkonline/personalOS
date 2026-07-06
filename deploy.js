#!/usr/bin/env node
// Deploy PersonalOS: verify build/tests pass, then commit and push to GitHub.
//
// Usage:
//   node deploy.js ["commit message"]
//
// If no commit message is given, one is generated from the changed files.
// Aborts on any failed step (typecheck, build, cargo test) so broken code
// never reaches origin/main. Fully non-interactive — no prompts.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// cargo + the vendored OpenSSL build need these on PATH (see CLAUDE.md's build
// note); the calling shell doesn't always have them, so add them ourselves.
const extraPaths = [
  join(process.env.USERPROFILE ?? "", ".cargo", "bin"),
  "C:\\Strawberry\\perl\\bin",
].filter((p) => existsSync(p) && !process.env.PATH.includes(p));
if (extraPaths.length) {
  process.env.PATH = `${extraPaths.join(";")};${process.env.PATH}`;
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

// "M src/foo.ts" / "?? src/bar.ts" -> "src" (top-level dir, or the bare
// filename for root-level files), deduplicated and capped so the message
// stays short even for a big change set.
function autoMessage(statusPorcelain) {
  const paths = statusPorcelain
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const groups = [...new Set(paths.map((p) => p.split("/")[0]))];
  const shown = groups.slice(0, 4).join(", ");
  const more = groups.length > 4 ? ` and ${groups.length - 4} more` : "";
  return `Update ${shown}${more}`;
}

async function main() {
  const branch = runCapture("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") {
    console.error(`Refusing to deploy from branch "${branch}" (expected "main").`);
    process.exit(1);
  }

  console.log("== Step 1/4: frontend typecheck + build ==");
  run("npm run build");

  console.log("\n== Step 2/4: Rust tests ==");
  run("cargo test", { cwd: "src-tauri" });

  console.log("\n== Step 3/4: commit changes ==");
  const status = runCapture("git status --porcelain");
  if (status) {
    run("git add -A");
    const message = process.argv.slice(2).join(" ").trim() || autoMessage(status);
    console.log(`Commit message: ${message}`);
    run(`git commit -m ${JSON.stringify(message)}`);
  } else {
    console.log("Working tree clean, nothing to commit.");
  }

  const ahead = runCapture("git rev-list @{u}.. --count");
  if (ahead === "0") {
    console.log("\nNothing new to push. Already up to date with origin/main.");
    return;
  }

  console.log("\n== Step 4/4: push to origin/main ==");
  run("git push origin main");

  console.log("\nDeployed: origin/main updated.");
}

main().catch((err) => {
  console.error("\nDeploy aborted:", err.message);
  process.exit(1);
});
