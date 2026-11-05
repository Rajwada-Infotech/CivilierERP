/**
 * Payment-due reminders for Purchase Orders. A PO with a payment term (dbo.VendorPaymentTerm — usually carried over
 * from the supplier's term on the Quotation it was raised from) falls due on its vendor invoice date + the term's
 * days; until a vendor invoice date is recorded, the PO date stands in. The PO's creator is reminded through the
 * notification bell (dbo.SaNotification):
 *   - 'upcoming' once, when the due date is within REMIND_BEFORE_DAYS;
 *   - 'due' once, on the day;
 *   - 'overdue' at most once a day after that.
 * Reminders stop once the PO is paid: approved payments (dbo.NewPayment) against the bills booked on it — directly
 * or through its GRNs — reach the PO total. Draft / pending / rejected / cancelled POs are never reminded.
 * dbo.PurchaseOrderPaymentReminderLog (migration 583) keeps what was sent; DueDate is in its key, so a changed term or
 * invoice date reminds afresh.
 */
const { getPool, sql } = require("../db");
const { emitNotification } = require("./notify");
const logger = require("../logger");

const INTERVAL_MS = 60 * 60 * 1000; // hourly
const REMIND_BEFORE_DAYS = 3;

async function runPoPaymentReminderCheck() {
  const pool = getPool();
  const ready = (await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID('dbo.PurchaseOrderPaymentReminderLog', 'U') IS NOT NULL
                 AND COL_LENGTH('dbo.PurchaseOrders', 'PaymentTermId') IS NOT NULL THEN 1 ELSE 0 END AS ok
  `)).recordset[0].ok;
  if (!ready) return { scanned: 0, notified: 0 }; // migration 583 not run yet

  const hasVID = (await pool.request().query("SELECT COL_LENGTH('dbo.PurchaseOrders', 'VendorInvoiceDate') AS n")).recordset[0].n != null;
  const anchor = hasVID ? "COALESCE(po.VendorInvoiceDate, po.PODate)" : "po.PODate";

  const due = await pool.request().input("before", sql.Int, REMIND_BEFORE_DAYS).query(`
    WITH d AS (
      SELECT po.PurchaseOrderID, COALESCE(po.DocNo, po.PurchaseOrderNo) AS PONo, po.TotalAmount,
             ISNULL(ah.DisplayName, ah.LHeadName) AS SupplierName,
             pt.Description AS TermName,
             CAST(DATEADD(DAY, pt.Days, ${anchor}) AS DATE) AS DueDate,
             cu.id AS UserId
      FROM dbo.PurchaseOrders po
      JOIN dbo.VendorPaymentTerm pt ON pt.PaymentTermId = po.PaymentTermId
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
      LEFT JOIN dbo.users cu ON cu.email = po.CreatedBy
      WHERE ${anchor} IS NOT NULL
        AND ISNULL(po.Status, '') NOT IN ('', 'Draft', 'Pending', 'Rejected', 'Cancelled', 'Deleted')
    ), paid AS (
      SELECT d.PurchaseOrderID, ISNULL((
        SELECT SUM(np.PAmount) FROM dbo.NewPayment np
        WHERE np.Status = 'Approved' AND np.PExpenseRef IN (
          SELECT eb.EDocNo FROM dbo.ExpenseBooking eb
          WHERE eb.EStatus = 'Approved' AND (
            (eb.ESourceType IN ('PO', 'WO_PO') AND TRY_CAST(eb.ESourceId AS INT) = d.PurchaseOrderID)
            OR (eb.ESourceType = 'GRN' AND TRY_CAST(eb.ESourceId AS INT) IN (SELECT g.GRNID FROM dbo.GoodsReceiptNotes g WHERE g.POID = d.PurchaseOrderID))
          )
        )
      ), 0) AS PaidAmount
      FROM d
    )
    SELECT d.*, p.PaidAmount,
           DATEDIFF(DAY, CAST(SYSDATETIME() AS DATE), d.DueDate) AS DaysLeft
    FROM d JOIN paid p ON p.PurchaseOrderID = d.PurchaseOrderID
    WHERE d.DueDate <= DATEADD(DAY, @before, CAST(SYSDATETIME() AS DATE))
      AND p.PaidAmount < ISNULL(d.TotalAmount, 0) - 1
  `);

  let notified = 0;
  for (const row of due.recordset) {
    const kind = row.DaysLeft > 0 ? "upcoming" : row.DaysLeft === 0 ? "due" : "overdue";
    const sent = await pool.request()
      .input("po", sql.Int, row.PurchaseOrderID)
      .input("dd", sql.Date, row.DueDate)
      .input("kind", sql.NVarChar(20), kind)
      .query(`
        SELECT 1 AS x FROM dbo.PurchaseOrderPaymentReminderLog
        WHERE PurchaseOrderId = @po AND DueDate = @dd AND Kind = @kind
          AND (@kind <> 'overdue' OR CAST(SentAt AS DATE) = CAST(SYSDATETIME() AS DATE))
      `);
    if (sent.recordset.length) continue;

    const when = new Date(row.DueDate).toLocaleDateString("en-IN");
    const owed = Math.max(0, Number(row.TotalAmount || 0) - Number(row.PaidAmount || 0)).toLocaleString("en-IN");
    const who = `${row.PONo || `PO #${row.PurchaseOrderID}`} — ${row.SupplierName || "supplier"}`;
    const title = kind === "upcoming" ? "Supplier Payment Due Soon" : kind === "due" ? "Supplier Payment Due Today" : "Supplier Payment Overdue";
    const body = kind === "overdue"
      ? `${who}: ₹${owed} was due ${when} (${-row.DaysLeft} day(s) overdue, ${row.TermName}).`
      : kind === "due"
        ? `${who}: ₹${owed} is due today (${row.TermName}).`
        : `${who}: ₹${owed} is due on ${when}, in ${row.DaysLeft} day(s) (${row.TermName}).`;
    if (row.UserId) {
      await emitNotification(pool, row.UserId, `po_payment_${kind}`, title, body, row.PurchaseOrderID, "purchase_order");
      notified++;
    }
    // Logged even with nobody to tell, so the row isn't re-scanned every hour.
    await pool.request()
      .input("po", sql.Int, row.PurchaseOrderID)
      .input("dd", sql.Date, row.DueDate)
      .input("kind", sql.NVarChar(20), kind)
      .input("u", sql.Int, row.UserId || null)
      .query(`INSERT INTO dbo.PurchaseOrderPaymentReminderLog (PurchaseOrderId, DueDate, Kind, NotifiedUserId) VALUES (@po, @dd, @kind, @u)`);
  }
  return { scanned: due.recordset.length, notified };
}

let timer = null;
function startPoPaymentReminderEngine() {
  const run = () => {
    runPoPaymentReminderCheck()
      .then((s) => {
        if (s.scanned === 0) return;
        logger.info({ event: "PO_PAYMENT_REMINDER_DONE", ...s }, "PO payment reminder check complete");
      })
      .catch((e) => logger.error({ event: "PO_PAYMENT_REMINDER_FAILED", err: e.message }, "PO payment reminder check failed"));
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
}

module.exports = { runPoPaymentReminderCheck, startPoPaymentReminderEngine };
