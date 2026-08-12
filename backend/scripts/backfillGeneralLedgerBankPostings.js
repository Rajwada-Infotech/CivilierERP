// One-off backfill for historical bank-affecting transactions that predate
// GL posting going live (services/generalLedger.js's own header comment:
// "Posting starts capturing from 2026-06-28 — no historical backfill").
//
// Balance Enquiry (backend/routes/balanceEnquiry.js) computes a bank's
// balance and passbook entirely from dbo.GeneralLedgerEntry. Any Payment,
// Received Payment, Journal Voucher, or Fund Transfer approved BEFORE GL
// posting existed has no row there at all — so the passbook silently
// starts empty at whatever date posting happened to go live, even though
// real money moved before that.
//
// This script finds every already-Approved record of those four types that
// has no corresponding GeneralLedgerEntry row yet, and posts it by calling
// the exact same posting functions used for a live approval today
// (postPaymentApproval / postReceivedPaymentApproval /
// postJournalVoucherApproval / postFundTransferApproval) — not hand-rolled
// SQL, so the legs, GL head resolution, and idempotency guard (hasPosting)
// are identical to production behaviour. Processed oldest-first so
// VoucherDate ordering (and therefore the passbook's running balance) comes
// out correct.
//
// Dry-run by default — prints what it WOULD post without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/backfillGeneralLedgerBankPostings.js
//   node backend/scripts/backfillGeneralLedgerBankPostings.js --apply
//   node backend/scripts/backfillGeneralLedgerBankPostings.js --apply --source=payment
//   (--source is one of: payment | received-payment | journal-voucher | fund-transfer)

const { connectDB, getPool, closeDB } = require("../db");
const {
  hasPosting,
  postPaymentApproval,
  postReceivedPaymentApproval,
  postJournalVoucherApproval,
  postFundTransferApproval,
} = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");
const sourceArg = process.argv.find((a) => a.startsWith("--source="));
const ONLY_SOURCE = sourceArg ? sourceArg.split("=")[1] : null;

// Excludes demo/test seed data (PCreatedBy 'smoke-seed'/'test-seed', or a
// DocNo starting SMOKE-/TEST-) found live in dbo.NewPayment when this script
// was first run — some of those rows carry a REAL bank id (e.g. two
// TEST-PAY-* rows posting ₹100,000/₹97,800 against actual SBI/HDFC
// accounts), so backfilling them would have injected fake money into real
// bank balances. Applied to every source for defense in depth even though
// only NewPayment had any at last check.
const EXCLUDE_SEED_DATA = `
  AND ISNULL(%CREATED_BY%, '') NOT IN ('smoke-seed', 'test-seed')
  AND %DOC_NO% NOT LIKE 'SMOKE-%'
  AND %DOC_NO% NOT LIKE 'TEST-%'
`;

const SOURCES = [
  {
    key: "payment",
    label: "Payments (NewPayment)",
    sourceType: "NewPayment",
    query: `
      SELECT PPaymentID AS Id, DocNo, PDate AS Dt
      FROM dbo.NewPayment
      WHERE Status = 'Approved'
        ${EXCLUDE_SEED_DATA.replace(/%CREATED_BY%/g, "PCreatedBy").replace(/%DOC_NO%/g, "ISNULL(DocNo, '')")}
      ORDER BY PDate ASC, PPaymentID ASC
    `,
    post: postPaymentApproval,
  },
  {
    key: "received-payment",
    label: "Received Payments",
    sourceType: "ReceivedPayment",
    query: `
      SELECT RPPaymentID AS Id, DocNo, RPDocDate AS Dt
      FROM dbo.ReceivedPayment
      WHERE RPStatus = 'Approved'
        ${EXCLUDE_SEED_DATA.replace(/%CREATED_BY%/g, "RPCreatedBy").replace(/%DOC_NO%/g, "ISNULL(DocNo, '')")}
      ORDER BY RPDocDate ASC, RPPaymentID ASC
    `,
    post: postReceivedPaymentApproval,
  },
  // "journal-voucher" is deliberately NOT in the default run. A live check
  // found every currently-pending JournalVoucher row is an exact duplicate
  // (same accounts/amounts/dates) of a GL entry that already exists under
  // SourceType='GRNPosting'/'InvoicePosting' — backfilling them would
  // double-count Purchase/GST/Supplier balances. None of them touch a bank
  // account, so they don't affect Balance Enquiry either way. This needs
  // its own investigation (why do these JournalVoucher rows exist at all
  // alongside the GRNPosting/InvoicePosting entries?) before ever running
  // --source=journal-voucher.
  {
    key: "journal-voucher",
    label: "Journal Vouchers",
    sourceType: "JournalVoucher",
    excludeFromDefault: true,
    query: `
      SELECT JVID AS Id, JVNo AS DocNo, JVDate AS Dt
      FROM dbo.JournalVoucher
      WHERE Status = 'Approved'
        ${EXCLUDE_SEED_DATA.replace(/%CREATED_BY%/g, "CreatedBy").replace(/%DOC_NO%/g, "ISNULL(JVNo, '')")}
      ORDER BY JVDate ASC, JVID ASC
    `,
    post: postJournalVoucherApproval,
  },
  {
    key: "fund-transfer",
    label: "Fund Transfers",
    sourceType: "FundTransfer",
    // No CreatedBy column on dbo.FundTransfer to filter on — DocNo-prefix
    // check only.
    query: `
      SELECT FTId AS Id, DocNo, TransferDate AS Dt
      FROM dbo.FundTransfer
      WHERE Status = 'Approved'
        AND ISNULL(DocNo, '') NOT LIKE 'SMOKE-%'
        AND ISNULL(DocNo, '') NOT LIKE 'TEST-%'
      ORDER BY TransferDate ASC, FTId ASC
    `,
    post: postFundTransferApproval,
  },
];

