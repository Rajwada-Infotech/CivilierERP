// One-off backfill for already-posted GRNs whose base-amount leg landed on
// the generic "Purchase A/c" system ledger even though the item is now
// tagged with its own GL Account (Item_Master_Group.M_GLHeadId), or is an
// untagged Fixed Asset item that should capitalize onto "Fixed Assets A/c"
// instead. This only ever mattered going forward once
// routes/grns.js's /post-to-gl and services/generalLedger.js's
// postGRNApproval started respecting per-item GL tags — any GRN posted
// before that still has its old (wrong) legs.
//
// GL entries are never edited in place (audit-trail convention used
// everywhere in this codebase) — for every affected GRN this reverses the
// existing GRNPosting voucher (IsReversed=1) and reposts a corrected one
// with the SAME VoucherDate, using the exact same bucket/line computation
// (services/grnPosting.js) a live posting would produce, so nothing can
// drift between what this script does and what the app does.
//
// Only touches GRNs whose recomputed legs actually differ from what's
// currently posted — a GRN with no tagged/Fixed-Asset items is left alone.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/backfillGrnItemGlHeads.js
//   node backend/scripts/backfillGrnItemGlHeads.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");
const { computeGrnPostingBuckets, buildGrnPostingLines } = require("../services/grnPosting");
const { postVoucher, reversePostingBySource } = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Compares the recomputed legs (grouped by LHeadId, net debit-credit) against
// what's currently posted for this GRN. Returns null if they match (nothing
// to do), otherwise a diff summary for the log.
function diffLegs(existingRows, newLines) {
  const existingByHead = new Map(); // LHeadId -> net (debit - credit)
  for (const r of existingRows) {
    existingByHead.set(r.LHeadId, (existingByHead.get(r.LHeadId) || 0) + Number(r.DebitAmount) - Number(r.CreditAmount));
  }
  const newByHead = new Map();
  for (const l of newLines) {
    newByHead.set(l.LHeadId, (newByHead.get(l.LHeadId) || 0) + l.DebitAmount - l.CreditAmount);
  }
  const allHeads = new Set([...existingByHead.keys(), ...newByHead.keys()]);
  const changes = [];
  for (const headId of allHeads) {
    const before = Math.round((existingByHead.get(headId) || 0) * 100) / 100;
    const after = Math.round((newByHead.get(headId) || 0) * 100) / 100;
    if (Math.abs(before - after) > 0.01) changes.push({ headId, before, after });
  }
  return changes.length ? changes : null;
}

async function main() {
  await connectDB();
  const pool = getPool();

  const headNameRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster`);
  const headNameById = new Map(headNameRes.recordset.map((r) => [r.LHeadId, r.LHeadName]));

  const postedRes = await pool.request().query(`
    SELECT DISTINCT gle.SourceId AS GRNID, gle.VoucherNo
    FROM dbo.GeneralLedgerEntry gle
    WHERE gle.SourceType = 'GRNPosting' AND gle.IsReversed = 0
    ORDER BY gle.SourceId ASC
  `);

  console.log(`Found ${postedRes.recordset.length} posted GRN(s) to check. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let changedCount = 0;

  for (const { GRNID: grnId, VoucherNo: oldVoucherNo } of postedRes.recordset) {
    const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT g.GRNID, g.GRNNo, g.GRNDate, g.GRNItems, g.POID,
             po.CompanyId, po.ProjectId, po.CostCenterId
      FROM dbo.GoodsReceiptNotes g
      LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = g.POID
      WHERE g.GRNID = @GRNID
    `);
    const grn = grnRes.recordset[0];
    if (!grn) {
      console.log(`  ⚠ GRN ${grnId}: no longer exists, skipping`);
      continue;
    }

    const existingRowsRes = await pool.request().input("SrcId", sql.Int, grnId).query(`
      SELECT LHeadId, DebitAmount, CreditAmount
      FROM dbo.GeneralLedgerEntry
      WHERE SourceType = 'GRNPosting' AND SourceId = @SrcId AND IsReversed = 0
    `);

    const { buckets, totalBase } = await computeGrnPostingBuckets(pool, sql, grn);
    if (totalBase <= 0) continue;

    const ledRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1`);
    const leds = ledRes.recordset;
    const findId = (fn) => leds.find(fn)?.LHeadId;
    const purchaseId = findId((l) => l.LHeadName.toLowerCase().includes("purchase"));
    const pgrnId = findId((l) => l.LHeadName.toLowerCase().includes("pending"));
    const provisionalId = findId((l) => l.LHeadName.toLowerCase().includes("provisional") && l.LHeadName.toLowerCase().includes("credit"));
    if (!purchaseId || !pgrnId || !provisionalId) {
      console.log(`  ⚠ GRN ${grnId}: system ledgers not configured, skipping`);
      continue;
    }

    const newLines = buildGrnPostingLines({ buckets, grnNo: grn.GRNNo, purchaseId, pgrnId, provisionalId });
    const changes = diffLegs(existingRowsRes.recordset, newLines);
    if (!changes) continue;

    changedCount++;
    console.log(`GRN ${grn.GRNNo} (id ${grnId}), currently ${oldVoucherNo}:`);
    for (const c of changes) {
      const name = headNameById.get(c.headId) || `#${c.headId}`;
      console.log(`    ${name}: ${fmt(c.before)} → ${fmt(c.after)}`);
    }

    if (APPLY) {
      await reversePostingBySource(pool, "GRNPosting", grnId);
      const newVoucherNo = `${oldVoucherNo}-BF`;
      await postVoucher(pool, {
        voucherNo: newVoucherNo,
        voucherDate: grn.GRNDate,
        sourceType: "GRNPosting",
        sourceId: grnId,
        companyId: grn.CompanyId ?? null,
        projectId: grn.ProjectId ?? null,
        createdBy: "backfill-grn-item-gl-heads",
        legs: newLines.map((l) => ({ lHeadId: l.LHeadId, debit: l.DebitAmount, credit: l.CreditAmount, narration: l.Narration, costCenterId: l.CostCenterId ?? null })),
      });
      console.log(`    → reversed ${oldVoucherNo}, reposted as ${newVoucherNo}`);
    }
    console.log("");
  }

  console.log(`\n${changedCount} GRN(s) ${APPLY ? "reclassified" : "would be reclassified"}.`);
  if (!APPLY && changedCount > 0) console.log("Re-run with --apply to write these changes.");

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
