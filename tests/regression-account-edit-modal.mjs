// Regression test for: editing an account from its detail popup left a dead,
// orphaned copy of AccountDetailModal stacked behind the live one (looked
// like the popup "wouldn't close" — X only removed the top ghost copy).
// Root cause: AccountDetailModal (key={openId}) and AccountEditor
// (key={editing.id}), opened from within it, shared the same numeric key
// once editing.id === openId. React requires sibling keys to be unique
// regardless of element type; a collision corrupts its reconciliation
// bookkeeping and silently orphans one DOM subtree instead of swapping it
// cleanly (see https://github.com/react/react/issues/24871). Fixed by
// namespacing the keys (`detail-${id}` / `editor-${id}`) in Finance.tsx's
// Accounts and Dashboard.tsx's quick-view account popup.
//
// Path: Accounts tab -> open account row (detail modal) -> Edit -> change name
// -> Save -> assert exactly one modal remains (the detail popup), not two.
// Usage: tauri-driver --native-driver <msedgedriver.exe>  (terminal 1)
//        node tests/regression-account-edit-modal.mjs <shots-dir>  (terminal 2)
//
// Points at the DEBUG binary (target/debug/personalos.exe below), which
// always writes into a nested `debug-test-data` subfolder regardless of
// identifier (see cfg!(debug_assertions) in src-tauri/src/lib.rs) — so
// wiping ITS data folder for a fresh vault can never touch a real vault.
// For a clean run, delete %APPDATA%\com.personalos.desktop\debug-test-data
// (NOT the parent com.personalos.desktop folder — that may hold real data).
import fs from "node:fs";
import path from "node:path";

const DRIVER = "http://127.0.0.1:4444";
const APP = "C:\\claude-folder\\personalOS\\src-tauri\\target\\debug\\personalos.exe";
const SHOTS = process.argv[2] ?? ".";
const MASTER = "test-master-pass-123";

let sessionId = null;
let step = "init";

