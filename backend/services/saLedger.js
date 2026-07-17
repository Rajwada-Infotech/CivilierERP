// backend/services/saLedger.js
//
// Connects Sales Automation commission payouts to the core Finance GL.
// Mirrors crmLedger.js's pattern exactly: a poster function guarded by
// hasPosting() for idempotency, never allowed to block the business action
// it's attached to. Before this, SaCommission.Status = 'Paid' was a dead-end
// status flag — no AP/GL entry, no traceable disbursement.

const { sql } = require("../db");
const { getGLHeadId, postVoucher, hasPosting } = require("./generalLedger");
const { CRM_COLLECTIONS_ACCOUNT } = require("./crmLedger");

const SA_COMMISSION_EXPENSE_ACCOUNT = "Sales Commission Expense";
const SA_ADVERTISING_EXPENSE_ACCOUNT = "Advertising & Marketing Expense";
const PROVISIONAL_CREDIT_ACCOUNT = "Provisional Credit Available";

/**
 * A commission being marked Paid — real cash paid out to salesperson,
 * team lead, and/or channel partner on a single booking.
 *   Dr Sales Commission Expense ... company incurs the cost
 *   Cr CRM Collections A/c ........ cash leaves (same cash proxy already
 *                                    used for CRM brokerage payouts and
 *                                    cancellation refunds)
 *
 * One leg per non-zero recipient amount so the narration names who was
 * actually paid, even though all legs share the same expense head.
 */
async function postSaCommissionToGL(pool, commissionId, userEmail) {
  if (await hasPosting(pool, "SaCommission", commissionId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, commissionId).query(`
    SELECT c.Id, c.BookingId, c.SpAmount, c.TlAmount, c.CpAmount, c.PaidAt,
           sp.name AS SalespersonName, tl.name AS TeamLeadName, cp.Name AS ChannelPartnerName,
           b.CompanyId, b.ProjectId
    FROM dbo.SaCommission c
    LEFT JOIN dbo.Users sp ON sp.id = c.SalespersonId
    LEFT JOIN dbo.Users tl ON tl.id = c.TeamLeadId
    LEFT JOIN dbo.SaChannelPartner cp ON cp.Id = c.ChannelPartnerId
    LEFT JOIN dbo.CrmBooking b ON b.Id = c.BookingId
    WHERE c.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `SaCommission ${commissionId} not found` };

  const spAmount = Number(row.SpAmount) || 0;
  const tlAmount = Number(row.TlAmount) || 0;
  const cpAmount = Number(row.CpAmount) || 0;
  const total = Math.round((spAmount + tlAmount + cpAmount) * 100) / 100;
  if (total <= 0) return { none: true, reason: `Commission ${commissionId} has no amount to pay` };

  const expenseHeadId = await getGLHeadId(pool, SA_COMMISSION_EXPENSE_ACCOUNT);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const docNo = `SACOMM-${commissionId}`;
  const voucherDate = row.PaidAt || new Date();

  const legs = [];
  if (spAmount > 0) legs.push({ lHeadId: expenseHeadId, debit: spAmount, narration: `${docNo} — commission paid to ${row.SalespersonName || "salesperson"} (SP)` });
  if (tlAmount > 0) legs.push({ lHeadId: expenseHeadId, debit: tlAmount, narration: `${docNo} — commission paid to ${row.TeamLeadName || "team lead"} (TL)` });
  if (cpAmount > 0) legs.push({ lHeadId: expenseHeadId, debit: cpAmount, narration: `${docNo} — commission paid to ${row.ChannelPartnerName || "channel partner"} (CP)` });
  legs.push({ lHeadId: collectionsHeadId, credit: total, narration: `${docNo} — sales commission paid` });

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate,
    sourceType: "SaCommission",
    sourceId: commissionId,
    companyId: row.CompanyId ?? null,
    projectId: row.ProjectId ?? null,
    createdBy: userEmail,
    legs,
  });
  return { posted: true };
}

/**
 * A marketing/ad-platform vendor invoice being paid — real cash paid to an
 * external vendor for ad spend. Previously PaymentStatus was just a free
 * field on SaMarketingInvoice with no AP/GL linkage at all.
 *   Dr Advertising & Marketing Expense ... base spend, company incurs the cost
 *   Dr Provisional Credit Available ...... GST on the invoice (input tax
 *                                           credit — same account GRN/Expense
 *                                           Booking already use, not folded
 *                                           into the expense line)
 *   Cr CRM Collections A/c ................ cash leaves
 */
async function postSaMarketingInvoiceToGL(pool, invoiceId, userEmail) {
  if (await hasPosting(pool, "SaMarketingInvoice", invoiceId))
    return { posted: true, reason: "already posted (idempotent)" };

  const r = await pool.request().input("id", sql.Int, invoiceId).query(`
    SELECT i.Id, i.InvoiceNumber, i.VendorName, i.InvoiceDate, i.Amount, i.GstAmount, i.TotalAmount
    FROM dbo.SaMarketingInvoice i
    WHERE i.Id = @id
  `);
  const row = r.recordset[0];
  if (!row) return { posted: false, reason: `SaMarketingInvoice ${invoiceId} not found` };

  const baseAmount = Number(row.Amount) || 0;
  const gstAmount = Number(row.GstAmount) || 0;
  const total = Math.round((baseAmount + gstAmount) * 100) / 100;
  if (total <= 0) return { none: true, reason: `Invoice ${invoiceId} has no amount to pay` };

  const expenseHeadId = await getGLHeadId(pool, SA_ADVERTISING_EXPENSE_ACCOUNT);
  const collectionsHeadId = await getGLHeadId(pool, CRM_COLLECTIONS_ACCOUNT);
  const docNo = row.InvoiceNumber || `SAINV-${invoiceId}`;

  const legs = [
    { lHeadId: expenseHeadId, debit: baseAmount, narration: `${docNo} — ad spend paid to ${row.VendorName || "vendor"}` },
  ];
  if (gstAmount > 0) {
    const creditHeadId = await getGLHeadId(pool, PROVISIONAL_CREDIT_ACCOUNT);
    legs.push({ lHeadId: creditHeadId, debit: gstAmount, narration: `${docNo} — GST input credit` });
  }
  legs.push({ lHeadId: collectionsHeadId, credit: total, narration: `${docNo} — marketing invoice paid (${row.VendorName || "vendor"})` });

  await postVoucher(pool, {
    voucherNo: docNo,
    voucherDate: row.InvoiceDate || new Date(),
    sourceType: "SaMarketingInvoice",
    sourceId: invoiceId,
    companyId: null,
    projectId: null,
    createdBy: userEmail,
    legs,
  });
  return { posted: true };
}

module.exports = {
  SA_COMMISSION_EXPENSE_ACCOUNT,
  SA_ADVERTISING_EXPENSE_ACCOUNT,
  postSaCommissionToGL,
  postSaMarketingInvoiceToGL,
};
