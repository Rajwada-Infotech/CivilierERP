/**
 * seedProjectNetwork.js — demo data for Home › Project Network: 10 more companies and
 * 15 more projects, several of them tagged to more than one company.
 *
 *   node scripts/seedProjectNetwork.js --dry-run   print the plan, touch nothing
 *   node scripts/seedProjectNetwork.js             create it
 *
 * It drives the REAL company-master / project-master routes (in-process, as a super
 * admin), so each project also gets its godown, ledger heads and company tags exactly
 * as if it had been entered on screen. Re-running is safe: anything whose name already
 * exists is skipped. Every row carries remarks "Seed: project network demo" so the demo
 * data can be told apart (and deleted from Company / Project Master) later.
 */
"use strict";

require("dotenv").config();
const express = require("express");
const request = require("supertest");

const DRY = process.argv.includes("--dry-run");
const MARK = "Seed: project network demo";
const GROUP_ENTERPRISE_ID = 1; // the group row every existing company hangs off

// ── 10 companies ─────────────────────────────────────────────────────────────
// gst: [stateCode, panLetters+digits] → GSTIN is built so it matches the app's format check.
const COMPANIES = [
  { name: "Orchid Realty Pvt Ltd",        short: "ORCH", code: "ORCH", city: "Kolkata",   state: "West Bengal",  pin: "700091", gst: ["19", "AAACO1101A"] },
  { name: "Meridian Infra Developers",    short: "MRDN", code: "MRDN", city: "Mumbai",    state: "Maharashtra",  pin: "400051", gst: ["27", "AAACM2202B"] },
  { name: "Banyan Housing Ltd",           short: "BNYN", code: "BNYN", city: "Bengaluru", state: "Karnataka",    pin: "560034", gst: ["29", "AAACB3303C"] },
  { name: "Sunrise Urban Habitats",       short: "SNRS", code: "SNRS", city: "Kolkata",   state: "West Bengal",  pin: "700156" },
  { name: "Lakeview Constructions",       short: "LKVW", code: "LKVW", city: "Hyderabad", state: "Telangana",    pin: "500081", gst: ["36", "AAACL4404D"] },
  { name: "Cedar Grove Estates",          short: "CDRG", code: "CDRG", city: "Pune",      state: "Maharashtra",  pin: "411045" },
  { name: "Horizon Landmarks Pvt Ltd",    short: "HRZN", code: "HRZN", city: "Ahmedabad", state: "Gujarat",      pin: "380054", gst: ["24", "AAACH5505E"] },
  { name: "Silverline Projects",          short: "SLVL", code: "SLVL", city: "Chennai",   state: "Tamil Nadu",   pin: "600096", gst: ["33", "AAACS6606F"] },
  { name: "Harbour Point Developers",     short: "HRBP", code: "HRBP", city: "Kolkata",   state: "West Bengal",  pin: "700107" },
  { name: "Evergreen Township Co",        short: "EVGR", code: "EVGR", city: "Delhi",     state: "Delhi",        pin: "110017", gst: ["07", "AAACE7707G"] },
];

// ── 15 projects ──────────────────────────────────────────────────────────────
// owner / co: company NAMES (new ones above, or existing ones already in the master).
// type: entity_type; pt: ProjectTypeMaster id; active=false → shows under "Dormant".
const PROJECTS = [
  { name: "Orchid Heights",        short: "ORCHH", owner: "Orchid Realty Pvt Ltd",     co: ["Meridian Infra Developers"],                          type: "Construction",      pt: 1, team: 42 },
  { name: "Meridian Skyline",      short: "MRSKY", owner: "Meridian Infra Developers", co: ["Orchid Realty Pvt Ltd", "Horizon Landmarks Pvt Ltd"], type: "Construction",      pt: 1, team: 65 },
  { name: "Banyan Gardens",        short: "BNGRD", owner: "Banyan Housing Ltd",        co: [],                                                     type: "UnderConstruction", pt: 4, team: 28 },
  { name: "Sunrise Enclave",       short: "SNENC", owner: "Sunrise Urban Habitats",    co: ["Harbour Point Developers"],                           type: "Construction",      pt: 2, team: 31 },
  { name: "Lakeview Residency",    short: "LKRES", owner: "Lakeview Constructions",    co: [],                                                     type: "ReadyToMove",       pt: 2, team: 12 },
  { name: "Cedar Court",           short: "CDRCT", owner: "Cedar Grove Estates",       co: ["Banyan Housing Ltd"],                                 type: "Construction",      pt: 7, team: 24 },
  { name: "Horizon Business Park", short: "HRZBP", owner: "Horizon Landmarks Pvt Ltd", co: ["Evergreen Township Co", "Silverline Projects"],       type: "Construction",      pt: 8, team: 51 },
  { name: "Silverline Towers",     short: "SLTWR", owner: "Silverline Projects",       co: [],                                                     type: "UnderConstruction", pt: 1, team: 38 },
  { name: "Harbour View",          short: "HRBVW", owner: "Harbour Point Developers",  co: ["Sunrise Urban Habitats", "Orchid Realty Pvt Ltd"],    type: "Construction",      pt: 5, team: 47 },
  { name: "Evergreen Township",    short: "EVGTW", owner: "Evergreen Township Co",     co: ["Horizon Landmarks Pvt Ltd"],                          type: "Construction",      pt: 5, team: 90 },
  { name: "Delta Square",          short: "DLTSQ", owner: "Delta 1",                   co: ["Meridian Infra Developers"],                          type: "Construction",      pt: 7, team: 18 },
  { name: "Rajwada Greens",        short: "RJWGR", owner: "Rajwada",                   co: ["Lakeview Constructions", "Cedar Grove Estates"],      type: "UnderConstruction", pt: 3, team: 22 },
  { name: "Test Plaza",            short: "TSTPL", owner: "TEST RAJWADA",              co: ["ABC TEST COMPANY"],                                   type: "Construction",      pt: 8, team: 9,  active: false },
  { name: "Abc Meadows",           short: "ABCMD", owner: "ABC TEST COMPANY",          co: [],                                                     type: "ReadyToMove",       pt: 3, team: 14, active: false },
  { name: "Group Central",         short: "GRPCN", owner: "RAJWADA GROUP",             co: ["Orchid Realty Pvt Ltd", "Banyan Housing Ltd", "Delta 1"], type: "Construction",  pt: 7, team: 33, active: false },
];

