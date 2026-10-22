// Everything about one invoice (Expense Booking): the invoice, what it posted to GL, its approvals,
// its amendments and every activity-log line that touched it — who and when, in IST.
//   node scripts/invoiceTrail.js 3270
// Read-only: it changes nothing.
const { connectDB, getPool, closeDB, sql } = require("../db");

const id = parseInt(process.argv[2], 10);
if (!Number.isFinite(id)) {
  console.error("Give the invoice id, e.g. node scripts/invoiceTrail.js 3270");
  process.exit(1);
}

const ist = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST"
    : "—";
const money = (n) => (n == null ? "" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const val = (v) => (v instanceof Date ? ist(v) : typeof v === "string" && v.length > 120 ? v.slice(0, 117) + "…" : v);
const section = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (text, bind = (r) => r) => {
    try {
      return (await bind(pool.request().input("id", sql.Int, id)).query(text)).recordset;
    } catch (e) {
      console.log(`  (not read: ${e.message})`);
      return [];
    }
  };

  // ── the invoice ──
  section(`INVOICE #${id}`);
  const inv = await q("SELECT * FROM dbo.ExpenseBooking WHERE Eid = @id");
  if (!inv.length) {
    console.log("  No invoice with that id.");
  } else {
    for (const [k, v] of Object.entries(inv[0])) if (v != null && v !== "") console.log(`  ${k.padEnd(28)} ${val(v)}`);
  }

  // ── GL posting ──
  // An invoice can carry two postings: 'ExpenseBooking' (automatic, on approval) and 'InvoicePosting'
  // (Post to GL). Post to GL reverses the automatic one and replaces it, so the vendor is credited once.
  section("POSTED TO GL");
  const gl = await q(`
    SELECT g.*, ah.LHeadName
    FROM dbo.GeneralLedgerEntry g
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = g.LHeadId
    WHERE g.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND g.SourceId = @id
    ORDER BY g.CreatedAt, g.VoucherNo, g.DebitAmount DESC`);
  if (!gl.length) console.log("  Nothing posted.");
  const groups = new Map();
  for (const g of gl) {
    const key = `${g.SourceType}|${g.VoucherNo}|${g.IsReversed ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const rows of groups.values()) {
    const g0 = rows[0];
    const label = g0.SourceType === "InvoicePosting" ? "Post to GL" : "automatic, on approval";
    console.log(`
  ${g0.SourceType} (${label})${g0.IsReversed ? "  — REVERSED, no longer counts" : "  — in force"}`);
    console.log(`  posted by ${g0.CreatedBy || "—"} at ${ist(g0.CreatedAt)} · voucher ${g0.VoucherNo || "—"} dated ${ist(g0.VoucherDate)}`);
    let dr = 0, cr = 0;
    for (const g of rows) {
      dr += Number(g.DebitAmount) || 0;
      cr += Number(g.CreditAmount) || 0;
      console.log(`    ${String(g.LHeadName || `#${g.LHeadId}`).padEnd(40)} Dr ${money(g.DebitAmount).padStart(14)}  Cr ${money(g.CreditAmount).padStart(14)}`);
    }
    console.log(`    ${"".padEnd(40)}    ${money(dr).padStart(14)}     ${money(cr).padStart(14)}${Math.abs(dr - cr) > 0.009 ? "  NOT BALANCED" : "  balanced"}`);
    if (g0.Narration) console.log(`    narration: ${g0.Narration}`);
  }

  // ── approvals ──
  section("APPROVAL HISTORY");
  const ap = await q("SELECT * FROM dbo.ApprovalAuditLog WHERE TableName = 'ExpenseBooking' AND RecordId = @id ORDER BY 1");
  if (!ap.length) console.log("  none");
  for (const a of ap) {
    const what = [a.ActionStatus, a.Level != null && `level ${a.Level}`, a.Role, a.Note].filter(Boolean).join(" · ");
    console.log(`  ${ist(a.ActionAt || a.CreatedAt)}  ${String(a.ApproverEmail || "—").padEnd(32)} ${what}`);
  }

  // ── amendments ──
  section("AMENDMENTS (changes after approval)");
  const am = await q("SELECT * FROM dbo.Amendments WHERE RefDocType = 'expense-booking' AND RefDocId = @id ORDER BY 1");
  if (!am.length) console.log("  none");
  for (const a of am) console.log(`  ${ist(a.ChangedAt || a.CreatedAt)}  ${a.ChangedBy || "—"}  ${a.Summary || a.RefDocNo || ""}`);

  // ── activity log ──
  section("ACTIVITY LOG LINES THAT TOUCHED IT");
  const act = await q(
    `SELECT CreatedAt, UserName, UserEmail, ActionType, RequestMethod, RequestUrl, IpAddress
     FROM dbo.UserActivityLog
     WHERE RequestUrl LIKE @a OR RequestUrl LIKE @b OR RequestUrl LIKE @c
     ORDER BY CreatedAt`,
    (r) => r.input("a", sql.NVarChar(200), `%/expense-booking/${id}`).input("b", sql.NVarChar(200), `%/expense-booking/${id}/%`).input("c", sql.NVarChar(200), `%/expense-booking/${id}?%`),
  );
  if (!act.length) console.log("  none");
  for (const a of act) {
    console.log(`  ${ist(a.CreatedAt)}  ${String(a.UserName || a.UserEmail || "—").padEnd(24)} ${String(a.ActionType || "").padEnd(7)} ${a.RequestMethod || ""} ${a.RequestUrl}  ${a.IpAddress || ""}`);
  }

  await closeDB?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
