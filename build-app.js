#!/usr/bin/env node
// Build PersonalOS into ./out/, so there is exactly one place to find each
// kind of build:
//
//   node build-app.js test              -> out/test/personalos.exe
//        Debug profile, no installer (--no-bundle) so the edit/test loop
//        stays fast. Ungated: it is for trying a change, not for shipping.
//
//   node build-app.js release [x.y.z]   -> out/release/personalos.exe
//                                          out/release/PersonalOS_<v>_x64-setup.exe
//        Optimized, bundled, and gated behind typecheck + cargo test so a
//        broken build never becomes a distributable. Passing a version syncs
//        it across package.json, Cargo.toml and tauri.conf.json first —
//        without that, every installer keeps the same filename and Windows
//        will not treat a newer one as an upgrade.
//
// Both outputs are standalone (the frontend is bundled in; no dev server).
// ./out/ is gitignored — build artifacts must never reach the repo.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];
const version = process.argv[3];
if (mode !== "test" && mode !== "release") {
  console.error("Usage: node build-app.js <test|release> [version]");
  process.exit(1);
}
if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version must look like 1.2.3 (got "${version}")`);
  process.exit(1);
}
if (version && mode !== "release") {
  console.error("A version can only be set on a release build.");
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

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function killRunningApp() {
  try {
    execSync(
      'powershell -NoProfile -Command "Stop-Process -Name personalos -Force -ErrorAction SilentlyContinue"'
    );
  } catch {
    /* nothing was running */
  }
}

// The version lives in three files and they must not drift: the installer
// filename comes from tauri.conf.json, and Windows uses it for upgrades.
function setVersion(v) {
  const root = process.cwd();
  for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
    const path = join(root, file);
    const json = JSON.parse(readFileSync(path, "utf8"));
    json.version = v;
    writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
    console.log(`  ${file} -> ${v}`);
  }
  // Only the [package] version, which is the first `version = "…"` in the file.
  const cargoPath = join(root, "src-tauri", "Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf8");
  writeFileSync(cargoPath, cargo.replace(/^version = "\d+\.\d+\.\d+"$/m, `version = "${v}"`));
  console.log(`  src-tauri/Cargo.toml -> ${v}`);
}

const root = process.cwd();
const targetDir = join(root, "src-tauri", "target", mode === "test" ? "debug" : "release");
const destDir = join(root, "out", mode);

if (mode === "release") {
  if (version) {
    console.log("\n== Setting version ==");
    setVersion(version);
  }
  console.log("\n== Gate 1/2: frontend typecheck + build ==");
  run("npm run build");
  console.log("\n== Gate 2/2: Rust tests ==");
  run("cargo test", { cwd: "src-tauri" });
}

killRunningApp();
run(
  mode === "test"
    ? "npm run tauri build -- --debug --no-bundle"
    : "npm run tauri build"
);

mkdirSync(destDir, { recursive: true });
copyFileSync(join(targetDir, "personalos.exe"), join(destDir, "personalos.exe"));
console.log(`\nCopied personalos.exe -> ${join(destDir, "personalos.exe")}`);

// Only release builds bundle an installer. Guarded on mode, not on the folder
// existing — a --no-bundle test build leaves any earlier installer sitting in
// target/, and copying that stale file would be worse than shipping none.
const nsisDir = join(targetDir, "bundle", "nsis");
if (mode === "release" && existsSync(nsisDir)) {
  for (const f of readdirSync(nsisDir).filter((f) => f.endsWith(".exe"))) {
    copyFileSync(join(nsisDir, f), join(destDir, f));
    console.log(`Copied ${f} -> ${join(destDir, f)}`);
  }
}

console.log(`\n${mode === "test" ? "Test" : "Release"} build ready in ${destDir}`);
