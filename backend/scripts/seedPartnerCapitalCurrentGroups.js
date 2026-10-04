// Idempotent get-or-create for the two AccountGroup rows Partner Master
// requires (backend/routes/partnerMaster.js's getPartnerGroups resolves
// them by Code, not Name): LIABILITIES > Capital Account (CAPA, parent
// shell) > Capital Account (CAPA0, leaf — the actual postable group), and
// CURRENT ASSETS > Current Account (CURAC).
//
// Matches production's real structure (confirmed via screenshot earlier
// this session) — this script is meant for an environment (e.g. a fresh
// dev DB) that doesn't have them yet; production already has this
// structure and running this against it should just no-op (get, not
// create) rather than duplicate anything.
//
// Usage: node scripts/seedPartnerCapitalCurrentGroups.js
const { connectDB, getPool, closeDB, sql } = require("../db");

async function getOrCreateGroup(pool, { name, code, parentId }) {
  const existing = await pool.request().input("code", sql.NVarChar(20), code)
    .query(`SELECT AGId, Name, ParentGroupId FROM dbo.AccountGroup WHERE Code = @code`);
  if (existing.recordset.length) {
    const g = existing.recordset[0];
    console.log(`  Found: ${g.Name} (Code=${code}, AGId=${g.AGId}, ParentGroupId=${g.ParentGroupId})`);
    return g.AGId;
  }
  const inserted = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .input("Code", sql.NVarChar(20), code)
    .input("ParentGroupId", sql.Int, parentId).query(`
      INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId)
      OUTPUT INSERTED.AGId
      VALUES (@Name, @Code, @ParentGroupId)
    `);
  const id = inserted.recordset[0].AGId;
  console.log(`  Created: ${name} (Code=${code}, AGId=${id}, ParentGroupId=${parentId})`);
  return id;
}

async function findRootByName(pool, name) {
  const res = await pool.request().input("name", sql.NVarChar(200), name)
    .query(`SELECT AGId FROM dbo.AccountGroup WHERE Name = @name AND ParentGroupId IS NULL`);
  const id = res.recordset[0]?.AGId ?? null;
  if (!id) throw new Error(`Root group "${name}" not found — this environment's chart of accounts isn't seeded yet.`);
  return id;
}

async function main() {
  await connectDB();
  const pool = getPool();

  console.log("Resolving root groups...");
  const liabilitiesId = await findRootByName(pool, "LIABILITIES");
  const currentAssetsId = await findRootByName(pool, "CURRENT ASSETS");
  console.log(`  LIABILITIES root AGId=${liabilitiesId}`);
  console.log(`  CURRENT ASSETS root AGId=${currentAssetsId}\n`);

  console.log("Capital Account (parent shell under LIABILITIES):");
  const capaParentId = await getOrCreateGroup(pool, { name: "Capital Account", code: "CAPA", parentId: liabilitiesId });

  console.log("Capital Account (leaf, postable — CAPA0):");
  await getOrCreateGroup(pool, { name: "Capital Account", code: "CAPA0", parentId: capaParentId });

  console.log("Current Account (under CURRENT ASSETS — CURAC):");
  await getOrCreateGroup(pool, { name: "Current Account", code: "CURAC", parentId: currentAssetsId });

  console.log("\nDone. Partner Master can now create Capital/Current heads on this environment.");
  await closeDB();
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
