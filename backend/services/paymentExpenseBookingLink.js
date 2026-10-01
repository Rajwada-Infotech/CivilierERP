/**
 * paymentExpenseBookingLink.js — shared helpers for
 * dbo.PaymentExpenseBookingLink (migration 501), which lets one NewPayment
 * settle several ExpenseBooking invoices at once ("merge invoices"), as
 * long as they share the same Company, Project and supplier.
 *
 * One row per (payment, invoice, amount) — mirrors
 * services/expenseHeadAllocation.js's pattern. A merged payment leaves
 * NewPayment.PExpenseRef NULL and is identified by having rows here
 * instead; rows are always replaced wholesale on save, never diffed.
 */

/** Coerce a raw `[{ expenseBookingId, eDocNo, allocatedAmount, tdsAmount }]`
 *  (or PascalCase) body array into a clean, validated shape. */
function normalizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      expenseBookingId: parseInt(r?.expenseBookingId ?? r?.ExpenseBookingId, 10),
      eDocNo: String(r?.eDocNo ?? r?.EDocNo ?? "").trim(),
      allocatedAmount: Math.round((Number(r?.allocatedAmount ?? r?.AllocatedAmount) || 0) * 100) / 100,
      tdsAmount: Math.round((Number(r?.tdsAmount ?? r?.TDSAmount) || 0) * 100) / 100,
    }))
    .filter((r) => Number.isInteger(r.expenseBookingId) && r.expenseBookingId > 0 && r.eDocNo && r.allocatedAmount > 0);
}

function sumLinks(links) {
  return Math.round(links.reduce((s, l) => s + l.allocatedAmount, 0) * 100) / 100;
}

/**
 * Replace every link row for one payment.
 * @param {() => import('mssql').Request} requestFactory - returns a fresh
 *   `.request()` bound to whatever pool/transaction the caller is using.
 */
async function replaceLinks(requestFactory, sql, paymentId, links) {
  await requestFactory()
    .input("PPaymentID", sql.Int, paymentId)
    .query("DELETE FROM dbo.PaymentExpenseBookingLink WHERE PPaymentID = @PPaymentID");
  for (const l of links) {
    await requestFactory()
      .input("PPaymentID", sql.Int, paymentId)
      .input("ExpenseBookingId", sql.Int, l.expenseBookingId)
      .input("EDocNo", sql.NVarChar(100), l.eDocNo)
      .input("AllocatedAmount", sql.Decimal(18, 2), l.allocatedAmount)
      .input("TDSAmount", sql.Decimal(18, 2), l.tdsAmount || 0)
      .query(`
        INSERT INTO dbo.PaymentExpenseBookingLink
          (PPaymentID, ExpenseBookingId, EDocNo, AllocatedAmount, TDSAmount)
        VALUES
          (@PPaymentID, @ExpenseBookingId, @EDocNo, @AllocatedAmount, @TDSAmount)
      `);
  }
}

/** Link rows for one payment, with the invoice's own current display fields. */
async function getLinks(pool, sql, paymentId) {
  const r = await pool.request().input("PPaymentID", sql.Int, paymentId).query(`
    SELECT l.LinkId, l.ExpenseBookingId, l.EDocNo, l.AllocatedAmount, l.TDSAmount,
           eb.EBillStatus, ISNULL(eb.ENetAmount, eb.EAmount) AS InvoiceAmount
    FROM dbo.PaymentExpenseBookingLink l
    LEFT JOIN dbo.ExpenseBooking eb ON eb.Eid = l.ExpenseBookingId
    WHERE l.PPaymentID = @PPaymentID
    ORDER BY l.LinkId
  `);
  return r.recordset.map((row) => ({
    linkId: row.LinkId,
    expenseBookingId: row.ExpenseBookingId,
    eDocNo: row.EDocNo,
    allocatedAmount: Number(row.AllocatedAmount),
    tdsAmount: Number(row.TDSAmount),
    billStatus: row.EBillStatus ?? null,
    invoiceAmount: row.InvoiceAmount != null ? Number(row.InvoiceAmount) : null,
  }));
}

/** Batch fetch for a list of payment ids at once (list-view endpoints) —
 *  returns a Map<paymentId, linkRow[]>. */
async function getLinksForMany(pool, sql, paymentIds) {
  const ids = [...new Set(paymentIds)].filter((id) => Number.isInteger(id) && id > 0);
  const map = new Map();
  if (ids.length === 0) return map;
  const req = pool.request();
  const placeholders = ids.map((id, i) => {
    req.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const r = await req.query(`
    SELECT l.PPaymentID, l.LinkId, l.ExpenseBookingId, l.EDocNo, l.AllocatedAmount, l.TDSAmount
    FROM dbo.PaymentExpenseBookingLink l
    WHERE l.PPaymentID IN (${placeholders.join(",")})
    ORDER BY l.LinkId
  `);
  for (const row of r.recordset) {
    const list = map.get(row.PPaymentID) || [];
    list.push({
      linkId: row.LinkId,
      expenseBookingId: row.ExpenseBookingId,
      eDocNo: row.EDocNo,
      allocatedAmount: Number(row.AllocatedAmount),
      tdsAmount: Number(row.TDSAmount),
    });
    map.set(row.PPaymentID, list);
  }
  return map;
}

module.exports = {
  normalizeLinks,
  sumLinks,
  replaceLinks,
  getLinks,
  getLinksForMany,
};
