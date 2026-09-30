// Reconciles live Project > Block > Floor > Unit STRUCTURE and NAMES to a
// target spec (JSON, e.g. generated from the sales availability list).
// Nothing here is hard-coded: unit names are built the way the app builds
// them — `${enterprise.short_name}/${BlockMaster.BlockName}/${floorLabel}${flat}`
// (crmProjectAutoSetup.js) — layout types are looked up in RoomLayoutType, and
// every OTHER column holding a copy of a renamed name is discovered from the
// schema and kept in sync.
//
// Scope — structure and names only:
//   - project / block / unit renames (+ their copies: chain aliases etc.)
//   - missing blocks, units and floor rows created (new units get rooms from
//     their layout via the app's own syncUnitRooms)
//   - units in the DB but not in the spec are only REPORTED, never removed
//   - existing units' type / areas / facing are never touched
//
// Dry run by default: each project runs in a transaction that is rolled back.
//   node scripts/reconcileProjectStructure.js --spec scripts/structure_spec.json
//   node scripts/reconcileProjectStructure.js --spec ... --project "Royal Garden"
//   node scripts/reconcileProjectStructure.js --spec ... --apply

const fs = require("fs");
const { connectDB, getPool, sql, closeDB } = require("../db");
let unitLayout = null;
try { unitLayout = require("../services/unitLayout"); } catch (_) { /* rooms step skipped if absent */ }

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const SPEC = arg("--spec");
const ONLY = arg("--project");

const norm = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const typeKey = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, "");
const floorLabel = (n) => (n === 0 ? "G" : String(n));
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Position of an existing unit within its floor, from its current name's tail:
// "…/1A" or "…/1/A" -> "A";  "…/101" / "…/306" -> 2-digit seq -> "A" / "F".
function letterOf(unitName, floorNo) {
  const tail = String(unitName).split("/").pop();
  let m = tail.match(/([A-Z])$/);
  if (m) return m[1];
  m = tail.match(/^(\d+)$/);
  if (m && floorNo != null) {
    const s = m[1];
    const fl = String(floorNo);
    if (s.startsWith(fl) && s.length === fl.length + 2) {
      const seq = parseInt(s.slice(fl.length), 10);
      if (seq >= 1 && seq <= 26) return LETTERS[seq - 1];
    }
  }
  return null;
}

