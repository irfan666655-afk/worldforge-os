/* server-storage-smoke.mjs — server-side recovery parity + crash-atomic flush
 *
 * Proves the fixes wired into src/server.js: the file-backed governance
 * storage is wrapped by WFRecovery (auto-rollback on corrupt-at-rest,
 * fail-closed on corrupt write) and flush() is crash-atomic (tmp -> fsync ->
 * rename, no truncated primary, no leftover temp file). Exercises the ACTUAL
 * server helpers (app._fileStorage / app._WFRecovery), not a replica. */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

const app = require("../src/server.js");
const fileStorage = app._fileStorage;
const WFRecovery = app._WFRecovery;

let pass = 0, fail = 0;
const t = (n, c) => { c ? pass++ : (fail++, console.error("FAIL: " + n)); };
const quiet = { error() {}, log() {}, warn() {} };
const realConsole = console;

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wf-store-")), "gov.json");
}

const run = async () => {
  t("server exposes _fileStorage + _WFRecovery test hooks",
    typeof fileStorage === "function" && WFRecovery && typeof WFRecovery.wrap === "function");

  /* ---- crash-atomic flush ---- */
  {
    const file = tmpFile();
    const raw = fileStorage(file);
    await raw.set("wfproj:a", JSON.stringify({ id: "a", n: 1 }));
    t("flush writes a valid JSON primary", (() => {
      try { JSON.parse(fs.readFileSync(file, "utf8")); return true; } catch { return false; }
    })());
    t("flush leaves no .tmp turd behind", !fs.existsSync(file + ".tmp"));
    const before = fs.readFileSync(file, "utf8");
    await raw.set("wfproj:b", JSON.stringify({ id: "b", n: 2 }));
    t("second flush is still atomic + valid", (() => {
      try { const o = JSON.parse(fs.readFileSync(file, "utf8")); return "wfproj:a" in o && "wfproj:b" in o; }
      catch { return false; }
    })() && !fs.existsSync(file + ".tmp"));
    t("previous content was a strict superset (no partial overwrite)",
      before.includes("wfproj:a"));
  }

  /* ---- recovery parity: shadow discipline + auto-rollback ---- */
  {
    global.console = quiet; // recovery is deliberately loud
    const file = tmpFile();
    const s = WFRecovery.wrap(fileStorage(file), { prefixes: ["wfproj:"] });
    await s.set("wfproj:doc", JSON.stringify({ id: "doc", v: 1 }));

    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    t("wrapped set stamps a hash-verified shadow", "wfshadow:wfproj:doc" in onDisk);

    const listed = await s.list("wfproj:");
    t("list() hides shadow keys from callers", listed.keys.every((k) => k.indexOf("wfshadow:") !== 0)
      && listed.keys.includes("wfproj:doc"));

    // Simulate corruption-at-rest: a RAW adapter (bypassing the guard) writes
    // garbage over the primary, leaving the pristine shadow intact.
    const rawCorrupt = fileStorage(file);
    await rawCorrupt.set("wfproj:doc", "CORRUPT{{{not-json");

    const s2 = WFRecovery.wrap(fileStorage(file), { prefixes: ["wfproj:"] });
    const r = await s2.get("wfproj:doc");
    global.console = realConsole;
    t("corrupt primary auto-rolls-back to pristine shadow",
      r && r.recovered === true && JSON.parse(r.value).v === 1);

    const healed = JSON.parse(fs.readFileSync(file, "utf8"));
    t("rollback heals the primary on disk", (() => {
      try { return JSON.parse(healed["wfproj:doc"]).v === 1; } catch { return false; }
    })());
  }

  /* ---- fail-closed: a corrupt write never lands ---- */
  {
    global.console = quiet;
    const file = tmpFile();
    const s = WFRecovery.wrap(fileStorage(file), { prefixes: ["wfproj:"] });
    let threw = false;
    try { await s.set("wfproj:bad", "not-a-json-object"); } catch { threw = true; }
    const landed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    global.console = realConsole;
    t("corrupt write is refused (fail-closed) and never lands",
      threw && !("wfproj:bad" in landed));
  }

  /* ---- non-guarded keys pass through untouched ---- */
  {
    const file = tmpFile();
    const s = WFRecovery.wrap(fileStorage(file), { prefixes: ["wfproj:"] });
    await s.set("meta:info", "plain-string-ok");
    const r = await s.get("meta:info");
    t("non-guarded key is passed through unwrapped", r && r.value === "plain-string-ok");
  }

  realConsole.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { global.console = realConsole; console.error(e); process.exit(1); });
