#!/usr/bin/env node
/*!
 * build.mjs — WorldForge P4 build + gates. Zero dependencies, Node >= 18.
 * Cross-platform: replaces every grep/ls step in the strategy so the same
 * commands run on Windows, macOS, Linux.
 *
 *   node build.mjs --inventory <file.html>     script-block + size report
 *   node build.mjs --xrefs <blocksDir>         cross-reference edge list
 *   node build.mjs --gate                      window.WFKernel outside adapter -> fail
 *   node build.mjs --deadcheck <name>          reference search + CSS orphan diff
 *   node build.mjs --bundle                    manifest concat -> inline into shell
 *   node build.mjs --verify                    rebuild, compare embedded hash
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/* ---------- configuration (edit paths once source arrives) ---------- */
const CONFIG = {
  // Explicit order = deterministic build. Never glob.
  manifest: [
    "vendor-loader.js",
    "kernel-adapter.js",
    "wfkernel-p2-ext.v1.2.js",
    "wf-ufdm-components.v1.js",
    "guilds-data.js",
    "components/text-roster.js",
    "components/escalation-viz.js",
    "components/forge.js",
    "wf-gate-override.v1.js",
    "wf-ufdm-visual.v1.js",
    "app.js",
  ],
  // Inlined into the shell <head> between WF:CSS markers; hashed with the JS
  // so --verify catches stale styles the same as stale code.
  css: ["wf-ufdm-visual.v1.css"],
  // Single source of truth: the shell used to carry a hand-synced inline
  // copy of the kernel — a divergence hazard (proven 2026-07-19 when a
  // kernel fix didn't reach the artifact). Spliced from the file now.
  kernel: "worldforge-kernel.v1.1.js",
  srcDir: "src",
  shell: "shell.html",            // HTML with <!-- WF:BUNDLE:BEGIN/END --> markers
  out: "worldforge-os_5.html",
  adapterFile: "kernel-adapter.js", // only file allowed to touch window.WFKernel
};

const args = process.argv.slice(2);
const cmd = args[0];
const die = (msg) => { console.error("FAIL: " + msg); process.exit(1); };
const ok = (msg) => console.log("OK: " + msg);
const norm = (s) => s.replace(/\r\n/g, "\n");           // LF-normalize for stable hashes
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function walk(dir, exts, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules") walk(p, exts, acc); }
    else if (exts.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}

/* ---------- --inventory ---------- */
if (cmd === "--inventory") {
  const file = args[1] || die("usage: --inventory <file.html>");
  const html = norm(readFileSync(file, "utf8"));
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const inline = blocks.filter((m) => !/\bsrc\s*=/.test(m[1]));
  const external = blocks.filter((m) => /\bsrc\s*=/.test(m[1]))
    .map((m) => (m[1].match(/src\s*=\s*["']([^"']+)["']/) || [])[1]);
  const links = [...html.matchAll(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const report = {
    file, bytes: Buffer.byteLength(html),
    sizeHuman: (Buffer.byteLength(html) / 1048576).toFixed(2) + " MB",
    inlineScriptBlocks: inline.length,
    externalScripts: external, stylesheets: links,
    hash: sha256(html),
  };
  console.log(JSON.stringify(report, null, 2));
  writeFileSync("p4-baseline.json", JSON.stringify(report, null, 2));
  // extract blocks for categorization
  inline.forEach((m, i) => {
    const dir = "work/blocks";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, String(i).padStart(2, "0") + ".js"), m[2]);
  });
  if (inline.length >= 20) console.warn("WARN: >=20 inline blocks — reassess before extraction");
  if (inline.length) ok(`extracted ${inline.length} blocks to work/blocks/ — label them in manifest.json`);
}

/* ---------- --xrefs ---------- */
if (cmd === "--xrefs") {
  const dir = args[1] || die("usage: --xrefs <blocksDir>");
  const files = walk(dir, [".js"]);
  const defs = new Map(); // identifier -> file
  const defRe = /(?:function|class)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(defRe)) defs.set(m[1] || m[2], f);
  }
  const edges = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const [id, def] of defs) {
      if (def !== f && new RegExp("\\b" + id + "\\b").test(src)) edges.push(`${path.basename(f)} -> ${path.basename(def)} (${id})`);
    }
  }
  console.log(edges.length ? edges.join("\n") : "no cross-references found");
}

