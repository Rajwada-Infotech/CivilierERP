// Read-only diagnostic for the FA Inventory import ("Project X not found under Company Y" and friends).
//
// It reads the workbook the same way the importer does (the "FA Inventory" sheet, same column aliases), then for every
// distinct Company / Project / Godown combination it repeats the importer's lookups against the database and says which
// step fails and WHY — wrong company id on the project, a project only TAGGED to the company, a name that differs by
// invisible characters, a soft-deleted record, or a name that doesn't exist at all. It writes nothing.
//
// Usage:  node backend/scripts/checkFaImportMapping.js "C:\Users\you\Downloads\FA.xlsx"

const fs = require("fs");
const path = require("path");

function loadFflate() {
  for (const p of ["fflate", path.join(__dirname, "../../node_modules/fflate")]) {
    try {
      return require(p);
    } catch {
      /* try next */
    }
  }
  throw new Error('The "fflate" package is needed to read .xlsx files (it is in the repo root node_modules — run npm install there).');
}

// ── .xlsx reading (no DOM here, so a small regex reader) ─────────────────────
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref) => {
  const letters = (ref.match(/^[A-Z]+/i) || [""])[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function readWorkbook(file) {
  const { unzipSync, strFromU8 } = loadFflate();
  const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const read = (p) => (files[p] ? strFromU8(files[p]) : null);
  const wb = read("xl/workbook.xml");
  if (!wb) throw new Error("Not a valid .xlsx workbook.");
  const rels = new Map();
  for (const m of (read("xl/_rels/workbook.xml.rels") || "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]*)"/) || [])[1];
    const target = (m[0].match(/\bTarget="([^"]*)"/) || [])[1];
    if (id) rels.set(id, target);
  }
  const shared = [...(read("xl/sharedStrings.xml") || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const book = {};
  for (const sh of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode((sh[0].match(/\bname="([^"]*)"/) || [])[1] || "");
    const rid = (sh[0].match(/\br:id="([^"]*)"/) || [])[1];
    let target = rels.get(rid);
    if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = read(target);
    if (!xml) continue;
    const rows = [];
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rIdx = (parseInt((row[1].match(/\br="(\d+)"/) || [])[1], 10) || rows.length + 1) - 1;
      const cells = [];
      for (const c of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ci = colIndex((c[1].match(/\br="([^"]*)"/) || [])[1] || "");
        if (ci < 0) continue;
        const t = (c[1].match(/\bt="([^"]*)"/) || [])[1];
        const inner = c[2] || "";
        let val = "";
        if (t === "s") val = shared[parseInt((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1], 10)] ?? "";
        else if (t === "inlineStr") val = textOf(inner);
        else val = decode((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || "");
        cells[ci] = val;
      }
      while (rows.length < rIdx) rows.push([]);
      rows[rIdx] = Array.from(cells, (v) => v ?? "");
    }
    book[name] = rows;
  }
  return book;
}

// ── the importer's own column rules (src/pages/fixedAsset/faInventoryExcel.ts) ──
const key = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SHEET = "FA Inventory";
const ALIASES = {
  Company: ["company"],
  Project: ["project"],
  Godown: ["godown", "store", "warehouse"],
};

function readInventoryRows(file) {
  const book = readWorkbook(file);
  const names = Object.keys(book);
  const name =
    names.find((n) => key(n) === key(SHEET)) ??
    names.find((n) => key(n) !== "instructions" && key(n) !== "masters" && (book[n] || []).length > 0);
  if (!name) throw new Error(`No "${SHEET}" sheet found (sheets: ${names.join(", ")}).`);
  const grid = book[name];
  const hdrIdx = grid.findIndex((r) => (r || []).some((c) => key(c) !== ""));
  if (hdrIdx === -1) return { sheet: name, rows: [] };
  const col = {};
  grid[hdrIdx].forEach((h, ci) => {
    for (const [field, aliases] of Object.entries(ALIASES)) if (col[field] === undefined && aliases.includes(key(h))) col[field] = ci;
  });
  const rows = [];
  for (let r = hdrIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const get = (f) => (col[f] === undefined ? "" : String(row[col[f]] ?? "").trim());
    rows.push({ rowNo: r + 1, Company: get("Company"), Project: get("Project"), Godown: get("Godown") });
  }
  return { sheet: name, header: grid[hdrIdx], rows };
}

// ── helpers ────────────────────────────────────────────────────────────────────
const lc = (s) => String(s ?? "").toLowerCase();
// Same words, ignoring case, spacing and punctuation: finds "RG  Office", "R.G. office", NBSP, etc.
const loose = (s) => lc(s).replace(/[^a-z0-9]/g, "");
// Shows invisible differences: non-ASCII or doubled / edge spaces.
const reveal = (s) =>
  JSON.stringify(String(s ?? "")).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node backend/scripts/checkFaImportMapping.js "<path to FA.xlsx>"');
    process.exit(1);
  }
  const { connectDB, getPool, closeDB } = require("../db");

  const { sheet, header, rows } = readInventoryRows(file);
  console.log(`\nFile: ${file}\nSheet: "${sheet}"   header: ${JSON.stringify(header)}   data rows: ${rows.length}`);
  if (!rows.length) return;

  await connectDB();
  const pool = getPool();
  const q = async (text) => (await pool.request().query(text)).recordset;

  const enterprises = await q(`
    SELECT e.id, e.name, e.business_type, e.company_id, e.belongs_to, e.discontinue,
           (SELECT STRING_AGG(CAST(pc.CompanyId AS NVARCHAR(20)), ',') FROM dbo.ProjectCompanies pc WHERE pc.ProjectId = e.id) AS tagged
    FROM dbo.enterprise e`);
  const companies = enterprises.filter((e) => e.business_type === "C");
  const projects = enterprises.filter((e) => e.business_type === "P");
  const nameOf = (id) => enterprises.find((e) => e.id === id)?.name ?? "(none)";
  const liveCompanies = companies.filter((c) => !c.discontinue);
  const liveProjects = projects.filter((p) => !p.discontinue);
  const godowns = await q("SELECT GodownID, GodownName, EnterpriseID, ProjectID, IsDeleted, IsActive FROM dbo.Godowns");

  const describeProject = (p) =>
    `id ${p.id} "${p.name}" | company_id ${p.company_id} (${nameOf(p.company_id)}) | belongs_to ${p.belongs_to ?? "—"} | tagged companies ${
      p.tagged ? p.tagged.split(",").map((i) => `${i} (${nameOf(Number(i))})`).join(", ") : "—"
    }${p.discontinue ? " | DISCONTINUED" : ""}`;

  // distinct combinations, with the rows they appear on
  const combos = new Map();
  for (const r of rows) {
    const k = `${r.Company}\u0001${r.Project}\u0001${r.Godown}`;
    if (!combos.has(k)) combos.set(k, { ...r, rowNos: [] });
    combos.get(k).rowNos.push(r.rowNo);
  }
  console.log(`Distinct Company / Project / Godown combinations: ${combos.size}\n`);

  let failures = 0;
  for (const c of combos.values()) {
    const where = `rows ${c.rowNos.length > 6 ? `${c.rowNos.slice(0, 6).join(", ")} … (${c.rowNos.length})` : c.rowNos.join(", ")}`;
    const head = `${c.Company} › ${c.Project} › ${c.Godown}   [${where}]`;

    // 1. company — exactly what the importer does (case-insensitive name; the UI list has no discontinued ones)
    const company = liveCompanies.find((x) => lc(x.name) === lc(c.Company));
    if (!company) {
      failures++;
      console.log(`✗ ${head}\n    COMPANY "${c.Company}" not found. In the sheet: ${reveal(c.Company)}`);
      const near = companies.filter((x) => loose(x.name) === loose(c.Company) || lc(x.name).includes(lc(c.Company)) || lc(c.Company).includes(lc(x.name)));
      near.forEach((x) => console.log(`    closest: id ${x.id} ${reveal(x.name)}${x.discontinue ? " (DISCONTINUED)" : ""}`));
      continue;
    }

    // 2. project of that company — the importer requires project.company_id === company.id
    const project = liveProjects.find((p) => p.company_id === company.id && lc(p.name) === lc(c.Project));
    if (!project) {
      failures++;
      console.log(`✗ ${head}\n    PROJECT "${c.Project}" not found under ${company.name} (company id ${company.id}). In the sheet: ${reveal(c.Project)}`);
      const sameName = projects.filter((p) => lc(p.name) === lc(c.Project));
      const looseName = projects.filter((p) => loose(p.name) === loose(c.Project) && lc(p.name) !== lc(c.Project));
      if (sameName.length) {
        console.log("    Projects with exactly that name:");
        for (const p of sameName) {
          console.log(`      - ${describeProject(p)}`);
          const tagged = (p.tagged || "").split(",").includes(String(company.id));
          if (p.discontinue) console.log("        → this project is DISCONTINUED, so the import's project list never contains it.");
          else if (p.company_id !== company.id && tagged)
            console.log(`        → CAUSE: the project is owned by company ${p.company_id} (${nameOf(p.company_id)}) and only TAGGED to ${company.name}. The import compares company_id only, but every dropdown (and the server's options route) also accepts tagged companies.`);
          else if (p.company_id !== company.id)
            console.log(`        → CAUSE: the project belongs to ${nameOf(p.company_id)}, not ${company.name}. Use that company in the sheet, or tag the project to ${company.name}.`);
        }
      }
      if (looseName.length) {
        console.log("    Projects whose name differs only by case / spacing / punctuation / hidden characters:");
        looseName.forEach((p) => console.log(`      - ${describeProject(p)}   name as stored: ${reveal(p.name)}`));
      }
      if (!sameName.length && !looseName.length) {
        console.log(`    No project called anything like that exists. Projects of ${company.name}:`);
        liveProjects.filter((p) => p.company_id === company.id).forEach((p) => console.log(`      - id ${p.id} ${reveal(p.name)}`));
      }
      continue;
    }

    // 3. godown of that company (and this project, or company-wide)
    const godown = godowns.find(
      (g) => !g.IsDeleted && g.IsActive && g.EnterpriseID === company.id && (g.ProjectID === project.id || g.ProjectID == null) && lc(g.GodownName) === lc(c.Godown),
    );
    if (!godown) {
      failures++;
      console.log(`✗ ${head}\n    GODOWN "${c.Godown}" not found for company ${company.name} / project ${project.name}. In the sheet: ${reveal(c.Godown)}`);
      const named = godowns.filter((g) => loose(g.GodownName) === loose(c.Godown));
      if (named.length) {
        named.forEach((g) =>
          console.log(
            `      - id ${g.GodownID} ${reveal(g.GodownName)} | company ${g.EnterpriseID} (${nameOf(g.EnterpriseID)}) | project ${g.ProjectID ?? "—"} (${g.ProjectID ? nameOf(g.ProjectID) : "company-wide"}) | ${g.IsDeleted ? "DELETED" : g.IsActive ? "active" : "INACTIVE"}`,
          ),
        );
      } else console.log("      No godown with that name exists.");
      continue;
    }
    console.log(`✓ ${head}\n    company ${company.id} · project ${project.id} · godown ${godown.GodownID}`);
  }

  console.log(`\n${failures === 0 ? "Every Company / Project / Godown in the file maps to an id." : `${failures} combination(s) do not map — see the lines marked ✗ above.`}\n`);
  await closeDB();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
