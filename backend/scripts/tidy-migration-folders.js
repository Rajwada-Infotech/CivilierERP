// Puts every numbered migration in its 20-number folder (001-020, 021-040 …), creating folders as needed, and prints
// the next free number. Files are moved, never renamed: migrate.js records each migration by file name only (umzug
// basename), and the deploy runs every migration, so a renamed file would run again on production.
//   node scripts/tidy-migration-folders.js            preview
//   APPLY=1 node scripts/tidy-migration-folders.js    move (git mv, so history follows)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DIR = path.join(__dirname, "..", "migrations");
const apply = process.env.APPLY === "1";
const bucket = (n) => {
  const lo = Math.floor((n - 1) / 20) * 20 + 1;
  return `${String(lo).padStart(3, "0")}-${String(lo + 19).padStart(3, "0")}`;
};

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "seeds") walk(p); }
    else if (e.name.endsWith(".sql")) files.push(p);
  }
})(DIR);

const moves = [];
const byNumber = new Map();
let max = 0;
for (const f of files) {
  const m = path.basename(f).match(/^(\d+)/);
  if (!m) continue; // un-numbered files stay where they are
  const n = parseInt(m[1], 10);
  max = Math.max(max, n);
  byNumber.set(n, [...(byNumber.get(n) || []), path.relative(DIR, f)]);
  const want = path.join(DIR, bucket(n), path.basename(f));
  if (path.resolve(f) !== path.resolve(want)) moves.push([f, want]);
}

console.log(`${files.length} migration files, ${moves.length} in the wrong folder.`);
for (const [from, to] of moves) {
  console.log(`  ${path.relative(DIR, from).padEnd(70)} -> ${path.relative(DIR, to)}`);
  if (apply) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    execFileSync("git", ["mv", from, to], { cwd: DIR });
  }
}
const dupes = [...byNumber].filter(([, list]) => list.length > 1);
console.log(`\n${dupes.length} numbers are used by more than one file (left as they are: renaming would re-run them).`);
console.log(`Next free number: ${String(max + 1).padStart(3, "0")}  ->  migrations/${bucket(max + 1)}/`);
if (!apply && moves.length) console.log("\nPreview only. APPLY=1 to move.");