async function main() {
  if (!SPEC) throw new Error("pass --spec <file.json>");
  const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
  await connectDB();
  const pool = getPool();
  const q = async (db, text, inputs = {}) => {
    const r = db.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(text)).recordset;
  };

  // Schema facts (production may lag dev).
  const cols = new Map();
  for (const r of await q(pool, "SELECT t.name AS t, c.name AS c FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id")) {
    if (!cols.has(r.t)) cols.set(r.t, new Set());
    cols.get(r.t).add(r.c);
  }
  const has = (t, c) => cols.get(t)?.has(c) ?? false;
  const hasFloorTable = cols.has("CrmProjectAutoSetupFloor");

  // Columns elsewhere that hold COPIES of names (discovered, not listed by hand).
  const copyCols = (await q(pool, `
    SELECT t.name AS tbl, c.name AS col FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE ty.name IN ('nvarchar','varchar','nchar','char')
      AND (c.name LIKE '%Unit%' OR c.name LIKE '%Flat%' OR c.name LIKE '%Block%' OR c.name LIKE '%Tower%' OR c.name LIKE '%Project%' OR c.name = 'Alias')
      AND NOT (t.name = 'UnitMaster' AND c.name IN ('UnitName','UnitType'))
      AND NOT (t.name = 'BlockMaster' AND c.name = 'BlockName')`)).filter((c) => c.tbl !== "enterprise");

  const layouts = await q(pool, "SELECT Id, TypeKey, Label FROM dbo.RoomLayoutType WHERE IsActive = 1");
  const layoutFor = (bhk) => (bhk == null ? null : layouts.find((l) => typeKey(l.TypeKey) === typeKey(`${bhk} BHK`) || typeKey(l.Label) === typeKey(`${bhk} BHK`)) || null);

  const dbProjects = await q(pool, "SELECT id, name, short_name FROM dbo.enterprise WHERE business_type = 'P'");
  const totals = { renameProject: 0, renameBlock: 0, createBlock: 0, renameUnit: 0, createUnit: 0, reactivateUnit: 0, floorRows: 0, copies: 0, roomsCreated: 0, notInSpec: 0, problems: 0 };
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — spec: ${spec.source || SPEC}\n`);

  for (const sp of spec.projects) {
    if (ONLY && norm(sp.name) !== norm(ONLY) && !(sp.alsoKnownAs || []).some((a) => norm(a) === norm(ONLY))) continue;
    const names = [sp.name, ...(sp.alsoKnownAs || [])].map(norm);
    const matches = dbProjects.filter((p) => names.includes(norm(p.name)));
    console.log(`${"=".repeat(78)}\nPROJECT "${sp.name}"`);
    if (matches.length !== 1) { console.log(`  !! ${matches.length} DB projects match — skipped`); totals.problems++; continue; }
    const proj = matches[0];
    const short = String(proj.short_name || "").trim();
    if (!short) { console.log(`  !! project #${proj.id} has no short_name — skipped (set it in Project Master)`); totals.problems++; continue; }

    const tx = pool.transaction();
    await tx.begin();
    const log = [];
    try {
      const syncCopies = async (oldVal, newVal, { prefix = false, onlyIfUnique = null } = {}) => {
        if (onlyIfUnique != null && onlyIfUnique > 1) { log.push(`      (copies of "${oldVal}" not synced — the name isn't unique)`); return; }
        for (const { tbl, col } of copyCols) {
          const isAlias = col === "Alias";
          if (prefix !== isAlias) continue;
          const where = prefix ? `[${col}] LIKE @old + '/%'` : `LTRIM(RTRIM([${col}])) = LTRIM(RTRIM(@old))`;
          const set = prefix ? `@new + SUBSTRING([${col}], LEN(@old) + 1, 4000)` : "@new";
          const r = await tx.request().input("old", sql.NVarChar(510), oldVal).input("new", sql.NVarChar(510), newVal)
            .query(`UPDATE dbo.[${tbl}] SET [${col}] = ${set} WHERE ${where}`);
          const n = r.rowsAffected[0] || 0;
          if (n) { totals.copies += n; log.push(`      copy ${tbl}.${col}: ${n} row(s)`); }
        }
      };

      // Project name.
      if (proj.name !== sp.name) {
        log.push(`  RENAME project #${proj.id}: "${proj.name}" -> "${sp.name}"`);
        await tx.request().input("id", sql.Int, proj.id).input("n", sql.NVarChar(255), sp.name).query("UPDATE dbo.enterprise SET name = @n WHERE id = @id");
        totals.renameProject++;
        await syncCopies(proj.name, sp.name);
      }

      const dbBlocks = await q(tx, "SELECT Id, BlockName, IsActive, ProjectTypeId FROM dbo.BlockMaster WHERE ProjectId = @p", { p: [sql.Int, proj.id] });
      for (const sb of sp.blocks) {
        const bNames = [sb.name, ...(sb.alsoKnownAs || [])].map(norm);
        const bm = dbBlocks.filter((b) => bNames.includes(norm(b.BlockName)));
        let block;
        if (bm.length > 1) { log.push(`  !! block "${sb.name}": ${bm.length} DB blocks match — skipped`); totals.problems++; continue; }
        if (!bm.length) {
          const typeId = dbBlocks.find((b) => b.ProjectTypeId != null)?.ProjectTypeId ?? null;
          const ins = await tx.request().input("p", sql.Int, proj.id).input("n", sql.NVarChar(200), sb.name).input("pt", sql.Int, typeId)
            .query(`INSERT INTO dbo.BlockMaster (ProjectId, BlockName, IsActive, CreatedAt${has("BlockMaster", "ProjectTypeId") ? ", ProjectTypeId" : ""})
                    OUTPUT INSERTED.Id VALUES (@p, @n, 1, SYSDATETIME()${has("BlockMaster", "ProjectTypeId") ? ", @pt" : ""})`);
          block = { Id: ins.recordset[0].Id, BlockName: sb.name };
          log.push(`  CREATE block "${sb.name}" (#${block.Id})`);
          totals.createBlock++;
        } else {
          block = bm[0];
          if (block.BlockName !== sb.name) {
            const uses = (await q(tx, "SELECT COUNT(*) AS n FROM dbo.BlockMaster WHERE BlockName = @b", { b: [sql.NVarChar(200), block.BlockName] }))[0].n;
            log.push(`  RENAME block #${block.Id}: "${block.BlockName}" -> "${sb.name}"`);
            await tx.request().input("id", sql.Int, block.Id).input("n", sql.NVarChar(200), sb.name).query("UPDATE dbo.BlockMaster SET BlockName = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
            totals.renameBlock++;
            await syncCopies(block.BlockName, sb.name, { onlyIfUnique: uses });
            block = { ...block, BlockName: sb.name };
          }
        }

        const dbUnits = await q(tx, "SELECT Id, UnitName, FloorNo, IsActive FROM dbo.UnitMaster WHERE BlockId = @b", { b: [sql.Int, block.Id] });
        const byKey = new Map();
        for (const u of dbUnits) {
          const l = letterOf(u.UnitName, u.FloorNo);
          const key = l ? `${u.FloorNo}|${l}` : `name|${String(u.UnitName).split("/").pop()}`;
          if (byKey.has(key)) { log.push(`    !! two units map to ${key}: #${byKey.get(key).Id} ${byKey.get(key).UnitName} and #${u.Id} ${u.UnitName} — both left as is`); byKey.set(key, null); totals.problems++; continue; }
          byKey.set(key, u);
        }
        const seen = new Set();
        const touchedFloors = new Set();

        for (const [flStr, flats] of Object.entries(sb.floors)) {
          const floorNo = parseInt(flStr, 10);
          for (const f of flats) {
            const isLetter = /^[A-Z]$/.test(f.flat);
            const code = isLetter ? `${floorLabel(floorNo)}${f.flat}` : f.flat;
            const target = `${short}/${block.BlockName}/${code}`;
            const key = isLetter ? `${floorNo}|${f.flat}` : `name|${f.flat}`;
            const u = byKey.get(key);
            if (u === null) continue;
            if (u) {
              seen.add(u.Id);
              touchedFloors.add(u.FloorNo);
              if (u.UnitName !== target) {
                const clash = await q(tx, "SELECT Id FROM dbo.UnitMaster WHERE UnitName = @n AND Id <> @id", { n: [sql.NVarChar(200), target], id: [sql.Int, u.Id] });
                if (clash.length) { log.push(`    !! #${u.Id} ${u.UnitName} -> ${target}: name already used by #${clash[0].Id} — skipped`); totals.problems++; continue; }
                log.push(`    RENAME unit #${u.Id}: ${u.UnitName} -> ${target}`);
                await tx.request().input("id", sql.Int, u.Id).input("n", sql.NVarChar(200), target).query("UPDATE dbo.UnitMaster SET UnitName = @n, UpdatedAt = SYSDATETIME() WHERE Id = @id");
                totals.renameUnit++;
                await syncCopies(u.UnitName, target);
                await syncCopies(u.UnitName, target, { prefix: true });
              }
              if (!u.IsActive) log.push(`    note: #${u.Id} ${target} exists but is inactive — left inactive`);
              continue;
            }
            // Missing -> create (or reactivate an inactive unit already carrying that name).
            const layout = layoutFor(f.bhk);
            const same = await q(tx, "SELECT Id, IsActive FROM dbo.UnitMaster WHERE UnitName = @n", { n: [sql.NVarChar(200), target] });
            let newId;
            if (same.length) {
              if (same[0].IsActive) { log.push(`    !! ${target} already exists elsewhere (#${same[0].Id}) — skipped`); totals.problems++; continue; }
              newId = same[0].Id;
              await tx.request().input("id", sql.Int, newId).input("b", sql.Int, block.Id).input("f", sql.Int, floorNo)
                .query("UPDATE dbo.UnitMaster SET IsActive = 1, BlockId = @b, FloorNo = @f, UpdatedAt = SYSDATETIME() WHERE Id = @id");
              log.push(`    REACTIVATE unit #${newId} ${target}`);
              totals.reactivateUnit++;
            } else {
              const ins = await tx.request()
                .input("p", sql.Int, proj.id).input("b", sql.Int, block.Id).input("n", sql.NVarChar(200), target).input("f", sql.Int, floorNo)
                .input("t", sql.NVarChar(100), layout ? layout.Label : null).input("lt", sql.Int, layout ? layout.Id : null)
                .query(`INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType${has("UnitMaster", "LayoutTypeId") ? ", LayoutTypeId" : ""}, IsActive, CreatedAt)
                        OUTPUT INSERTED.Id VALUES (@p, @b, @n, @f, @t${has("UnitMaster", "LayoutTypeId") ? ", @lt" : ""}, 1, SYSDATETIME())`);
              newId = ins.recordset[0].Id;
              log.push(`    CREATE unit ${target} [${layout ? layout.Label : f.bhk ? `${f.bhk} BHK — no such layout type, left untyped` : "no type"}]`);
              totals.createUnit++;
            }
            touchedFloors.add(floorNo);
            if (layout && unitLayout?.syncUnitRooms) {
              const rs = await unitLayout.syncUnitRooms(tx, newId, { removeUnused: false, createdBy: null });
              totals.roomsCreated += (rs.created || 0) + (rs.reactivated || 0);
            }
          }
        }

        for (const u of dbUnits) {
          if (u.IsActive && !seen.has(u.Id)) { log.push(`    in DB, not in spec (left untouched): #${u.Id} ${u.UnitName}`); totals.notInSpec++; }
        }

        // Floor scaffold rows used by Room Master / Auto Setup: one per floor with units.
        if (hasFloorTable) {
          const counts = await q(tx, "SELECT FloorNo, COUNT(*) AS n FROM dbo.UnitMaster WHERE BlockId = @b AND IsActive = 1 GROUP BY FloorNo", { b: [sql.Int, block.Id] });
          const rows = await q(tx, "SELECT Id, FloorNo, UnitCount, IsActive FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @b", { b: [sql.Int, block.Id] });
          for (const c of counts) {
            const fno = c.FloorNo == null ? -1 : c.FloorNo;
            const row = rows.find((r) => r.FloorNo === fno);
            if (!row) {
              await tx.request().input("p", sql.Int, proj.id).input("b", sql.Int, block.Id).input("f", sql.Int, fno)
                .input("l", sql.NVarChar(40), fno === -1 ? "Unassigned" : floorLabel(fno)).input("n", sql.Int, c.n)
                .query(`INSERT INTO dbo.CrmProjectAutoSetupFloor (ProjectId, BlockId, FloorNo, FloorLabel, UnitCount, HasUnits, IsGenerated, IsActive, CreatedAt)
                        VALUES (@p, @b, @f, @l, @n, 1, 1, 1, SYSDATETIME())`);
              log.push(`    floor row added: block "${block.BlockName}" floor ${fno === -1 ? "Unassigned" : floorLabel(fno)} (${c.n} units)`);
              totals.floorRows++;
            } else if (row.UnitCount !== c.n || !row.IsActive) {
              await tx.request().input("id", sql.Int, row.Id).input("n", sql.Int, c.n)
                .query("UPDATE dbo.CrmProjectAutoSetupFloor SET UnitCount = @n, HasUnits = 1, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE Id = @id");
              log.push(`    floor row updated: block "${block.BlockName}" floor ${floorLabel(fno)} count ${row.UnitCount} -> ${c.n}`);
              totals.floorRows++;
            }
          }
        }
      }

      if (APPLY) await tx.commit(); else await tx.rollback();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* already rolled back */ }
      log.push(`  !! FAILED — nothing written for this project: ${e.message}`);
      totals.problems++;
    }
    console.log(log.length ? log.join("\n") : "  no changes");
  }

  if (APPLY) {
    try {
      if (unitLayout?.bumpFlatMasterCaches) await unitLayout.bumpFlatMasterCaches();
      await require("../redis").bumpCacheVersion("unit-master");
    } catch (_) { /* cache refresh is best-effort */ }
  }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — every project was rolled back. Nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("reconcileProjectStructure failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
