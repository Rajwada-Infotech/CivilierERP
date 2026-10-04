// One-off backfill for already-posted GRNs and PO/WO_PO-sourced invoices
// whose base-amount leg landed on the generic "Purchase A/c" system ledger
// even though the underlying item is now tagged with its own GL Account
// (Item_Master_Group.M_GLHeadId), or is an untagged Fixed Asset item that
// should capitalize onto "Fixed Assets A/c" instead. This only ever
// mattered going forward once routes/grns.js's /post-to-gl,
// services/generalLedger.js's postGRNApproval, and routes/expenseBooking.js's
// /post-to-gl started respecting per-item GL tags — anything posted before
// that still has its old (wrong) legs.
//
// GL entries are never edited in place (audit-trail convention used
// everywhere in this codebase) — for every affected document this reverses
// the existing voucher (IsReversed=1) and reposts a corrected one with the
// SAME VoucherDate, using the exact same computation
// (services/grnPosting.js, services/itemGlHead.js) a live posting would
// produce, so nothing can drift between what this script does and what the
// app does.
//
// Only touches documents whose recomputed legs actually differ from what's
// currently posted.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write. --source limits to one of:
// grn | invoice (default: both).
//
// Usage:
//   node backend/scripts/backfillItemGlHeads.js
//   node backend/scripts/backfillItemGlHeads.js --apply
//   node backend/scripts/backfillItemGlHeads.js --apply --source=grn

