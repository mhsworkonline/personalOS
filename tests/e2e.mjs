// End-to-end UI test for PersonalOS v2 via tauri-driver (W3C WebDriver).
// Covers the original v1 regression suite plus the person-centric features:
// People module, per-person documents with timeline expiry, person-owned
// bank accounts with credential reveal gate, and person-based search.
//
// Usage:
//   tauri-driver --native-driver <msedgedriver.exe matching WebView2>   (terminal 1)
//   node tests/e2e.mjs <screenshot-dir>                                 (terminal 2)
// Delete %APPDATA%\com.personalos.desktop first (fresh vault).
import fs from "node:fs";
import path from "node:path";

const DRIVER = "http://127.0.0.1:4444";
const APP = "C:\\claude-folder\\personalOS\\src-tauri\\target\\release\\personalos.exe";
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
  if (!res.ok) {
    throw new Error(`${method} ${p} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
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

async function gone(css, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    try {
      await S("/element", { using: "css selector", value: css });
      if (Date.now() - start > timeout) throw new Error(`still present: ${css}`);
      await sleep(150);
    } catch {
      return;
    }
  }
}

const click = async (id) => S(`/element/${id}/click`, {});
const type = async (id, text) => S(`/element/${id}/value`, { text });
const textOf = async (id) => S(`/element/${id}/text`, undefined, "GET");
const propOf = async (id, name) => S(`/element/${id}/property/${name}`, undefined, "GET");
const clickX = async (xpath) => click(await findX(xpath));

/** Set an <input> value React-safely (used for date inputs). */
async function setValue(id, value) {
  await S("/execute/sync", {
    script:
      "const el = arguments[0], v = arguments[1];" +
      "const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;" +
      "setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));",
    args: [{ [ELEM]: id }, value],
  });
}

/** Pick a <select> option by its visible label. */
async function selectOption(id, label) {
  await S("/execute/sync", {
    script:
      "const el = arguments[0], label = arguments[1];" +
      "for (const o of el.options) { if (o.text === label) { el.value = o.value;" +
      "el.dispatchEvent(new Event('change', { bubbles: true })); break; } }",
    args: [{ [ELEM]: id }, label],
  });
}

async function chord(...keys) {
  const down = keys.map((value) => ({ type: "keyDown", value }));
  const up = [...keys].reverse().map((value) => ({ type: "keyUp", value }));
  await S("/actions", { actions: [{ type: "key", id: "kb", actions: [...down, ...up] }] });
  await S("/actions", undefined, "DELETE");
}
const CTRL = "";
const SHIFT = "";
const ENTER = "";

async function shot(name) {
  try {
    const b64 = await S("/screenshot", undefined, "GET");
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, "base64"));
  } catch (e) {
    console.log(`  (screenshot ${name} failed: ${e.message})`);
  }
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

const pass = (name) => console.log(`PASS  ${name}`);

async function run() {
  step = "create session";
  const v = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: APP } } },
  });
  sessionId = v.sessionId;
  await sleep(1500);

  // --- 1. vault setup (first run) ---
  step = "vault setup";
  await waitText("Create your master password");
  await type(await find('input[placeholder="Master password"]'), MASTER);
  await type(await find('input[placeholder="Confirm master password"]'), MASTER);
  await clickX("//button[contains(., 'Create vault')]");
  await waitText("Timeline", 20000);
  pass("vault setup + unlock into dashboard");

  // --- 2. dashboard basics ---
  step = "dashboard task";
  await type(await find('input[placeholder^="Add a task"]'), "Buy milk" + ENTER);
  await waitText("Buy milk");
  pass("dashboard: add task");

  step = "dashboard quick note";
  await type(await find('input[placeholder^="Jot something down"]'), "remember the milk money" + ENTER);
  await waitText("remember the milk money");
  pass("dashboard: add quick note");

  step = "dashboard reminder";
  await clickX("//button[contains(., 'Add reminder')]");
  await type(await find('input[placeholder^="e.g. Renew car"]'), "Renew car insurance");
  await clickX("//button[contains(@class,'btn-acc') and contains(., 'Add reminder')]");
  await waitText("Renew car insurance");
  pass("dashboard: add reminder → timeline");

  // --- 3. People module ---
  step = "people: Me exists";
  await clickX("//aside//button[contains(., 'People')]");
  await waitText("Documents (0)");
  const meBody = await textOf(await find("body"));
  if (!meBody.includes("Me") || !meBody.includes("Self")) throw new Error("default person Me missing");
  pass("people: default person 'Me' auto-created");

  step = "people: add Father";
  await clickX("//button[contains(., 'Add person')]");
  await type(await findX("//label[div[text()='Full name']]//input"), "Ramesh Kumar");
  await type(await findX("//label[div[contains(text(),'Nickname')]]//input"), "Papa");
  await selectOption(await findX("//label[div[text()='Relationship']]//select"), "Father");
  await type(await findX("//label[div[contains(text(),'Phone')]]//input"), "9876500000");
  await clickX("(//button[contains(@class,'btn-acc') and contains(., 'Add person')])[last()]");
  await waitText("Ramesh Kumar");
  pass("people: add person (Father)");
  await shot("v2-01-father");

  step = "people: add passport document";
  await clickX("//button[contains(., 'Add document')]");
  await selectOption(await findX("//label[div[text()='Document type']]//select"), "Passport");
  await type(await findX("//label[div[text()='Document number']]//input"), "P7788990");
  await type(await findX("//label[div[text()='Name on document']]//input"), "Ramesh Kumar");
  await setValue(await findX("//label[div[contains(text(),'Expiry date')]]//input"), "2026-07-20");
  await type(await findX("//label[div[contains(text(),'Issuing authority')]]//input"), "RPO Chennai");
  await clickX("(//button[contains(@class,'btn-acc') and contains(., 'Add document')])[last()]");
  await waitText("attach scans", 6000);
  await clickX("//button[text()='Close']");
  await waitText("Documents (1)");
  pass("people: add document with expiry date");

  step = "people: document number masked";
  const docCard = await textOf(await find("body"));
  if (docCard.includes("P7788990")) throw new Error("document number shown unmasked");
  if (!docCard.includes("•••• 8990")) throw new Error("masked number missing");
  pass("people: document number masked by default (•••• 8990)");
  await shot("v2-02-document");

  step = "document expiry on shared timeline";
  await clickX("//aside//button[contains(., 'Dashboard')]");
  await waitText("Ramesh Kumar: Passport expires");
  pass("timeline: document expiry auto-event with owner name");

  // --- 4. person-owned finance ---
  step = "finance: bank account for Father with credentials";
  await clickX("//aside//button[contains(., 'Finance')]");
  await waitText("Net worth");
  await clickX("//button[text()='Accounts']");
  await clickX("//button[contains(., 'Add account')]");
  await type(await findX("//label[div[text()='Account name']]//input"), "HDFC Salary");
  await selectOption(await findX("//label[div[text()='Belongs to']]//select"), "Papa");
  await type(await findX("//label[div[contains(text(),'balance')]]//input"), "50000");
  await type(await findX("//label[div[text()='Bank name']]//input"), "HDFC Bank");
  await type(await findX("//label[div[text()='IFSC']]//input"), "HDFC0001234");
  await type(await findX("//label[div[text()='Login ID']]//input"), "LOGIN77");
  await type(await findX("//label[div[text()='Password']]//input"), "NetSecret#1");
  await type(await findX("//label[div[text()='MPIN']]//input"), "445566");
  await clickX("//button[contains(., 'Add card')]");
  await type(await find('input[placeholder="Nickname"]'), "Platinum");
  await type(await find('input[placeholder="Last 4"]'), "4321");
  await clickX("//button[text()='Save']");
  await waitText("HDFC Salary");
  await waitText("Papa");
  pass("finance: bank account with net-banking, MPIN, card — owned by Father");

  step = "finance: credentials masked until master password";
  await clickX("//div[contains(@class,'card')][contains(., 'HDFC Salary')]//button[contains(@class,'btn-ghost')][1]");
  const pwInput = await findX("//label[div[text()='Password']]//input");
  if ((await propOf(pwInput, "type")) !== "password") throw new Error("password not masked");
  const mpinInput = await findX("//label[div[text()='MPIN']]//input");
  if ((await propOf(mpinInput, "type")) !== "password") throw new Error("MPIN not masked");
  pass("finance: credentials masked by default in editor");

  step = "finance: reveal gate rejects wrong master password";
  await clickX("//button[contains(., 'Reveal saved credentials')]");
  await type(await find('input[placeholder="Master password"]'), "wrong-master" + ENTER);
  await waitText("Wrong master password");
  pass("finance: wrong master password rejected at reveal gate");
  await shot("v2-03-reveal-gate");

  step = "finance: correct master password reveals";
  const gatePw = await find('input[placeholder="Master password"]');
  await click(gatePw);
  await chord(CTRL, "a");
  await type(gatePw, MASTER + ENTER);
  await sleep(800);
  const pwInput2 = await findX("//label[div[text()='Password']]//input");
  if ((await propOf(pwInput2, "type")) !== "text") throw new Error("password still masked after verify");
  if ((await propOf(pwInput2, "value")) !== "NetSecret#1") throw new Error("revealed value wrong");
  pass("finance: master password confirmation reveals credentials");
  await clickX("//button[text()='Cancel']");

  step = "finance: transaction + balance";
  await clickX("//button[text()='Transactions']");
  await clickX("//button[contains(., 'Add transaction')]");
  await type(await findX("//label[div[text()='Amount']]//input"), "1200");
  await type(await findX("//label[div[contains(text(),'Category')]]//input"), "groceries");
  await clickX("//div[contains(@class,'card')]//button[text()='Add']");
  await waitText("groceries");
  await clickX("//button[text()='Accounts']");
  await waitText("48,800");
  pass("finance: transaction adjusts balance (50000 → 48800)");

  step = "finance: subscription for Father";
  await clickX("//button[text()='Subscriptions']");
  await clickX("//button[contains(., 'Add subscription')]");
  await type(await findX("//label[div[text()='Name']]//input"), "Netflix");
  await selectOption(await findX("//label[div[text()='Belongs to']]//select"), "Papa");
  await type(await findX("//label[div[text()='Amount']]//input"), "649");
  await clickX("//button[text()='Save']");
  await waitText("Netflix");
  pass("finance: subscription owned by Father");

  step = "finance: EMI";
  await clickX("//button[text()='EMIs']");
  await clickX("//button[contains(., 'Add EMI')]");
  await type(await findX("//label[div[text()='Name']]//input"), "Car loan");
  await type(await findX("//label[div[text()='Monthly amount']]//input"), "15000");
  await type(await findX("//label[div[text()='Total months']]//input"), "24");
  await clickX("//button[text()='Save']");
  await waitText("Car loan");
  pass("finance: add EMI");

  // --- 5. vault with person ---
  step = "vault: item owned by Father";
  await clickX("//aside//button[contains(., 'Vault')]");
  await waitText("All items");
  await click(await find('button[title="New item"]'));
  await sleep(300);
  await type(await findX("//label[div[text()='Name']]//input"), "GitHub");
  await selectOption(await findX("//label[div[text()='Belongs to']]//select"), "Papa");
  await type(await findX("//label[div[text()='Username / email']]//input"), "ramesh-dev");
  await type(await findX("//label[div[text()='Password']]//input"), "SecretHub#2026");
  await clickX("//button[contains(., 'Add to vault')]");
  await waitText("ramesh-dev");
  await click(await find('button[title="Reveal"]'));
  await waitText("SecretHub#2026");
  pass("vault: person-owned item, secret reveal works");

  // --- 6. notes ---
  step = "notes: create with tags";
  await clickX("//aside//button[contains(., 'Notes')]");
  await click(await find('button[title="New note (Ctrl+N)"]'));
  await waitText("Untitled");
  const titleInput = await find('input[placeholder="Title"]');
  await S(`/element/${titleInput}/clear`, {});
  await type(titleInput, "Server setup checklist");
  await type(await find('textarea[placeholder^="Write in markdown"]'), "# Steps\n\n- install **nginx**\n- configure postgres backups");
  await type(await find('input[placeholder^="tags,"]'), "devops, homelab");
  await chord(CTRL, "s");
  await waitText("saved");
  pass("notes: create note with tags (Ctrl+S save)");

  step = "notes: markdown preview";
  await click(await find('button[title="Preview markdown"]'));
  await findX("//h1[text()='Steps']");
  await findX("//strong[text()='nginx']");
  pass("notes: markdown preview renders");

  step = "notes: pin + tag filter";
  await click(await find('button[title="Pin note"]'));
  await waitText("Pinned");
  await clickX("//button[.='#devops']");
  await waitText("Server setup checklist");
  pass("notes: pin + tag filter");

  // --- 7. universal search incl. person search ---
  step = "universal search: content prefix";
  await chord(CTRL, " ");
  const searchBox = await find('input[placeholder="Search everything…"]');
  await type(searchBox, "postg");
  await waitText("Server setup checklist");
  pass("universal search: Ctrl+Space finds note by content prefix");

  step = "universal search: by relationship 'Father'";
  await click(searchBox);
  await chord(CTRL, "a");
  await type(searchBox, "Father");
  await waitText("Ramesh Kumar");
  const fatherResults = await textOf(await find("body"));
  for (const needle of ["Passport", "HDFC Salary", "Netflix", "GitHub"]) {
    if (!fatherResults.toLowerCase().includes(needle.toLowerCase())) throw new Error(`search Father missing: ${needle}`);
  }
  pass("universal search: 'Father' returns his documents, account, subscription, vault item");
  await shot("v2-04-search-father");

  step = "universal search: open person result";
  await clickX("//button[contains(., 'Ramesh Kumar')]");
  await waitText("Documents (1)");
  pass("universal search: opening a person result lands on their dashboard");
  await shot("v2-05-person-dashboard");

  step = "person dashboard aggregates";
  const pd = await textOf(await find("body"));
  for (const needle of [
    "Bank accounts (1)",
    "Vault entries (1)",
    "Subscriptions (1)",
    "Passport",
    "Netflix",
    "HDFC Salary",
    "GitHub",
    "Passport expires",
  ]) {
    if (!pd.toLowerCase().includes(needle.toLowerCase())) throw new Error(`person dashboard missing: ${needle}`);
  }
  pass("person dashboard: documents, accounts, vault, subscriptions, upcoming — all present");

  // --- 8. person delete safety ---
  step = "person delete: guarded";
  await clickX("//button[@title='Delete person']");
  await waitText("still owns");
  const del = await textOf(await find("body"));
  if (!del.includes("Move all records to")) throw new Error("no reassignment offered");
  await clickX("//button[contains(., 'Move records & delete person')]");
  await waitText("Person deleted");
  pass("person delete: forced safe reassignment (records moved, nothing lost)");

  step = "person delete: records survived under Me";
  await waitText("Documents (1)", 10000); // Me now owns the passport
  const meAfter = await textOf(await find("body"));
  for (const needle of ["Passport", "HDFC Salary", "Netflix", "GitHub"]) {
    if (!meAfter.toLowerCase().includes(needle.toLowerCase())) throw new Error(`record lost after person delete: ${needle}`);
  }
  pass("person delete: all records intact under Me");
  await shot("v2-06-after-delete");

  // --- 9. quick capture + lock ---
  step = "quick capture";
  await chord(CTRL, SHIFT, " ");
  await waitText("Quick capture");
  await chord(CTRL, "2");
  await type(await find('input[placeholder="What needs doing?"]'), "Call the plumber" + ENTER);
  await gone('input[placeholder="What needs doing?"]');
  await clickX("//aside//button[contains(., 'Dashboard')]");
  await waitText("Call the plumber");
  pass("quick capture: Ctrl+Shift+Space adds a task from anywhere");

  step = "lock/unlock";
  await chord(CTRL, SHIFT, "l");
  await waitText("Locked");
  await type(await find('input[placeholder="Master password"]'), "wrong-password" + ENTER);
  await waitText("Invalid master password");
  pass("lock: wrong password rejected");
  const unlockPw = await find('input[placeholder="Master password"]');
  await click(unlockPw);
  await chord(CTRL, "a");
  await type(unlockPw, MASTER + ENTER);
  await waitText("Timeline", 20000);
  const after = await textOf(await find("body"));
  if (!after.includes("Buy milk")) throw new Error("data missing after unlock");
  pass("unlock: correct password restores all data");

  console.log("\nALL V2 E2E TESTS PASSED");
}

run()
  .then(() => wd("DELETE", `/session/${sessionId}`).catch(() => {}))
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(`\nFAILED at step "${step}": ${e.message}`);
    await shot("failure");
    if (sessionId) await wd("DELETE", `/session/${sessionId}`).catch(() => {});
    process.exit(1);
  });
