#!/usr/bin/env node
// Build the fast test build and immediately launch it, so trying a change is
// one command instead of "build, then go find the exe, then double-click it".
//
// Usage:
//   node start.js        (or: npm start)
//
// Release builds are deliberately NOT part of this — run `npm run release`
// for those.

import { execSync, spawn } from "node:child_process";
import { join } from "node:path";

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("node build-app.js test");

const exe = join(process.cwd(), "out", "test", "personalos.exe");
console.log(`\nLaunching ${exe}`);
spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
