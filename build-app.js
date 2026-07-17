#!/usr/bin/env node
// Build PersonalOS and drop the result into a fixed folder at the project
// root, so there's always exactly one place to find each kind of build:
//
//   node build-app.js test     -> debug-profile build (fast to rebuild while
//                                 iterating) copied to ./personalOS-test-build/
//   node build-app.js release  -> optimized final build copied to ./personalOS/
//
// Both are standalone (bundle the frontend; no `npm run dev` server needed).
// Kills any running personalos.exe first — a leftover process locks the
// target/ output file and makes the build fail with "Access is denied".

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "test" && mode !== "release") {
  console.error('Usage: node build-app.js <test|release>');
  process.exit(1);
}

// cargo + the vendored OpenSSL build need these on PATH (see CLAUDE.md).
const extraPaths = [
  join(process.env.USERPROFILE ?? "", ".cargo", "bin"),
  "C:\\Strawberry\\perl\\bin",
].filter((p) => existsSync(p) && !process.env.PATH.includes(p));
if (extraPaths.length) {
  process.env.PATH = `${extraPaths.join(";")};${process.env.PATH}`;
}

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function killRunningApp() {
  try {
    execSync('powershell -NoProfile -Command "Stop-Process -Name personalos -Force -ErrorAction SilentlyContinue"');
  } catch {
    /* nothing was running */
  }
}

const root = process.cwd();
const targetDir = join(root, "src-tauri", "target", mode === "test" ? "debug" : "release");
const destDir = join(root, mode === "test" ? "personalOS-test-build" : "personalOS");

killRunningApp();
run(mode === "test" ? "npm run tauri build -- --debug" : "npm run tauri build");

mkdirSync(destDir, { recursive: true });
copyFileSync(join(targetDir, "personalos.exe"), join(destDir, "personalos.exe"));
console.log(`\nCopied personalos.exe -> ${join(destDir, "personalos.exe")}`);

const nsisDir = join(targetDir, "bundle", "nsis");
if (existsSync(nsisDir)) {
  for (const f of readdirSync(nsisDir).filter((f) => f.endsWith(".exe"))) {
    copyFileSync(join(nsisDir, f), join(destDir, f));
    console.log(`Copied ${f} -> ${join(destDir, f)}`);
  }
}

console.log(`\n${mode === "test" ? "Test" : "Release"} build ready in ${destDir}`);
