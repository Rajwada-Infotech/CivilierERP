// One-off, NO-DB static scan: walks the frontend (../src) and backend
// (./routes) source trees for every page key actually referenced in code —
// usePageRights("...")/pageKey="..." in the frontend, requirePageRight("...")
// in the backend — and writes the deduplicated, sorted result to
// scripts/data/used-page-keys.txt.
//
// This file is checked into the repo (regenerate and commit it whenever
// pages are added/removed) so findOrphanedPageDefinitions.js can compare
// against it without needing the frontend source tree present at runtime —
// the production backend container only ever has backend/ copied in
// (see backend/Dockerfile), not the frontend, so this two-step split is
// necessary: run this script locally (full repo checked out) to refresh
// the list, then findOrphanedPageDefinitions.js can run anywhere that has
// this repo's backend/ and a DB connection, including inside the
// production container.
//
// Usage: node scripts/scanUsedPageKeys.js   (run from backend/, full repo checked out)
const fs = require("fs");
const path = require("path");

const FRONTEND_SRC = path.join(__dirname, "..", "..", "src");
const BACKEND_ROUTES = path.join(__dirname, "..", "routes");
const OUTPUT_FILE = path.join(__dirname, "data", "used-page-keys.txt");

function walk(dir, exts, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, exts, onFile);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      onFile(full);
    }
  }
}

const keys = new Set();

if (fs.existsSync(FRONTEND_SRC)) {
  walk(FRONTEND_SRC, [".tsx", ".ts"], (file) => {
    const content = fs.readFileSync(file, "utf8");
    let m;
    const reUsePageRights = /usePageRights\(\s*["']([^"']+)["']/g;
    while ((m = reUsePageRights.exec(content)) !== null) keys.add(m[1]);
    const rePageKeyProp = /pageKey=["']([^"']+)["']/g;
    while ((m = rePageKeyProp.exec(content)) !== null) keys.add(m[1]);
  });
} else {
  console.error(`WARNING: frontend source not found at ${FRONTEND_SRC} — skipping frontend scan.`);
  console.error("Run this script from a full repo checkout (not the production container) to include frontend usage.");
}

if (fs.existsSync(BACKEND_ROUTES)) {
  walk(BACKEND_ROUTES, [".js"], (file) => {
    const content = fs.readFileSync(file, "utf8");
    let m;
    const reRequirePageRight = /requirePageRight\(\s*["']([^"']+)["']/g;
    while ((m = reRequirePageRight.exec(content)) !== null) keys.add(m[1]);
  });
}

const sorted = [...keys].sort();
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, sorted.join("\n") + "\n");

console.log(`Wrote ${sorted.length} used page keys to ${OUTPUT_FILE}`);
