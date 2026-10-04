// Read-only diagnostic — no writes. Finds "stray" On Account Adjustment GL
// postings that would distort the Trial Balance's own on-account exclusion/
// addback logic (see routes/trialBalance.js's headsRes: for a Supplier/
// Contractor party, an OnAccountAdjustment-sourced GL leg is excluded from
// that head's own balance and the live OnAccountLedger figure is added back
// instead — a wash pair).
//
// Every legitimate OnAccountAdjustment GL voucher is posted with SourceId =
// the OnAccountLedger.OAId of the "applied to invoice" DEBIT row that
// justifies it (services/generalLedger.js's postOnAccountAdjustment, called
// from routes/onAccount.js's POST /apply-adjustment). A "stray" posting is
// one where that pairing has broken — its backing OnAccountLedger row is
// gone, mismatched, or was never the right shape — the exact class of bug
// already fixed once for OAId 1045 (see removeOrphanedOnAccountExcess.js).
// Trial Balance's own check only tests "does this PARTY have *some*
// Supplier/Vendor/Contractor OnAccountLedger row" — not "does this specific
// GL leg have one" — so a stray leg like this is silently excluded from the
// party's Trial Balance total as long as the party has ANY other on-account
// activity, with nothing live in OnAccountLedger actually offsetting it.
//
// Flags, per non-reversed GeneralLedgerEntry row with SourceType =
// 'OnAccountAdjustment' (grouped by its voucher, SourceId = OAId):
//   1. ORPHANED  — no dbo.OnAccountLedger row at all with that OAId.
//   2. WRONG SHAPE — the OnAccountLedger row exists but isn't a DEBIT /
//      RefType='Invoice' row (the only shape postOnAccountAdjustment is
//      ever called against).
//   3. PARTY MISMATCH — the OnAccountLedger row's PartyId differs from the
//      GL voucher's own debited party head.
//   4. AMOUNT MISMATCH — the OnAccountLedger row's Amount differs from the
//      GL voucher's debit/credit amount (both legs are checked for internal
//      consistency too).
//   5. UNBALANCED VOUCHER — the debit and credit legs of the same SourceId
//      don't match each other (should never happen; postVoucher enforces
//      balance at write time, but flags it if it's ever found).
//
// Usage: node backend/scripts/diagnoseStrayOnAccountAdjustments.js

const { connectDB, getPool, closeDB } = require("../db");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const glRes = await pool.request().query(`
    SELECT gle.SourceId AS OAId, gle.LHeadId, gle.DebitAmount, gle.CreditAmount,
           gle.VoucherNo, gle.VoucherDate, gle.CompanyId,
           ah.LHeadName, ah.LHeadType
    FROM dbo.GeneralLedgerEntry gle
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
    WHERE gle.SourceType = 'OnAccountAdjustment' AND gle.IsReversed = 0
    ORDER BY gle.SourceId, gle.DebitAmount DESC
  `);

  // Group the two legs (debit=party head, credit=pooled On Account head) by OAId.
  const byOAId = new Map();
  for (const r of glRes.recordset) {
    const g = byOAId.get(r.OAId) || { OAId: r.OAId, legs: [] };
    g.legs.push(r);
    byOAId.set(r.OAId, g);
  }

  console.log(`Found ${byOAId.size} distinct OnAccountAdjustment voucher(s) (${glRes.recordset.length} GL leg(s)) currently live in the ledger.\n`);

  const oaIds = [...byOAId.keys()];
  const oalByOAId = new Map();
  if (oaIds.length) {
    const params = oaIds.map((_, i) => `@id${i}`).join(",");
    const req = pool.request();
    oaIds.forEach((id, i) => req.input(`id${i}`, id));
    const oalRes = await req.query(`
      SELECT OAId, PartyId, PartyType, TxnType, RefType, RefDocNo, Amount
      FROM dbo.OnAccountLedger
      WHERE OAId IN (${params})
    `);
    for (const row of oalRes.recordset) oalByOAId.set(row.OAId, row);
  }

  let flagged = 0;
  for (const [oaId, g] of byOAId) {
    const debitLeg = g.legs.find((l) => Number(l.DebitAmount) > 0);
    const creditLeg = g.legs.find((l) => Number(l.CreditAmount) > 0);
    const issues = [];

    if (!debitLeg || !creditLeg) {
      issues.push(`UNBALANCED VOUCHER — only ${g.legs.length} leg(s) found for OAId ${oaId} (expected one debit + one credit).`);
    } else if (Math.abs(Number(debitLeg.DebitAmount) - Number(creditLeg.CreditAmount)) > 0.01) {
      issues.push(`UNBALANCED VOUCHER — debit ₹${fmt(debitLeg.DebitAmount)} vs credit ₹${fmt(creditLeg.CreditAmount)} don't match.`);
    }

    const oal = oalByOAId.get(oaId);
    const glAmount = Number(debitLeg?.DebitAmount) || Number(creditLeg?.CreditAmount) || 0;
    if (!oal) {
      issues.push(`ORPHANED — no dbo.OnAccountLedger row with OAId ${oaId}. Its GL leg is silently excluded from the party's Trial Balance total (if the party has other on-account activity) with nothing live offsetting it.`);
    } else {
      if (!(oal.TxnType === "DEBIT" && oal.RefType === "Invoice")) {
        issues.push(`WRONG SHAPE — OnAccountLedger OAId ${oaId} is TxnType=${oal.TxnType}, RefType=${oal.RefType} (expected DEBIT / Invoice).`);
      }
      if (debitLeg && oal.PartyId !== debitLeg.LHeadId) {
        issues.push(`PARTY MISMATCH — GL debited LHeadId ${debitLeg.LHeadId} (${debitLeg.LHeadName || "?"}), but OnAccountLedger OAId ${oaId} is for PartyId ${oal.PartyId}.`);
      }
      if (Math.abs(Number(oal.Amount) - glAmount) > 0.01) {
        issues.push(`AMOUNT MISMATCH — GL leg ₹${fmt(glAmount)} vs OnAccountLedger OAId ${oaId} Amount ₹${fmt(oal.Amount)}.`);
      }
    }

    if (issues.length) {
      flagged++;
      const party = debitLeg?.LHeadName || "?";
      console.log(`⚠ OAId ${oaId} — ${debitLeg?.VoucherNo || "?"} (${party}, ₹${fmt(glAmount)}, ${debitLeg?.VoucherDate ? new Date(debitLeg.VoucherDate).toISOString().slice(0, 10) : "?"}):`);
      for (const msg of issues) console.log(`    ${msg}`);
      console.log("");
    }
  }

  console.log(`${flagged} of ${byOAId.size} OnAccountAdjustment voucher(s) look stray.`);
  console.log("This is diagnostic only — nothing was changed. Review each OAId above (its Payment/Invoice/OnAccountLedger history) before deciding on a fix.");

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