async function main() {
  await connectDB();
  const pool = getPool();

  const sources = ONLY_SOURCE
    ? SOURCES.filter((s) => s.key === ONLY_SOURCE)
    : SOURCES.filter((s) => !s.excludeFromDefault);
  if (sources.length === 0) {
    console.log(`Unknown --source "${ONLY_SOURCE}". Valid: ${SOURCES.map((s) => s.key).join(", ")}`);
    await closeDB();
    return;
  }
  if (!ONLY_SOURCE) {
    const skipped = SOURCES.filter((s) => s.excludeFromDefault).map((s) => s.key);
    if (skipped.length) {
      console.log(`Skipping by default (needs investigation first, pass --source=<key> to force): ${skipped.join(", ")}`);
    }
  }

  const grandSummary = { posted: 0, skipped: 0, errored: 0 };

  for (const src of sources) {
    console.log(`\n=== ${src.label} ===`);
    const result = await pool.request().query(src.query);
    const rows = result.recordset;

    if (rows.length === 0) {
      console.log("No approved records found.");
      continue;
    }

    // Pre-filter to rows missing a posting — hasPosting() is cheap but this
    // avoids an unnecessary round trip per already-posted row when most of
    // the table already has GL entries (everything since 2026-06-28).
    const missing = [];
    for (const row of rows) {
      if (!(await hasPosting(pool, src.sourceType, row.Id))) missing.push(row);
    }

    console.log(`${rows.length} approved total, ${missing.length} missing a GL posting.`);
    if (missing.length === 0) continue;

    if (!APPLY) {
      for (const row of missing) {
        console.log(`  would post: ${src.sourceType} #${row.Id} (${row.DocNo || "no doc no"}, ${row.Dt ? new Date(row.Dt).toISOString().slice(0, 10) : "no date"})`);
      }
      console.log("(dry run — pass --apply to write these)");
      continue;
    }

    for (const row of missing) {
      try {
        const outcome = await src.post(pool, row.Id, "backfill-script");
        if (outcome.posted) {
          console.log(`  posted: ${src.sourceType} #${row.Id} (${row.DocNo || "no doc no"})`);
          grandSummary.posted++;
        } else {
          console.log(`  skipped: ${src.sourceType} #${row.Id} — ${outcome.reason}`);
          grandSummary.skipped++;
        }
      } catch (err) {
        console.error(`  ERROR: ${src.sourceType} #${row.Id} — ${err.message}`);
        grandSummary.errored++;
      }
    }
  }

  if (APPLY) {
    console.log(`\nDone. Posted ${grandSummary.posted}, skipped ${grandSummary.skipped}, errored ${grandSummary.errored}.`);
    if (grandSummary.errored > 0) {
      console.log("Records that errored were NOT posted — re-run the script (or re-run with --source=<type>) after investigating; already-posted records are skipped automatically via hasPosting().");
    }
  }

  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
