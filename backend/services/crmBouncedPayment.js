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
  const tx = pool.transaction();
  await tx.begin();
  try {
  // Serialize bounce retries on the source receipt before reading deposits or
  // allocations. Concurrent requests then observe the first transaction's
  // Bounced statuses instead of inserting a second set of reversal rows.
  const rp = (await tx.request().input("id", sql.Int, receivedPaymentId)
    .query("SELECT RPPaymentID, RPDocNo, CrmBookingId FROM dbo.ReceivedPayment WITH (UPDLOCK, HOLDLOCK) WHERE RPPaymentID = @id")).recordset[0];
  if (!rp || rp.CrmBookingId == null) {
    await tx.commit();
    return { crm: false };
  }
  const bookingId = rp.CrmBookingId;
  // Use the same booking-level mutex as on-account application. This unwind
  // reverses allocations across the whole booking, including deposits other
  // than the one that bounced.
  await tx.request().input("bid", sql.Int, bookingId).query(`
    SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid
  `);
  const deposits = (await tx.request().input("rp", sql.Int, receivedPaymentId)
    .query("SELECT Id, Amount, Status FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE SourceReceivedPaymentId = @rp")).recordset;
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
  if (!live.length) {
    await tx.commit();
    return { crm: true, bookingId, already: deposits.length > 0, reversed: 0, glReversed: await reverseGl() };
  }

  const note = `Reversed — payment ${rp.RPDocNo || receivedPaymentId} bounced${reason ? `: ${reason}` : ""}`.slice(0, 200);
  let reversed = 0;
  let afterChange = null;
    // Every live allocation on the booking goes back on account (the hold: no part of the price
    // stays settled once the full price is no longer in) and the milestones reopen.
    const unwound = await require("./crmOnAccountCoverage").unapplyBookingAllocations(tx, bookingId, {
      actorUserId, note, receiptNo: (a) => `REV-${receivedPaymentId}-${a.OnAccountPaymentId}-${a.MilestoneId}`,
    });
    const allocs = unwound.allocs;
    reversed += unwound.amount;
    // The bounced deposit: nothing of it is usable.
    for (const d of live) {
      await tx.request().input("id", sql.Int, d.Id).input("n", sql.NVarChar(300), note)
        .query(`UPDATE dbo.CrmOnAccountPayment SET Status = 'Bounced', AppliedAmount = Amount,
                  Notes = ISNULL(Notes, '') + CHAR(10) + @n WHERE Id = @id`);
    }
    // Finance's on-account figure follows: other deposits got their share back,
    // the bounced one is worth nothing.
    const touched = new Set([...allocs.map((x) => x.OnAccountPaymentId), ...live.map((d) => d.Id)]);
    // The booking's unit was changed after this money arrived: it had moved to the new booking, so it comes off there.
    afterChange = await require("./crmEntityCreation").bounceAfterUnitChange(tx, {
      bookingId, amount: live.reduce((n, d) => n + Number(d.Amount || 0), 0), note, actorUserId,
    });
    for (const oaId of touched) {
      await require("./crmLedger").syncCrmOnAccountLedger(tx, oaId, "system", note, { onlyDown: false });
    }
    await tx.request().input("rp", sql.Int, receivedPaymentId).input("r", sql.NVarChar(500), (reason || "Payment bounced").slice(0, 500))
      .input("by", sql.Int, actorUserId)
      .query(`UPDATE dbo.CrmMoneyReceipt SET Status = 'Bounced', BouncedReason = @r, BouncedBy = @by, BouncedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
              WHERE ReceivedPaymentId = @rp AND Status <> 'Bounced'`);
    await tx.commit();
  const glReversed = await reverseGl();
  // The new booking settles again on what is really in (the full-booking hold).
  if (afterChange?.targetBookingId) await require("../routes/crmPayments").autoApplyOnAccountIfFullyFunded(pool, afterChange.targetBookingId, actorUserId, "system");
  // Issued invoices stay as they are: a bounced payment doesn't cancel the
  // sale — the customer still owes it, so no credit note (GST s.34 needs a
  // cancelled / reduced supply). Listed for reference only. A credit note
  // comes only when money is given back (services/crmGstNotes.js).
  const invoices = (await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT InvoiceNo FROM dbo.CrmInvoice WHERE BookingId = @bid AND Status <> 'Void'")).recordset.map((r) => r.InvoiceNo);
  return { crm: true, bookingId, reversed: Math.round(reversed * 100) / 100, invoices, glReversed };
  } catch (e) {
    try { await tx.rollback(); } catch { /* rolled back or already committed */ }
    throw e;
  }
}

module.exports = { unwindBouncedCrmPayment };