/* ---------- --gate ---------- */
if (cmd === "--gate") {
  const files = walk(CONFIG.srcDir, [".js", ".html"]);
  const offenders = [];
  for (const f of files) {
    if (path.basename(f) === CONFIG.adapterFile) continue;
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      if (/window\s*\.\s*WFKernel/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  offenders.length
    ? die("window.WFKernel outside adapter:\n" + offenders.join("\n"))
    : ok("global-scope gate clean — kernel access confined to " + CONFIG.adapterFile);
}

/* ---------- --deadcheck ---------- */
if (cmd === "--deadcheck") {
  const name = args[1] || die("usage: --deadcheck <name>");
  const files = walk(".", [".js", ".html", ".css"]);
  const refs = [];
  for (const f of files) {
    if (path.basename(f).startsWith(name)) continue; // the file itself
    const src = readFileSync(f, "utf8");
    if (src.includes(name)) refs.push(f);
  }
  console.log(refs.length
    ? `LIVE: ${name} referenced in:\n` + refs.join("\n")
    : `DEAD: ${name} — zero references. Safe to delete; write the decision record.`);

  // CSS orphan diff (review manually — dynamic classes can false-positive)
  const cssFiles = files.filter((f) => f.endsWith(".css") || f.endsWith(".html"));
  const selectors = new Set(), used = new Set();
  for (const f of cssFiles) {
    const src = readFileSync(f, "utf8");
    const styleBlocks = f.endsWith(".css") ? [src]
      : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
    for (const css of styleBlocks)
      for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) selectors.add(m[1]);
  }
  for (const f of files.filter((x) => !x.endsWith(".css"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/class\s*=\s*["']([^"']+)["']|classList\.\w+\(\s*["']([\w-]+)["']/g))
      (m[1] || m[2]).split(/\s+/).forEach((c) => used.add(c));
  }
  const orphans = [...selectors].filter((s) => !used.has(s));
  if (orphans.length) console.log("\nCSS orphan candidates (review before deleting):\n" + orphans.join(", "));
}

/* ---------- --bundle / --verify ---------- */
function buildBundle() {
  const parts = CONFIG.manifest.map((m) => {
    const p = path.join(CONFIG.srcDir, m);
    if (!existsSync(p)) die("manifest entry missing: " + p);
    const src = norm(readFileSync(p, "utf8"));
    if (!/\(function\s*\(root,\s*factory\)|\(function\s*\(\)\s*\{/.test(src))
      console.warn(`WARN: ${m} does not look UMD/IIFE-wrapped — see module-wrapper-template.js`);
    return `/* ===== module: ${m} ===== */\n` + src;
  });
  const body = parts.join("\n\n");
  const cssText = (CONFIG.css || []).map((c) => {
    const p = path.join(CONFIG.srcDir, c);
    if (!existsSync(p)) die("css entry missing: " + p);
    return `/* ===== css: ${c} ===== */\n` + norm(readFileSync(p, "utf8"));
  }).join("\n");
  const kernelSrc = CONFIG.kernel ? norm(readFileSync(CONFIG.kernel, "utf8")) : "";
  const hash = sha256(body + "\n/* WF-CSS */\n" + cssText + "\n/* WF-KERNEL */\n" + kernelSrc);
  return { bundle: `/* WF-BUNDLE-HASH sha256:${hash} */\n"use strict";\n` + body, hash, cssText, kernelSrc };
}

if (cmd === "--bundle") {
  const { bundle, hash, cssText, kernelSrc } = buildBundle();
  const shell = norm(readFileSync(CONFIG.shell, "utf8"));
  const re = /(<!--\s*WF:BUNDLE:BEGIN\s*-->)[\s\S]*?(<!--\s*WF:BUNDLE:END\s*-->)/;
  if (!re.test(shell)) die(CONFIG.shell + " missing WF:BUNDLE markers");
  const cssRe = /(<!--\s*WF:CSS:BEGIN\s*-->)[\s\S]*?(<!--\s*WF:CSS:END\s*-->)/;
  if (cssText && !cssRe.test(shell)) die(CONFIG.shell + " missing WF:CSS markers");
  const kernelRe = /(<!--\s*WF:KERNEL:BEGIN\s*-->)[\s\S]*?(<!--\s*WF:KERNEL:END\s*-->)/;
  if (kernelSrc && !kernelRe.test(shell)) die(CONFIG.shell + " missing WF:KERNEL markers");
  // Function replacer: replacement STRINGS interpret $-patterns ($&, $1…),
  // and bundled source may legitimately contain them. Never splice with a string.
  let out = shell.replace(re, (m, open, close) => `${open}\n<script>\n${bundle}\n</script>\n${close}`);
  if (cssText) out = out.replace(cssRe, (m, open, close) => `${open}\n<style>\n${cssText}\n</style>\n${close}`);
  if (kernelSrc) out = out.replace(kernelRe, (m, open, close) => `${open}\n<script>\n${kernelSrc}\n</script>\n${close}`);
  writeFileSync(CONFIG.out, out);
  ok(`built ${CONFIG.out} · bundle sha256:${hash.slice(0, 16)}…`);
}

if (cmd === "--verify") {
  const { hash } = buildBundle();
  const built = norm(readFileSync(CONFIG.out, "utf8"));
  const m = built.match(/WF-BUNDLE-HASH sha256:([a-f0-9]{64})/);
  if (!m) die("no embedded hash in " + CONFIG.out);
  m[1] === hash
    ? ok("bundle fresh — embedded hash matches rebuild")
    : die(`bundle STALE — embedded ${m[1].slice(0, 12)}… vs rebuilt ${hash.slice(0, 12)}… Run --bundle.`);
}

if (!cmd) console.log("commands: --inventory <html> | --xrefs <dir> | --gate | --deadcheck <name> | --bundle | --verify");
