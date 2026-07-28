require("dotenv").config();
const jwt = require("jsonwebtoken");
const { connectDB, getPool, sql } = require("./db");

const API = "http://localhost:5000/api/crm/project-auto-setup";
const token = jwt.sign(
  { userId: 1, roleId: null, role: "super_admin", email: "test@test.local", name: "Test Runner" },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
function assert(cond, msg) { if (!cond) throw new Error("ASSERTION FAILED: " + msg); }

async function main() {
  await connectDB();
  const pool = getPool();

  const proj = await pool.request()
    .input("name", sql.NVarChar(200), "ZZ Unit Template Test")
    .input("short", sql.NVarChar(100), "ZZU")
    .query(`INSERT INTO dbo.enterprise (name, short_name, business_type, entity_type, discontinue, date_of_entry)
      OUTPUT INSERTED.id VALUES (@name, @short, 'P', 'Project', 0, CAST(SYSDATETIME() AS DATE))`);
  const projectId = proj.recordset[0].id;
  console.log("Created", projectId);

  try {
    // Block A: 3 floors (G,1,2). Block B: 1 floor (G only) — will stay templateless (regression check).
    let r = await fetch(`${API}/blocks`, { method: "POST", headers, body: JSON.stringify({ ProjectId: projectId, Names: ["A", "B"] }) });
    let j = await r.json();
    const [blockA, blockB] = j.blocks;

    r = await fetch(`${API}/floors`, { method: "POST", headers, body: JSON.stringify({ ProjectId: projectId, Blocks: [{ BlockId: blockA.Id, FloorCount: 3 }, { BlockId: blockB.Id, FloorCount: 1 }] }) });
    j = await r.json();
    const floor1 = j.floors.find(f => f.BlockId === blockA.Id && f.FloorNo === 1);
    const floor2 = j.floors.find(f => f.BlockId === blockA.Id && f.FloorNo === 2);

    // Save a template on Block A: 2x 2BHK, 2x 3BHK -> total 4
    r = await fetch(`${API}/blocks/${blockA.Id}/unit-template`, { method: "PUT", headers, body: JSON.stringify({
      Items: [{ UnitType: "2 BHK", Count: 2, AreaSqFt: 850 }, { UnitType: "3 BHK", Count: 2, AreaSqFt: 1200 }],
    }) });
    j = await r.json();
    assert(r.status === 200 && j.total === 4, `expected template saved with total 4, got ${JSON.stringify(j)}`);
    console.log("Template saved:", j);

    // Apply to Block A's floors
    r = await fetch(`${API}/blocks/${blockA.Id}/unit-template/apply`, { method: "POST", headers });
    j = await r.json();
    assert(r.status === 200 && j.updatedCount === 2, `expected 2 floors updated (floor1,floor2 - ground excluded by default), got ${JSON.stringify(j)}`);
    console.log("Applied:", j);

    // Customize floor2 down to 2 units (instead of template's 4) to test cycling
    r = await fetch(`${API}/floors/${floor2.Id}`, { method: "PUT", headers, body: JSON.stringify({ UnitCount: 2 }) });
    j = await r.json();
    assert(r.status === 200, `expected floor2 customize to succeed, got ${JSON.stringify(j)}`);

    // Generate
    r = await fetch(`${API}/generate-units`, { method: "POST", headers, body: JSON.stringify({ ProjectId: projectId }) });
    j = await r.json();
    console.log("Generate result:", j);
    assert(j.createdCount === 6, `expected 6 units created (4 on floor1 + 2 on floor2), got ${j.createdCount}`);

    // Verify actual UnitType/AreaSqFt sequence
    const units = await pool.request().input("bid", sql.Int, blockA.Id)
      .query("SELECT UnitName, FloorNo, UnitType, AreaSqFt FROM dbo.UnitMaster WHERE BlockId=@bid AND IsActive=1 ORDER BY FloorNo, UnitName");
    console.log("Units:", JSON.stringify(units.recordset, null, 2));

    const floor1Units = units.recordset.filter(u => u.FloorNo === 1);
    assert(floor1Units.length === 4, `expected 4 units on floor1, got ${floor1Units.length}`);
    assert(floor1Units[0].UnitType === "2 BHK" && floor1Units[1].UnitType === "2 BHK", "floor1 units 1-2 should be 2 BHK");
    assert(floor1Units[2].UnitType === "3 BHK" && floor1Units[3].UnitType === "3 BHK", "floor1 units 3-4 should be 3 BHK");
    assert(Number(floor1Units[0].AreaSqFt) === 850, "floor1 unit 1 area should be 850");
    assert(Number(floor1Units[2].AreaSqFt) === 1200, "floor1 unit 3 area should be 1200");
    console.log("PASSED — floor1 (full 4-unit template) typed correctly");

    const floor2Units = units.recordset.filter(u => u.FloorNo === 2);
    assert(floor2Units.length === 2, `expected 2 units on floor2 (customized), got ${floor2Units.length}`);
    assert(floor2Units[0].UnitType === "2 BHK" && floor2Units[1].UnitType === "2 BHK", `expected floor2 (2 units, cycling from start of [2BHK,2BHK,3BHK,3BHK]) to both be 2 BHK, got ${JSON.stringify(floor2Units)}`);
    console.log("PASSED — floor2 (customized to 2 units, cycling from template start) typed correctly");

    // Regression: Block B has NO template -> its generated units should have UnitType NULL
    r = await fetch(`${API}/floors/bulk-apply`, { method: "PUT", headers, body: JSON.stringify({ ProjectId: projectId, UnitCount: 0 }) }); // no-op, ground excluded anyway
    // Turn on Block B's ground floor with a unit to test the no-template path
    const groundB = (await pool.request().input("bid", sql.Int, blockB.Id).query("SELECT Id FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId=@bid AND FloorNo=0")).recordset[0];
    r = await fetch(`${API}/floors/${groundB.Id}`, { method: "PUT", headers, body: JSON.stringify({ HasUnits: true, UnitCount: 1 }) });
    j = await r.json();
    assert(r.status === 200, `expected ground B toggle to succeed, got ${JSON.stringify(j)}`);

    r = await fetch(`${API}/generate-units`, { method: "POST", headers, body: JSON.stringify({ ProjectId: projectId }) });
    j = await r.json();
    assert(j.createdCount === 1, `expected 1 unit created for Block B, got ${JSON.stringify(j)}`);

    const bUnits = await pool.request().input("bid", sql.Int, blockB.Id).query("SELECT UnitName, UnitType FROM dbo.UnitMaster WHERE BlockId=@bid AND IsActive=1");
    assert(bUnits.recordset.length === 1 && bUnits.recordset[0].UnitType === null, `expected Block B's unit to have NULL UnitType (no template), got ${JSON.stringify(bUnits.recordset)}`);
    console.log("PASSED — Block with no template still generates units with UnitType NULL (no regression)");

    console.log("\nALL UNIT-TEMPLATE CHECKS PASSED");
  } finally {
    await pool.request().input("pid", sql.Int, projectId).query("DELETE FROM dbo.UnitMaster WHERE ProjectId=@pid");
    await pool.request().input("pid", sql.Int, projectId).query("DELETE FROM dbo.CrmProjectAutoSetupFloor WHERE ProjectId=@pid");
    await pool.request().input("pid", sql.Int, projectId).query(`
      DELETE t FROM dbo.CrmProjectAutoSetupUnitTemplate t
      JOIN dbo.BlockMaster b ON b.Id = t.BlockId WHERE b.ProjectId=@pid`);
    await pool.request().input("pid", sql.Int, projectId).query("DELETE FROM dbo.BlockMaster WHERE ProjectId=@pid");
    await pool.request().input("pid", sql.Int, projectId).query("DELETE FROM dbo.enterprise WHERE id=@pid");
    console.log("Cleaned up", projectId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("TEST FAILED:", e.message); process.exit(1); });