const { connectDB, getPool, closeDB, sql } = require("../db");
const { computeGrnPostingBuckets, buildGrnPostingLines } = require("../services/grnPosting");
const { resolveItemGlHeads } = require("../services/itemGlHead");
const { postVoucher, reversePostingBySource } = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");
const sourceArg = process.argv.find((a) => a.startsWith("--source="));
const ONLY_SOURCE = sourceArg ? sourceArg.split("=")[1] : null;

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function getSystemLedgers(pool) {
  const ledRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1`);
  const leds = ledRes.recordset;
  const findId = (fn) => leds.find(fn)?.LHeadId;
  return {
    purchaseId: findId((l) => l.LHeadName.toLowerCase().includes("purchase")),
    pgrnId: findId((l) => l.LHeadName.toLowerCase().includes("pending")),
    provisionalId: findId((l) => l.LHeadName.toLowerCase().includes("provisional") && l.LHeadName.toLowerCase().includes("credit")),
  };
}

// Compares recomputed legs (grouped by LHeadId, net debit-credit) against
// what's currently posted. Returns null if they match.
function diffLegs(existingRows, newLegs) {
  const existingByHead = new Map();
  for (const r of existingRows) existingByHead.set(r.LHeadId, (existingByHead.get(r.LHeadId) || 0) + Number(r.DebitAmount) - Number(r.CreditAmount));
  const newByHead = new Map();
  for (const l of newLegs) newByHead.set(l.LHeadId, (newByHead.get(l.LHeadId) || 0) + (l.DebitAmount ?? l.debit ?? 0) - (l.CreditAmount ?? l.credit ?? 0));
  const allHeads = new Set([...existingByHead.keys(), ...newByHead.keys()]);
  const changes = [];
  for (const headId of allHeads) {
    const before = Math.round((existingByHead.get(headId) || 0) * 100) / 100;
    const after = Math.round((newByHead.get(headId) || 0) * 100) / 100;
    if (Math.abs(before - after) > 0.01) changes.push({ headId, before, after });
  }
  return changes.length ? changes : null;
}

// Mirrors postGRNApproval's (services/generalLedger.js, SourceType='GRN',
// the auto-post-on-approval path) exact leg construction — a DIFFERENT
// shape from buildGrnPostingLines/GRNPosting: GST is a single Provisional
// Credit leg rather than a per-head tax-offset pair, and there's no cost
// centre split. Needed because a GRN posted here, before an item got
// tagged as a Fixed Asset (or got its own GL Account), still has its old
// Purchase A/c leg — 'GRNPosting' isn't the only live posting path, so
// backfillGrns() below must check both.
async function buildGrnApprovalLines(pool, grn, ledgers) {
  let items = [];
  try {
    items = JSON.parse(grn.GRNItems || "[]");
    if (!Array.isArray(items)) items = [];
  } catch { items = []; }

  const itemIds = items.map((it) => it.itemId).filter((id) => id != null).map(String);
  const itemGlMap = await resolveItemGlHeads(pool, sql, itemIds);

  const purchaseAmountByHead = new Map();
  const fixedAssetAmountByHead = new Map();
  for (const it of items) {
    const amt = Number(it.totalAmount) || 0;
    const itemId = it.itemId != null ? String(it.itemId) : null;
    const master = itemId ? itemGlMap.get(itemId) : null;
    const target = master?.isFixedAsset ? fixedAssetAmountByHead : purchaseAmountByHead;
    const headId = master?.isFixedAsset ? master.glHeadId : (master?.glHeadId ?? null);
    const bucket = target.get(headId) ?? 0;
    target.set(headId, bucket + amt);
  }

  const baseAmount = items.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);
  const totalInclGst = Number(grn.TotalAmount) || 0;
  const gstAmount = Math.max(0, totalInclGst - baseAmount);
  const docNo = grn.DocNo || grn.GRNNo || `GRN-${grn.GRNID}`;

  const purchaseLegs = Array.from(purchaseAmountByHead.entries()).map(([lHeadId, amount]) => ({
    LHeadId: lHeadId || ledgers.purchaseId, DebitAmount: Math.round(amount * 100) / 100, CreditAmount: 0,
    Narration: `GRN ${docNo} — goods received (base)`,
  }));
  const fixedAssetLegs = Array.from(fixedAssetAmountByHead.entries()).map(([lHeadId, amount]) => ({
    LHeadId: lHeadId, DebitAmount: Math.round(amount * 100) / 100, CreditAmount: 0,
    Narration: `GRN ${docNo} — fixed asset received (capitalized)`,
  }));

  return [
    ...purchaseLegs,
    ...fixedAssetLegs,
    { LHeadId: ledgers.provisionalId, DebitAmount: Math.round(gstAmount * 100) / 100, CreditAmount: 0, Narration: `GRN ${docNo} — input GST credit (provisional)` },
    { LHeadId: ledgers.pgrnId, DebitAmount: 0, CreditAmount: Math.round(totalInclGst * 100) / 100, Narration: `GRN ${docNo} — goods received, not yet invoiced` },
  ];
}

async function backfillGrnsForSourceType(pool, headNameById, ledgers, sourceType, buildLines) {
  const postedRes = await pool.request().input("SourceType", sql.NVarChar(30), sourceType).query(`
    SELECT DISTINCT gle.SourceId AS GRNID, gle.VoucherNo
    FROM dbo.GeneralLedgerEntry gle
    WHERE gle.SourceType = @SourceType AND gle.IsReversed = 0
    ORDER BY gle.SourceId ASC
  `);
  console.log(`\n=== GRNs (${sourceType}): ${postedRes.recordset.length} posted document(s) to check ===\n`);

  const { purchaseId, pgrnId, provisionalId } = ledgers;
  let changedCount = 0;

  for (const { GRNID: grnId, VoucherNo: oldVoucherNo } of postedRes.recordset) {
    const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT g.GRNID, g.GRNNo, g.DocNo, g.GRNDate, g.GRNItems, g.TotalAmount, g.POID,
             po.CompanyId, po.ProjectId, po.CostCenterId
      FROM dbo.GoodsReceiptNotes g
      LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = g.POID
      WHERE g.GRNID = @GRNID
    `);
    const grn = grnRes.recordset[0];
    if (!grn) { console.log(`  ⚠ GRN ${grnId}: no longer exists, skipping`); continue; }

    const existingRowsRes = await pool.request().input("SrcId", sql.Int, grnId).input("SourceType", sql.NVarChar(30), sourceType).query(`
      SELECT LHeadId, DebitAmount, CreditAmount FROM dbo.GeneralLedgerEntry
      WHERE SourceType = @SourceType AND SourceId = @SrcId AND IsReversed = 0
    `);

    if (!purchaseId || !pgrnId || !provisionalId) { console.log(`  ⚠ GRN ${grnId}: system ledgers not configured, skipping`); continue; }

    const newLines = await buildLines(pool, grn, ledgers);
    const totalNew = newLines.reduce((s, l) => s + l.DebitAmount, 0);
    if (totalNew <= 0) continue;

    const changes = diffLegs(existingRowsRes.recordset, newLines);
    if (!changes) continue;

    changedCount++;
    console.log(`GRN ${grn.GRNNo} (id ${grnId}, ${sourceType}), currently ${oldVoucherNo}:`);
    for (const c of changes) console.log(`    ${headNameById.get(c.headId) || `#${c.headId}`}: ${fmt(c.before)} → ${fmt(c.after)}`);

    if (APPLY) {
      await reversePostingBySource(pool, sourceType, grnId);
      const newVoucherNo = `${oldVoucherNo}-BF`;
      await postVoucher(pool, {
        voucherNo: newVoucherNo,
        voucherDate: grn.GRNDate,
        sourceType,
        sourceId: grnId,
        companyId: grn.CompanyId ?? null,
        projectId: grn.ProjectId ?? null,
        createdBy: "backfill-item-gl-heads",
        legs: newLines.map((l) => ({ lHeadId: l.LHeadId, debit: l.DebitAmount, credit: l.CreditAmount, narration: l.Narration, costCenterId: l.CostCenterId ?? null })),
      });
      console.log(`    → reversed ${oldVoucherNo}, reposted as ${newVoucherNo}`);
    }
    console.log("");
  }

  console.log(`${changedCount} GRN(s) under ${sourceType} ${APPLY ? "reclassified" : "would be reclassified"}.`);
  return changedCount;
}