const gstin = ([state, pan]) => `${state}${pan}1Z5`; // 2 digits + PAN(10) + entity "1" + "Z" + check "5"

function companyBody(c) {
  const registered = !!c.gst;
  return {
    name: c.name, shortName: c.short, code: c.code, type: "Private Limited", legalName: c.name,
    gstType: registered ? "Registered" : "Unregistered",
    ...(registered ? { gstNumber: gstin(c.gst), gstDate: "2020-04-01", panNumber: c.gst[1] } : {}),
    registeredAddress: `${c.city}, ${c.state}`, city: c.city, state: c.state, country: "India", pincode: c.pin,
    currency: "INR", belongsTo: String(GROUP_ENTERPRISE_ID), isActive: true, remarks: MARK,
  };
}

function projectBody(p, ids, i) {
  const coIds = p.co.map((n) => ids.get(n.toLowerCase())).filter(Boolean);
  return {
    name: p.name, shortName: p.short, code: p.short, type: p.type, projectTypeId: p.pt,
    companyId: String(ids.get(p.owner.toLowerCase())), enterpriseId: String(GROUP_ENTERPRISE_ID),
    status: "Planning", currency: "INR", teamSize: String(p.team),
    startDate: `2026-0${(i % 9) + 1}-01`, addressLine1: `${p.name} Site`, zipCode: "700001",
    isActive: p.active !== false, remarks: MARK,
    multiCompanyEnabled: coIds.length > 0, multiCompanyIds: coIds,
  };
}

async function main() {
  if (DRY) {
    console.log(`DRY RUN — would create ${COMPANIES.length} companies and ${PROJECTS.length} projects:\n`);
    COMPANIES.forEach((c) => console.log(`  company  ${c.name}  (${c.gst ? "GST " + gstin(c.gst) : "unregistered"})`));
    console.log("");
    PROJECTS.forEach((p) => console.log(`  project  ${p.name}  ← ${p.owner}${p.co.length ? "  + " + p.co.join(", ") : ""}${p.active === false ? "  [dormant]" : ""}`));
    const multi = PROJECTS.filter((p) => p.co.length).length;
    console.log(`\n${multi} of ${PROJECTS.length} projects are tagged to more than one company.`);
    return;
  }

  const { connectDB, getPool, sql } = require("../db");
  await connectDB();
  const pool = getPool();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { userId: 1, id: 1, role: "super_admin", name: "seed", email: "seed@civilier.local" }; next(); });
  app.use("/api/company-master", require("../routes/companyMaster"));
  app.use("/api/project-master", require("../routes/projectMaster"));

  const existing = async (type) =>
    (await pool.request().input("t", sql.NVarChar(10), type)
      .query("SELECT id, name FROM dbo.enterprise WHERE business_type = @t")).recordset;

  // company name (lower) → id, for new and pre-existing companies alike
  const ids = new Map((await existing("C")).map((r) => [String(r.name).trim().toLowerCase(), r.id]));
  let made = { companies: 0, projects: 0, skipped: 0 };

  for (const c of COMPANIES) {
    if (ids.has(c.name.toLowerCase())) { made.skipped++; console.log(`skip   company ${c.name} (exists)`); continue; }
    const res = await request(app).post("/api/company-master").send(companyBody(c));
    if (res.status >= 300) throw new Error(`company "${c.name}" → ${res.status} ${JSON.stringify(res.body)}`);
    const row = (await existing("C")).find((r) => String(r.name).trim().toLowerCase() === c.name.toLowerCase());
    ids.set(c.name.toLowerCase(), row.id);
    made.companies++;
    console.log(`+ company ${c.name} (#${row.id})`);
  }

  const projectNames = new Set((await existing("P")).map((r) => String(r.name).trim().toLowerCase()));
  for (const [i, p] of PROJECTS.entries()) {
    if (projectNames.has(p.name.toLowerCase())) { made.skipped++; console.log(`skip   project ${p.name} (exists)`); continue; }
    for (const n of [p.owner, ...p.co]) if (!ids.has(n.toLowerCase())) throw new Error(`project "${p.name}": company "${n}" not found`);
    const res = await request(app).post("/api/project-master").send(projectBody(p, ids, i));
    if (res.status >= 300) throw new Error(`project "${p.name}" → ${res.status} ${JSON.stringify(res.body)}`);
    made.projects++;
    console.log(`+ project ${p.name}${p.co.length ? `  (+${p.co.length} co-owner${p.co.length > 1 ? "s" : ""})` : ""}`);
  }

  const tags = (await pool.request().query("SELECT COUNT(*) n, COUNT(DISTINCT ProjectId) p FROM dbo.ProjectCompanies")).recordset[0];
  console.log(`\nDone: ${made.companies} companies, ${made.projects} projects created, ${made.skipped} skipped.`);
  console.log(`ProjectCompanies now holds ${tags.n} tags across ${tags.p} projects.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
