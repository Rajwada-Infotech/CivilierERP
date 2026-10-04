// Adds missing master rows from a spec — unit kinds and project types — the
// same rows the Unit kinds / Project Type Master screens would save. Values
// come only from the spec; existing rows (matched by Code) are never changed.
//
//   node scripts/seedMasters.js --spec scripts/masters.json          # dry run
//   node scripts/seedMasters.js --spec scripts/masters.json --apply
//
// Spec: { "unitKinds":    [ { "Code": "SHOP", "Name": "Shop", "IsCommercial": true } ],
//         "projectTypes": [ { "Code": "MIXED_USE", "Name": "...", "HasFloors": true, ... } ] }

const fs = require("fs");
const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const bit = (v) => (v ? 1 : 0);

async function main() {
  const spec = JSON.parse(fs.readFileSync(arg("--spec"), "utf8"));
  await connectDB();
  const pool = getPool();
  const totals = { kindsAdded: 0, typesAdded: 0, alreadyThere: 0 };

  for (const k of spec.unitKinds || []) {
    const code = String(k.Code).trim().toUpperCase();
    const have = await pool.request().input("c", sql.NVarChar(20), code).query("SELECT Id, Name, IsActive, IsCommercial FROM dbo.CrmConstructedAssetKind WHERE Code = @c");
    if (have.recordset.length) { console.log(`   = unit kind ${code} already exists (${JSON.stringify(have.recordset[0])}) — left as is`); totals.alreadyThere++; continue; }
    if (k.IsLand && k.IsCommercial) throw new Error(`${code}: a kind can't be land and commercial`);
    if (APPLY) {
      await pool.request().input("c", sql.NVarChar(20), code).input("n", sql.NVarChar(100), k.Name)
        .input("s", sql.Int, k.SortOrder ?? 100).input("l", sql.Bit, bit(k.IsLand)).input("m", sql.Bit, bit(k.IsCommercial))
        .query("INSERT INTO dbo.CrmConstructedAssetKind (Code, Name, SortOrder, IsLand, IsCommercial, IsActive, CreatedAt) VALUES (@c, @n, @s, @l, @m, 1, SYSDATETIME())");
    }
    console.log(`   + unit kind ${code} "${k.Name}"${k.IsCommercial ? " [commercial]" : ""}${k.IsLand ? " [land]" : ""}`);
    totals.kindsAdded++;
  }

  for (const t of spec.projectTypes || []) {
    const code = String(t.Code).trim().toUpperCase();
    const have = await pool.request().input("c", sql.NVarChar(30), code).query("SELECT Id, Name FROM dbo.ProjectTypeMaster WHERE Code = @c AND IsActive = 1");
    if (have.recordset.length) { console.log(`   = project type ${code} already exists ("${have.recordset[0].Name}") — left as is`); totals.alreadyThere++; continue; }
    if (APPLY) {
      await pool.request().input("c", sql.NVarChar(30), code).input("n", sql.NVarChar(100), t.Name).input("d", sql.NVarChar(300), t.Description || null)
        .input("f", sql.Bit, bit(t.HasFloors)).input("l", sql.Bit, bit(t.SellsLand)).input("k", sql.Bit, bit(t.SellsConstruction))
        .input("m", sql.Bit, bit(t.AllowsMultiUnitSale)).input("r", sql.Bit, bit(t.SellsResidential)).input("o", sql.Bit, bit(t.SellsCommercial))
        .input("s", sql.Int, t.SortOrder ?? 100)
        .query(`INSERT INTO dbo.ProjectTypeMaster (Code, Name, Description, HasFloors, SellsLand, SellsConstruction, AllowsMultiUnitSale, SellsResidential, SellsCommercial, SortOrder, IsActive)
                VALUES (@c, @n, @d, @f, @l, @k, @m, @r, @o, @s, 1)`);
    }
    const flags = ["HasFloors", "SellsLand", "SellsConstruction", "SellsResidential", "SellsCommercial", "AllowsMultiUnitSale"].filter((f) => t[f]).join(", ");
    console.log(`   + project type ${code} "${t.Name}" — ${flags}`);
    totals.typesAdded++;
  }

  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("seedMasters failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