async function backfillGrns(pool, headNameById) {
  const ledgers = await getSystemLedgers(pool);
  let total = 0;
  total += await backfillGrnsForSourceType(pool, headNameById, ledgers, "GRNPosting",
    async (p, grn, l) => {
      const { buckets } = await computeGrnPostingBuckets(p, sql, grn);
      return buildGrnPostingLines({ buckets, grnNo: grn.GRNNo, purchaseId: l.purchaseId, pgrnId: l.pgrnId, provisionalId: l.provisionalId });
    });
  total += await backfillGrnsForSourceType(pool, headNameById, ledgers, "GRN", buildGrnApprovalLines);
  return total;
}

async function backfillInvoices(pool, headNameById) {
  const { purchaseId } = await getSystemLedgers(pool);
  const postedRes = await pool.request().query(`
    SELECT DISTINCT gle.SourceId AS EbId, gle.VoucherNo
    FROM dbo.GeneralLedgerEntry gle
    WHERE gle.SourceType = 'InvoicePosting' AND gle.IsReversed = 0
    ORDER BY gle.SourceId ASC
  `);
  console.log(`\n=== Invoices: ${postedRes.recordset.length} posted document(s) to check ===\n`);

  let changedCount = 0;

  for (const { EbId: ebId, VoucherNo: oldVoucherNo } of postedRes.recordset) {
    const ebRes = await pool.request().input("Eid", sql.Int, ebId).query(`
      SELECT Eid, EDocNo, ESourceType, ESourceId FROM dbo.ExpenseBooking WHERE Eid = @Eid
    `);
    const eb = ebRes.recordset[0];
    if (!eb) continue;
    // Only PO/WO_PO-sourced invoices ever fall back to the flat Purchase
    // A/c leg — GRN-linked invoices clear PGRN directly (never Purchase
    // A/c), and TOD/allocation-tagged invoices use their own Expense Heads.
    if (!(eb.ESourceType === "PO" || eb.ESourceType === "WO_PO")) continue;

    const allocRes = await pool.request().input("SrcId", sql.Int, ebId).query(`
      SELECT TOP 1 1 AS x FROM dbo.ExpenseHeadAllocation WHERE SourceType = 'ExpenseBooking' AND SourceId = @SrcId
    `);
    if (allocRes.recordset.length) continue; // already uses its own tagged heads

    const poId = parseInt(eb.ESourceId, 10);
    if (!Number.isFinite(poId)) continue;

    const rowsRes = await pool.request().input("SrcId", sql.Int, ebId).query(`
      SELECT EntryId, LHeadId, DebitAmount, CreditAmount, Narration, CostCenterId, VoucherDate, CompanyId, ProjectId
      FROM dbo.GeneralLedgerEntry WHERE SourceType = 'InvoicePosting' AND SourceId = @SrcId AND IsReversed = 0
    `);
    const rows = rowsRes.recordset;
    if (!rows.length) continue;
    const purchaseLeg = rows.find((r) => r.LHeadId === purchaseId && Number(r.DebitAmount) > 0);
    if (!purchaseLeg) continue; // nothing posted to the generic Purchase A/c — already split, or uses a legacy explicit GL account

    const poItemsRes = await pool.request().input("PoId", sql.Int, poId).query(
      `SELECT ItemId, LineAmount FROM dbo.PurchaseOrderItems WHERE PurchaseOrderID = @PoId AND ItemId IS NOT NULL`,
    );
    const poItems = poItemsRes.recordset.filter((r) => Number(r.LineAmount) > 0);
    const poTotal = poItems.reduce((s, r) => s + Number(r.LineAmount), 0);
    if (!poItems.length || poTotal <= 0) continue;

    const itemGlMap = await resolveItemGlHeads(pool, sql, poItems.map((r) => r.ItemId));
    const shares = new Map();
    for (const r of poItems) {
      const headId = itemGlMap.get(String(r.ItemId))?.glHeadId ?? null;
      shares.set(headId, (shares.get(headId) || 0) + Number(r.LineAmount) / poTotal);
    }
    const distinctHeads = [...shares.keys()].map((h) => h || purchaseId);
    if (new Set(distinctHeads).size === 1 && distinctHeads[0] === purchaseId) continue; // nothing actually changes

    const baseAmt = Number(purchaseLeg.DebitAmount);
    const amounts = [...shares.entries()].map(([headId, share]) => ({ headId: headId || purchaseId, amount: Math.round(baseAmt * share * 100) / 100 }));
    const shortfall = Math.round((baseAmt - amounts.reduce((s, a) => s + a.amount, 0)) * 100) / 100;
    if (Math.abs(shortfall) > 0) {
      const biggest = amounts.reduce((m, a) => (a.amount > m.amount ? a : m), amounts[0]);
      biggest.amount = Math.round((biggest.amount + shortfall) * 100) / 100;
    }

    changedCount++;
    console.log(`Invoice ${eb.EDocNo} (id ${ebId}), currently ${oldVoucherNo}:`);
    console.log(`    Purchase A/c: ${fmt(baseAmt)} → 0.00`);
    for (const a of amounts) console.log(`    ${headNameById.get(a.headId) || `#${a.headId}`}: 0.00 → ${fmt(a.amount)}`);

    if (APPLY) {
      const otherRows = rows.filter((r) => r.EntryId !== purchaseLeg.EntryId);
      const newLegs = [
        ...otherRows.map((r) => ({ lHeadId: r.LHeadId, debit: Number(r.DebitAmount), credit: Number(r.CreditAmount), narration: r.Narration, costCenterId: r.CostCenterId ?? null })),
        ...amounts.filter((a) => a.amount !== 0).map((a) => ({
          lHeadId: a.headId,
          debit: a.amount,
          credit: 0,
          narration: `Invoice Posting: ${eb.EDocNo} — ${a.headId === purchaseId ? "Purchase" : "GL Account"}`,
          costCenterId: purchaseLeg.CostCenterId ?? null,
        })),
      ];
      await reversePostingBySource(pool, "InvoicePosting", ebId);
      const newVoucherNo = `${oldVoucherNo}-BF`;
      await postVoucher(pool, {
        voucherNo: newVoucherNo,
        voucherDate: purchaseLeg.VoucherDate,
        sourceType: "InvoicePosting",
        sourceId: ebId,
        companyId: purchaseLeg.CompanyId ?? null,
        projectId: purchaseLeg.ProjectId ?? null,
        createdBy: "backfill-item-gl-heads",
        legs: newLegs,
      });
      console.log(`    → reversed ${oldVoucherNo}, reposted as ${newVoucherNo}`);
    }
    console.log("");
  }

  console.log(`${changedCount} invoice(s) ${APPLY ? "reclassified" : "would be reclassified"}.`);
  return changedCount;
}

async function main() {
  await connectDB();
  const pool = getPool();

  const headNameRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster`);
  const headNameById = new Map(headNameRes.recordset.map((r) => [r.LHeadId, r.LHeadName]));

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}${ONLY_SOURCE ? ` (source=${ONLY_SOURCE})` : ""}`);

  let total = 0;
  if (!ONLY_SOURCE || ONLY_SOURCE === "grn") total += await backfillGrns(pool, headNameById);
  if (!ONLY_SOURCE || ONLY_SOURCE === "invoice") total += await backfillInvoices(pool, headNameById);

  console.log(`\n${total} document(s) total ${APPLY ? "reclassified" : "would be reclassified"}.`);
  if (!APPLY && total > 0) console.log("Re-run with --apply to write these changes.");

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
