#!/usr/bin/env node
// Deploy PersonalOS: verify build/tests pass, then commit and push to GitHub.
//
// Usage:
//   node deploy.js ["commit message"]
//
// If no commit message is given and there are changes to commit, you'll be
// prompted for one. Aborts on any failed step (typecheck, build, cargo test)
// so broken code never reaches origin/main.

import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
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
    let message = process.argv.slice(2).join(" ").trim();
    if (!message) {
      message = await prompt("Commit message: ");
    }
    if (!message) {
      console.error("No commit message given, aborting.");
      process.exit(1);
    }
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
