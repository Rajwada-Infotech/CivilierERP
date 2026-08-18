"use strict";
/**
 * Seed 10 smoke-test Dependency Master records (dbo.DependencyMaster +
 * dbo.DependencyMasterActivity) so the Dependency Management page has real
 * chains to render instead of the single manually-created "hjhhj" record.
 *
 * Scope (Project > Tower > Floor > Flat > Room) and activities are resolved
 * dynamically from whatever real, active rows already exist — never
 * hardcoded ids — so this is safe to run against any environment. Only 4
 * active rooms exist locally, so scopes repeat across records (no unique
 * constraint on scope — multiple dependency chains for the same room, e.g.
 * different alias/trade subsets, is a legitimate real-world case).
 *
 * Tagged CreatedBy = 'smoke-seed' and Alias prefixed 'SMOKE-', matching the
 * convention every other smoke-seed script in this directory uses.
 *
 * Run: node backend/scripts/seedDependencyMasterSmokeData.js
 *      node backend/scripts/seedDependencyMasterSmokeData.js --clean
 */
require("../config/env").loadEnv();
const sql = require("mssql");

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || "1433"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const CLEAN = process.argv.includes("--clean");
const CREATED_BY = "smoke-seed";
const N = 10;

const ALIAS_NAMES = [
  "Finishing Package A", "MEP Rough-in", "Interior Fit-out", "Wet Area Works",
  "Flooring Sequence", "Paint & Polish", "Final Handover Prep", "Snag Rectification",
  "Balcony Waterproofing", "Kitchen Fit-out",
];

function pick(arr, i) {
  return arr[i % arr.length];
}

async function clean(pool) {
  const activities = await pool.request().query(`
    DELETE dma FROM dbo.DependencyMasterActivity dma
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    WHERE dm.CreatedBy = '${CREATED_BY}'
  `);
  const masters = await pool.request().query(`DELETE FROM dbo.DependencyMaster WHERE CreatedBy = '${CREATED_BY}'`);
  console.log(`Removed: ${activities.rowsAffected[0]} activity rungs, ${masters.rowsAffected[0]} Dependency Master records.`);
}

async function run() {
  const pool = await sql.connect(config);
  console.log("Connected to DB");

  if (CLEAN) {
    await clean(pool);
    await pool.close();
    return;
  }

  const rooms = (await pool.request().query(`
    SELECT r.Id AS RoomId, r.RoomName, r.Floor, r.UnitId AS FlatId, um.UnitName,
           r.BlockId AS TowerId, bm.BlockName, bm.ProjectId, ep.name AS ProjectName
    FROM dbo.RoomMaster r
    JOIN dbo.UnitMaster um ON um.Id = r.UnitId AND um.IsActive = 1
    JOIN dbo.BlockMaster bm ON bm.Id = r.BlockId AND bm.IsActive = 1
    JOIN dbo.enterprise ep ON ep.id = bm.ProjectId AND ep.business_type = 'P'
    WHERE r.IsActive = 1
    ORDER BY r.Id
  `)).recordset;
  const activities = (await pool.request().query(`
    SELECT id, activity_name FROM dbo.ActivityMaster WHERE activity_type = 1 AND is_active = 1 ORDER BY id
  `)).recordset;

  if (!rooms.length) throw new Error("No active rooms found (dbo.RoomMaster) — nothing to seed a scope against.");
  if (activities.length < 2) throw new Error("Need at least 2 active activities (dbo.ActivityMaster, activity_type=1) to build a chain.");

  console.log(`Found ${rooms.length} active room(s) and ${activities.length} active activity type(s) to build chains from.\n`);

  for (let i = 0; i < N; i++) {
    const room = pick(rooms, i);
    const workType = i % 2 === 0 ? "INTERNAL" : "EXTERNAL";
    const alias = `SMOKE-${ALIAS_NAMES[i % ALIAS_NAMES.length]}`;
    // 2-4 activities per chain, rotating the starting point so different
    // records don't all use the exact same rungs in the exact same order.
    const chainLen = 2 + (i % 3);
    const chain = Array.from({ length: chainLen }, (_, j) => activities[(i + j) % activities.length]);

    const insertRes = await pool
      .request()
      .input("ProjectId", sql.Int, room.ProjectId)
      .input("TowerId", sql.Int, room.TowerId)
      .input("Floor", sql.NVarChar(50), String(room.Floor))
      .input("FlatId", sql.Int, room.FlatId)
      .input("RoomId", sql.Int, room.RoomId)
      .input("Alias", sql.NVarChar(200), alias)
      .input("WorkType", sql.NVarChar(20), workType)
      .input("CreatedBy", sql.NVarChar(300), CREATED_BY)
      .query(`
        INSERT INTO dbo.DependencyMaster
          (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@ProjectId, @TowerId, @Floor, @FlatId, @RoomId, @Alias, @WorkType, @CreatedBy, SYSDATETIME())
      `);
    const newId = insertRes.recordset[0].Id;

    for (let j = 0; j < chain.length; j++) {
      await pool
        .request()
        .input("DependencyMasterId", sql.Int, newId)
        .input("ActivityId", sql.Int, chain[j].id)
        .input("SequenceNo", sql.Int, j + 1)
        .input("WorkType", sql.NVarChar(20), workType)
        .query(`
          INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
          VALUES (@DependencyMasterId, @ActivityId, @SequenceNo, @WorkType)
        `);
    }

    console.log(
      `${alias}: Id ${newId} — ${room.BlockName} > Floor ${room.Floor} > ${room.UnitName} > ${room.RoomName} (${workType}), ` +
      `chain: ${chain.map((a) => a.activity_name).join(" → ")}`,
    );
  }

  console.log(`\nDone. Seeded ${N} Dependency Master records.`);
  console.log("Run with --clean to remove all of it again (matched by CreatedBy = 'smoke-seed').");

  await pool.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