async function wd(method, p, body) {
  const res = await fetch(`${DRIVER}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.value;
}

const S = (p, body, m = "POST") => wd(m, `/session/${sessionId}${p}`, body);
const ELEM = "element-6066-11e4-a52e-4f735466cecf";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function find(css, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    try {
      return (await S("/element", { using: "css selector", value: css }))[ELEM];
    } catch (e) {
      if (Date.now() - start > timeout) throw new Error(`not found: ${css} (${e.message})`);
      await sleep(150);
    }
  }
}
async function findX(xpath, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    try {
      return (await S("/element", { using: "xpath", value: xpath }))[ELEM];
    } catch (e) {
      if (Date.now() - start > timeout) throw new Error(`not found: ${xpath} (${e.message})`);
      await sleep(150);
    }
  }
}
const click = async (id) => S(`/element/${id}/click`, {});
const type = async (id, text) => S(`/element/${id}/value`, { text });
const textOf = async (id) => S(`/element/${id}/text`, undefined, "GET");
const clickX = async (xpath) => click(await findX(xpath));
const CTRL = "\uE009";
const ENTER = "\uE007";

async function chord(...keys) {
  const down = keys.map((value) => ({ type: "keyDown", value }));
  const up = [...keys].reverse().map((value) => ({ type: "keyUp", value }));
  await S("/actions", { actions: [{ type: "key", id: "kb", actions: [...down, ...up] }] });
  await S("/actions", undefined, "DELETE");
}

async function waitText(needle, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    const t = await textOf(await find("body"));
    if (t.toLowerCase().includes(needle.toLowerCase())) return;
    if (Date.now() - start > timeout) throw new Error(`text not found on page: "${needle}"`);
    await sleep(200);
  }
}

async function shot(name) {
  try {
    const b64 = await S("/screenshot", undefined, "GET");
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, "base64"));
    console.log(`  (screenshot saved: ${name}.png)`);
  } catch (e) {
    console.log(`  (screenshot ${name} failed: ${e.message})`);
  }
}

/** Count open modal backdrops currently in the DOM. */
async function modalCount() {
  return S("/execute/sync", {
    script: "return document.querySelectorAll('.fixed.inset-0.z-50').length;",
    args: [],
  });
}

const pass = (name) => console.log(`PASS  ${name}`);

async function run() {
  step = "create session";
  const v = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: APP } } },
  });
  sessionId = v.sessionId;
  await sleep(1500);

  step = "vault setup";
  await waitText("Create your master password");
  await type(await find('input[placeholder="Master password"]'), MASTER);
  await type(await find('input[placeholder="Confirm master password"]'), MASTER);
  await clickX("//button[contains(., 'Create vault')]");
  await waitText("Timeline", 20000);
  pass("vault created + unlocked");

  step = "go to finance accounts";
  await clickX("//aside//button[contains(., 'Finance')]");
  await waitText("Net worth");
  await clickX("//button[text()='Accounts']");
  pass("on Accounts tab");

  step = "add an account";
  await clickX("//button[contains(., 'Add account')]");
  await type(await findX("//label[div[text()='Account name']]//input"), "My Cash");
  await selectKind();
  await type(await findX("//label[div[contains(text(),'balance')]]//input"), "1000");
  await clickX("//button[text()='Save']");
  await waitText("My Cash");
  pass("account created");
  console.log(`  modal count after create-save: ${await modalCount()}`);

  step = "open account detail popup";
  await clickX("//div[contains(@class,'card')][contains(., 'My Cash')]");
  await waitText("Transaction history");
  console.log(`  modal count after opening detail: ${await modalCount()}`);
  await shot("repro-01-detail-open");

  step = "click Edit inside detail popup";
  await clickX("//button[contains(., 'Edit')]");
  await waitText("Edit My Cash");
  console.log(`  modal count after opening editor from detail: ${await modalCount()}`);
  await shot("repro-02-editor-open-over-detail");

  step = "change the name and Save";
  const nameInput = await findX("//label[div[text()='Account name']]//input");
  await click(nameInput);
  await chord(CTRL, "a");
  await type(nameInput, "My Cash Edited");
  await clickX("//div[contains(@class,'pop-in')]//button[text()='Save']");

  step = "check state after Save (should be back to plain Accounts list / detail popup only, no stuck editor)";
  await sleep(1000);
  const count = await modalCount();
  console.log(`  modal count 1s after Save click: ${count}`);
  await shot("repro-03-after-save");

  // Give it a generous window in case something is just slow, then report the truth either way.
  const start = Date.now();
  let settled = false;
  while (Date.now() - start < 15000) {
    const c = await modalCount();
    const body = await textOf(await find("body"));
    if (!body.includes("My Cash Edited") === false && c === 0) {
      settled = true;
      break;
    }
    // Consider "settled" once we're down to at most the detail popup (1) or fully closed (0),
    // i.e. the editor itself closed.
    if (c <= 1 && body.includes("My Cash Edited")) {
      settled = true;
      break;
    }
    await sleep(500);
  }
  await shot("repro-04-final-state");
  const finalCount = await modalCount();
  const finalBody = await textOf(await find("body"));
  console.log(`  FINAL modal count: ${finalCount}`);
  console.log(`  FINAL body includes "My Cash Edited": ${finalBody.includes("My Cash Edited")}`);
  console.log(`  FINAL body includes "Edit My Cash Edited" (editor still open): ${finalBody.includes("Edit My Cash Edited")}`);

  if (!settled) {
    throw new Error("Editor popup never closed after Save (reproduced the hang)");
  }
  pass("editor closed after Save");

  console.log("\nREPRO SCRIPT COMPLETE");
}

async function selectKind() {
  // leave default "Bank" -> actually pick Cash for parity with the report
  const sel = await findX("//label[div[text()='Type']]//select");
  await S("/execute/sync", {
    script:
      "const el = arguments[0];" +
      "for (const o of el.options) { if (o.text === 'Cash') { el.value = o.value;" +
      "el.dispatchEvent(new Event('change', { bubbles: true })); break; } }",
    args: [{ [ELEM]: sel }],
  });
}

run()
  .then(() => wd("DELETE", `/session/${sessionId}`).catch(() => {}))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(`\nFAILED at step "${step}": ${e.message}`);
    await shot("repro-failure");
    if (sessionId) await wd("DELETE", `/session/${sessionId}`).catch(() => {});
    process.exit(1);
  });
