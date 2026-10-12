// A CRM customer's payment bounced (Finance marked its ReceivedPayment bounced
// in BRS, which reverses the cash in the GL). The CRM side must stop counting
// it: until now the booking stayed fully paid — milestones Paid, money
// "applied", handover open — on money that never arrived.
//
// Every rupee of a CRM payment first lands on account (CrmOnAccountPayment,
// SourceReceivedPaymentId = the receipt) and milestones are only ever settled
// from there (CrmPaymentReceipt rows with OnAccountPaymentId). With the
// full-booking hold, nothing counts as settled until the whole price is in, so
// once a payment bounces the booking goes back on account:
//   - every allocation on the booking is reversed by a negative row (history
//     kept — nothing is deleted), so each milestone's AmountPaid drops back;
//   - milestones reopen (Paid -> Pending, demand back to Demanded);
//   - the bounced deposit is closed out (Status 'Bounced', nothing left to use);
//   - the other deposits are free again, and settle once a replacement payment
//     brings the booking back to its full price (the usual full-payment sweep);
//   - the money receipt shows Bounced with the reason.
// Invoices already issued are reported, not touched (see `invoices` below).
// Idempotent: a deposit already Bounced is left alone.
const { sql } = require("../db");

async function unwindBouncedCrmPayment(pool, receivedPaymentId, reason, actorUserId = null) {
  const rp = (await pool.request().input("id", sql.Int, receivedPaymentId)
    .query("SELECT RPPaymentID, RPDocNo, CrmBookingId FROM dbo.ReceivedPayment WHERE RPPaymentID = @id")).recordset[0];
  if (!rp || rp.CrmBookingId == null) return { crm: false };
  const bookingId = rp.CrmBookingId;
  const deposits = (await pool.request().input("rp", sql.Int, receivedPaymentId)
    .query("SELECT Id, Amount, Status FROM dbo.CrmOnAccountPayment WHERE SourceReceivedPaymentId = @rp")).recordset;
  const live = deposits.filter((d) => d.Status !== "Bounced");
  // The deposit's own GL entry (Dr bank / Cr customer, SourceType
  // 'CrmOnAccountPayment') is what put the cash in the books — BRS's own
  // reversal only knows plain Finance receipts, so it is reversed here.
  // Idempotent (only a live posting is reversed), so a re-run also repairs
  // a bounce recorded before this existed.
  const reverseGl = async () => {
    const { hasPosting, reversePostingBySource } = require("./generalLedger");
    let n = 0;
    for (const d of deposits) {
      if (await hasPosting(pool, "CrmOnAccountPayment", d.Id)) { await reversePostingBySource(pool, "CrmOnAccountPayment", d.Id); n++; }
    }
    return n;
  };
  if (!live.length) return { crm: true, bookingId, already: deposits.length > 0, reversed: 0, glReversed: await reverseGl() };

  const note = `Reversed — payment ${rp.RPDocNo || receivedPaymentId} bounced${reason ? `: ${reason}` : ""}`.slice(0, 200);
  const tx = pool.transaction();
  await tx.begin();
  let reversed = 0;
  try {
    // Every live allocation on the booking (the hold: no part of the price
    // stays settled once the full price is no longer in).
    const allocs = (await tx.request().input("bid", sql.Int, bookingId).query(`
      SELECT r.OnAccountPaymentId, r.MilestoneId, SUM(r.Amount) AS Net, SUM(ISNULL(r.BaseAmount, 0)) AS Base, SUM(ISNULL(r.GSTAmount, 0)) AS Gst
      FROM dbo.CrmPaymentReceipt r
      JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
      WHERE m.BookingId = @bid AND r.OnAccountPaymentId IS NOT NULL
      GROUP BY r.OnAccountPaymentId, r.MilestoneId
      HAVING SUM(r.Amount) > 0.009`)).recordset;
    for (const a of allocs) {
      await tx.request()
        .input("no", sql.NVarChar(30), `REV-${receivedPaymentId}-${a.OnAccountPaymentId}-${a.MilestoneId}`.slice(0, 30))
        .input("mid", sql.Int, a.MilestoneId).input("amt", sql.Decimal(18, 2), -Number(a.Net))
        .input("base", sql.Decimal(18, 2), -Number(a.Base)).input("gst", sql.Decimal(18, 2), -Number(a.Gst))
        .input("oaid", sql.Int, a.OnAccountPaymentId).input("cb", sql.Int, actorUserId).input("note", sql.NVarChar(200), note)
        .query(`INSERT INTO dbo.CrmPaymentReceipt
                  (ReceiptNo, MilestoneId, Amount, BaseAmount, GSTAmount, ReceivedDate, PaymentMode, Notes, OnAccountPaymentId, CreatedBy, CreatedAt)
                VALUES (@no, @mid, @amt, @base, @gst, CAST(SYSDATETIME() AS DATE), 'OnAccount', @note, @oaid, @cb, SYSDATETIME())`);
      await tx.request().input("id", sql.Int, a.OnAccountPaymentId).input("amt", sql.Decimal(18, 2), Number(a.Net))
        .query(`UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = CASE WHEN AppliedAmount - @amt < 0 THEN 0 ELSE AppliedAmount - @amt END,
                  Status = CASE WHEN Status = 'Bounced' THEN Status WHEN AppliedAmount - @amt <= 0.009 THEN 'Unapplied' ELSE 'PartiallyApplied' END
                WHERE Id = @id`);
      reversed += Number(a.Net);
    }
    // Milestones reopen to what is really paid now.
    await tx.request().input("bid", sql.Int, bookingId).query(`
      UPDATE m SET
        AmountPaid = ISNULL((SELECT SUM(r.Amount) FROM dbo.CrmPaymentReceipt r WHERE r.MilestoneId = m.Id), 0),
        Status = CASE WHEN m.Status = 'Waived' THEN 'Waived'
                      WHEN ISNULL((SELECT SUM(r.Amount) FROM dbo.CrmPaymentReceipt r WHERE r.MilestoneId = m.Id), 0) >= m.AmountDue - 0.009 THEN 'Paid'
                      ELSE 'Pending' END,
        PaidDate = CASE WHEN ISNULL((SELECT SUM(r.Amount) FROM dbo.CrmPaymentReceipt r WHERE r.MilestoneId = m.Id), 0) >= m.AmountDue - 0.009 THEN m.PaidDate ELSE NULL END,
        DemandStatus = CASE WHEN m.DemandStatus = 'Paid'
                             AND ISNULL((SELECT SUM(r.Amount) FROM dbo.CrmPaymentReceipt r WHERE r.MilestoneId = m.Id), 0) < m.AmountDue - 0.009
                            THEN 'Demanded' ELSE m.DemandStatus END,
        UpdatedAt = SYSDATETIME()
      FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = @bid`);
    // The bounced deposit: nothing of it is usable.
    for (const d of live) {
      await tx.request().input("id", sql.Int, d.Id).input("n", sql.NVarChar(300), note)
        .query(`UPDATE dbo.CrmOnAccountPayment SET Status = 'Bounced', AppliedAmount = Amount,
                  Notes = ISNULL(Notes, '') + CHAR(10) + @n WHERE Id = @id`);
    }
    await tx.request().input("rp", sql.Int, receivedPaymentId).input("r", sql.NVarChar(500), (reason || "Payment bounced").slice(0, 500))
      .input("by", sql.Int, actorUserId)
      .query(`UPDATE dbo.CrmMoneyReceipt SET Status = 'Bounced', BouncedReason = @r, BouncedBy = @by, BouncedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
              WHERE ReceivedPaymentId = @rp AND Status <> 'Bounced'`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* rolled back */ }
    throw e;
  }
  const glReversed = await reverseGl();
  // Issued invoices are tax documents — reported for staff to deal with
  // (void / credit note), never silently changed here.
  const invoices = (await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT InvoiceNo FROM dbo.CrmInvoice WHERE BookingId = @bid AND Status <> 'Void'")).recordset.map((r) => r.InvoiceNo);
  return { crm: true, bookingId, reversed: Math.round(reversed * 100) / 100, invoices, glReversed };
}

module.exports = { unwindBouncedCrmPayment };
