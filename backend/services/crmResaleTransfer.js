// Resale by ENDORSEMENT — a sold property passing from its buyer to a new
// buyer. Nothing is cancelled or re-sold: the seller's booking itself passes
// to the new buyer, so its price, milestones, receipts, invoices and the money
// already paid all stay with the property and the new buyer continues the
// remaining schedule. A plot with the villa built on it moves as one property
// (both bookings together, services/villaLand.js propertyOfBooking).
//
// What changes on completion:
//   - a new application for the buyer, Converted, carrying the same unit/plot
//     lines; each moving booking points at it (so every screen, statement and
//     ledger now reads the buyer through the booking's application)
//   - the seller's application lines become 'Transferred'
//   - the seller's co-applicants on the booking are retired
//   - money paid so far moves from the seller's ledger to the buyer's
//     (Dr seller / Cr buyer), so the advance follows its property
// What the two buyers agreed between themselves is recorded only — it is
// never developer income. The developer's transfer fee is charged to the buyer.
const { sql } = require("../db");
const { REFUND_CLOSED_SQL } = require("../constants/crmStatuses");

class ResaleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const LIVE = "b.IsActive = 1 AND b.Status NOT IN " + require("../constants/crmStatuses").DEAD_BOOKING_SQL;

/** The live bookings that move together with this one (itself first if alone). */
async function movingBookings(db, bookingId) {
  const { propertyOfBooking } = require("./villaLand");
  const p = await propertyOfBooking(db, bookingId);
  const ids = p.bookings.map((b) => b.Id);
  if (!ids.length) return [];
  const req = db.request();
  ids.forEach((id, i) => req.input(`bid${i}`, sql.Int, id));
  const inList = ids.map((_, i) => `@bid${i}`).join(",");
  return (await req.query(`
    SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.TotalValue, b.Status, b.ApplicationId, a.CustomerId,
           (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
             + (SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND Amount > ISNULL(AppliedAmount, 0)
               THEN Amount - ISNULL(AppliedAmount, 0) ELSE 0 END), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${inList}) AND ${LIVE}`)).recordset;
}

/**
 * A resale / buy-back moves a booking that is still the developer's to move.
 * Once the property is conveyed — its sale deed registered — it belongs to
 * the buyer outright; selling it on is a private sale between owners (an
 * Ownership Change), outside the developer's booking. A handover alone does
 * not convey it (business decision 2026-10-14): until the sale deed is
 * registered the booking can still change hands. Returns the reason, or null.
 */
async function conveyedReason(db, bookingIds) {
  const ids = (bookingIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return null;
  const req = db.request();
  ids.forEach((id, i) => req.input(`cid${i}`, sql.Int, id));
  const inList = ids.map((_, i) => `@cid${i}`).join(",");
  const r = (await req.query(`
    SELECT TOP 1 b.BookingNo, N'its sale deed is registered' AS Why
    FROM dbo.CrmBooking b
    WHERE b.Id IN (${inList})
      AND EXISTS (SELECT 1 FROM dbo.CrmSalesDeed d WHERE d.BookingId = b.Id AND d.Status = N'Registered')`)).recordset[0];
  return r ? `${r.BookingNo}: ${r.Why} — the property is conveyed to its owner, so it can no longer be resold or bought back through its booking — record a new owner in Ownership Changes instead` : null;
}

/** The plots a case sells (CrmUnitResale.PlotIds, migration 691); [] = the whole booking. */
const casePlotIds = (r) => [...new Set(String(r?.PlotIds || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** SQL for what a case sells, by name: its plots when it names some, else the booking's property. */
const resalePropertySql = (r = "r", b = "b") => `COALESCE((SELECT STRING_AGG(rpp.PlotName, N', ') FROM dbo.PlotMaster rpp
    WHERE N',' + ${r}.PlotIds + N',' LIKE N'%,' + CAST(rpp.Id AS NVARCHAR(20)) + N',%'), ${b}.UnitNo, ${b}.BookingNo)`;

/**
 * An open resale or buy-back already on any of these bookings (being prepared, waiting, approved, or sent back to fix).
 * With plotIds, only a case that takes one of those plots (or the whole booking) stands in the way: two cases may
 * sell different plots of one booking.
 */
async function openResaleOn(db, bookingIds, exceptId = null, plotIds = []) {
  if (!bookingIds.length) return null;
  const req = db.request();
  bookingIds.forEach((id, i) => req.input(`oid${i}`, sql.Int, Number(id)));
  const likes = bookingIds.map((_, i) => `(',' + ISNULL(r.BookingIds, CAST(r.FromBookingId AS NVARCHAR(20))) + ',') LIKE '%,' + CAST(@oid${i} AS NVARCHAR(20)) + ',%'`).join(" OR ");
  const exceptClause = exceptId != null ? ` AND r.Id <> @exceptId` : "";
  if (exceptId != null) req.input("exceptId", sql.Int, Number(exceptId));
  const plots = (plotIds || []).map(Number).filter(Number.isInteger);
  plots.forEach((p, i) => req.input(`opl${i}`, sql.Int, p));
  const plotClause = plots.length
    ? ` AND (r.PlotIds IS NULL OR ${plots.map((_, i) => `(N',' + r.PlotIds + N',') LIKE N'%,' + CAST(@opl${i} AS NVARCHAR(20)) + N',%'`).join(" OR ")})`
    : "";
  return (await req.query(`
    SELECT TOP 1 r.Id, r.Kind, r.Status FROM dbo.CrmUnitResale r
    WHERE r.IsActive = 1 AND r.Status IN (N'Draft', N'Pending', N'Approved', N'Rejected') AND (${likes})${exceptClause}${plotClause}`)).recordset[0] || null;
}

/**
 * Sells some plots of a multi-plot booking: what a part-plot case has to have done before its transfer. The sold
 * plots' share of every sale invoice already issued on the booking (only possible once it was fully paid) must be
 * taken off it by a credit note (or the invoice voided), or the buyer's booking would be invoiced for it again.
 * Returns { ratio, invoices: [{ InvoiceNo, Amount, Credited, Short }] } — Short > 0 where a credit note is still due.
 */
async function partPlotInvoiceCheck(db, bookingId, plotIds) {
  const plots = (plotIds || []).map(Number).filter(Number.isInteger);
  if (!plots.length || !bookingId) return { ratio: 0, invoices: [] };
  const req = db.request().input("b", sql.Int, bookingId);
  plots.forEach((p, i) => req.input(`ip${i}`, sql.Int, p));
  const v = (await req.query(`
    SELECT ISNULL(SUM(AllocatedValue), 0) AS AllValue,
           ISNULL(SUM(CASE WHEN PlotId IN (${plots.map((_, i) => `@ip${i}`).join(",")}) THEN AllocatedValue ELSE 0 END), 0) AS SoldValue
    FROM dbo.CrmBookingPlot WHERE BookingId = @b AND Status = N'Active'`)).recordset[0];
  const ratio = Number(v.AllValue) > 0 ? Number(v.SoldValue) / Number(v.AllValue) : 0;
  if (!(ratio > 0) || ratio >= 1) return { ratio, invoices: [] };
  const invoices = (await db.request().input("b", sql.Int, bookingId).query(`
    SELECT i.InvoiceNo, i.Amount,
           ISNULL((SELECT SUM(n.TotalAmount) FROM dbo.CrmGstNote n WHERE n.InvoiceId = i.Id AND n.Status IN (N'Issued', N'TimeBarred')), 0) AS Credited
    FROM dbo.CrmInvoice i
    WHERE i.BookingId = @b AND i.Status <> N'Void' AND i.InvoiceType IN (N'Milestone', N'Booking', N'Final')
    ORDER BY i.Id`)).recordset.map((i) => ({
    ...i, Short: Math.max(0, Math.round((Number(i.Amount) * ratio - Number(i.Credited)) * 100) / 100),
  }));
  return { ratio, invoices };
}

/** Inserts a copy of one row of a table (every column but its identity), with some columns set. Returns the new Id. */
async function copyRow(tx, table, id, set) {
  const cols = (await tx.request().input("t", sql.NVarChar(128), table).query(`
    SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.' + @t) AND c.is_identity = 0 AND c.is_computed = 0
    ORDER BY c.column_id`)).recordset.map((c) => c.name);
  const req = tx.request().input("src", sql.Int, id);
  const pick = cols.map((c, i) => {
    if (!Object.prototype.hasOwnProperty.call(set, c)) return `[${c}]`;
    req.input(`v${i}`, set[c]);
    return `@v${i}`;
  });
  return (await req.query(`INSERT INTO dbo.[${table}] (${cols.map((c) => `[${c}]`).join(", ")}) OUTPUT INSERTED.Id
    SELECT ${pick.join(", ")} FROM dbo.[${table}] WHERE Id = @src`)).recordset[0].Id;
}

/**
 * A part-plot resale (the case names some of the booking's plots): the sold plots leave the seller's booking for a
 * new booking, at their own booked prices (CrmBookingPlot.AllocatedValue — never re-priced), and the money paid so far
 * is shared by those prices. Inside the caller's transaction; the new booking is still the seller's here — the caller
 * passes it to the buyer like any resold booking. Returns null when the case names every plot left on the booking
 * (then the whole booking is resold as it is), else { bookingId, bookingNo, moved }.
 *   - the schedule: every milestone of the sale (not parking / extra charges, which stay with the seller) is shared
 *     by the plots' prices; the buyer's copies start un-demanded;
 *   - money settled on milestones goes back on account first (the full-booking hold: it settles again once each
 *     booking's own price is in), then the sold plots' share of what is on account moves to the new booking.
 */
async function carvePlotsForResale(tx, resale, actorUserId, actorEmail = "system") {
  const plotIds = casePlotIds(resale);
  if (!plotIds.length) return null;
  const sellerId = Number(resale.FromBookingId);
  const lines = (await tx.request().input("b", sql.Int, sellerId).query(`
    SELECT bp.Id, bp.PlotId, bp.AreaSqFt, bp.AllocatedValue, bp.IsPrimary, p.PlotName
    FROM dbo.CrmBookingPlot bp WITH (UPDLOCK, HOLDLOCK) JOIN dbo.PlotMaster p ON p.Id = bp.PlotId
    WHERE bp.BookingId = @b AND bp.Status = N'Active' ORDER BY bp.IsPrimary DESC, bp.Id`)).recordset;
  const sold = lines.filter((l) => plotIds.includes(l.PlotId));
  if (sold.length !== plotIds.length) throw new ResaleError("A plot on this case is no longer on the seller's booking — refresh the case", 409);
  if (sold.length === lines.length) return null;
  const kept = lines.filter((l) => !plotIds.includes(l.PlotId));
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const sum = (rows, k) => r2(rows.reduce((t, x) => t + Number(x[k] || 0), 0));
  const allValue = sum(lines, "AllocatedValue");
  const soldValue = sum(sold, "AllocatedValue");
  if (!(allValue > 0) || !(soldValue > 0)) throw new ResaleError("The plots on this booking carry no price — set the booking's price first", 409);
  const ratio = soldValue / allValue;
  const short = (await partPlotInvoiceCheck(tx, sellerId, plotIds)).invoices.filter((i) => i.Short > 0.009);
  if (short.length) throw new ResaleError(`Issue a credit note for the sold plots' share first: ${short.map((i) => i.InvoiceNo).join(", ")}`, 409);
  const bk = (await tx.request().input("b", sql.Int, sellerId).query("SELECT * FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @b")).recordset[0];
  const note = `Resale #${resale.Id}: ${sold.map((l) => l.PlotName).join(", ")} sold on`;

  // Settled money back on account (as a unit change does), so it can be shared.
  const { unapplyBookingAllocations } = require("./crmOnAccountCoverage");
  const { syncCrmOnAccountLedger, postCrmHeldCreditReallocateLedgerOnly } = require("./crmLedger");
  const unwound = await unapplyBookingAllocations(tx, sellerId, {
    actorUserId, note, receiptNo: (a) => `RSL-${resale.Id}-${a.OnAccountPaymentId}-${a.MilestoneId}`,
  });
  for (const oaId of new Set(unwound.allocs.map((a) => a.OnAccountPaymentId))) {
    await syncCrmOnAccountLedger(tx, oaId, actorEmail, note, { onlyDown: false });
  }

  // The new booking: the seller's, for the sold plots only (passed to the buyer by the caller).
  const { getNextDocNumber } = require("./docNumber");
  const bookingNo = await getNextDocNumber(require("../db").getPool(), "BKG", "BKG");
  const share = (n) => (n == null ? null : r2(Number(n) * ratio));
  const soldArea = sum(sold, "AreaSqFt");
  const sellerBookingAmount = r2(Number(bk.BookingAmount || 0) - share(bk.BookingAmount));
  const scaled = ["LandValue", "UnitGstAmount", "TotalGstAmount", "UnitParkingGstAmount"];
  const newId = await copyRow(tx, "CrmBooking", sellerId, {
    BookingNo: bookingNo, UnitNo: sold.map((l) => l.PlotName).join(", "), AreaSqFt: soldArea,
    TotalValue: soldValue, GrandTotal: soldValue, ParkingTotal: 0, ExtraChargesTotal: 0, ParkingGstAmount: 0, ExtraWorkGstAmount: 0,
    BookingAmount: share(bk.BookingAmount), TokenValue: null, CreditNoteTotal: 0, CreditNoteGst: 0,
    // The developer's sale stays the seller's: brokerage is not earned again on a resale.
    BrokerId: null, BrokerageRatePercent: null,
    ...Object.fromEntries(scaled.map((c) => [c, share(bk[c])])),
    Notes: `${note} — split from ${bk.BookingNo}.`, CreatedBy: actorUserId ?? null, CreatedAt: new Date(), UpdatedBy: null, UpdatedAt: null,
  });
  await tx.request().input("n", sql.Int, newId).input("b", sql.Int, sellerId).input("by", sql.Int, actorUserId ?? null)
    .input("first", sql.Int, sold[0].Id)
    .query(`UPDATE dbo.CrmBookingPlot SET BookingId = @n, IsPrimary = CASE WHEN Id = @first THEN 1 ELSE 0 END
            WHERE BookingId = @b AND Status = N'Active' AND PlotId IN (${plotIds.join(",")});
            UPDATE dbo.CrmBookingPlot SET IsPrimary = CASE WHEN Id = ${Number(kept[0].Id)} THEN 1 ELSE 0 END
            WHERE BookingId = @b AND Status = N'Active'`);
  const keep = (c) => (bk[c] == null ? null : r2(Number(bk[c]) - share(bk[c])));
  const sReq = tx.request().input("b", sql.Int, sellerId).input("by", sql.Int, actorUserId ?? null)
    .input("unit", sql.NVarChar(100), kept.map((l) => l.PlotName).join(", "))
    .input("area", sql.Decimal(18, 2), r2(Number(bk.AreaSqFt || 0) - soldArea))
    .input("sold", sql.Decimal(18, 2), soldValue).input("ba", sql.Decimal(18, 2), sellerBookingAmount);
  scaled.forEach((c) => sReq.input(c, sql.Decimal(18, 2), keep(c)));
  await sReq.query(`UPDATE dbo.CrmBooking SET UnitNo = @unit, AreaSqFt = @area, TotalValue = TotalValue - @sold, GrandTotal = GrandTotal - @sold,
      BookingAmount = @ba, ${scaled.map((c) => `${c} = @${c}`).join(", ")}, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b`);

  // The schedule, shared by the plots' prices: the buyer's part of each milestone, the seller's the rest.
  const { apportion } = require("./bookingUnits");
  const ms = (await tx.request().input("b", sql.Int, sellerId).query(`
    SELECT Id, AmountDue, Status FROM dbo.CrmPaymentMilestone WITH (UPDLOCK, HOLDLOCK)
    WHERE BookingId = @b AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL ORDER BY MilestoneNo, Id`)).recordset;
  const scheduleSum = sum(ms, "AmountDue");
  const buyerTotal = Math.abs(scheduleSum - allValue) < 0.01 ? soldValue : r2(scheduleSum * ratio);
  const parts = apportion(buyerTotal, ms.map((m) => Number(m.AmountDue)));
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    await copyRow(tx, "CrmPaymentMilestone", m.Id, {
      BookingId: newId, AmountDue: parts[i], AmountPaid: 0, PaidDate: null, PaymentMode: null, TransactionRef: null,
      Status: m.Status === "Waived" ? "Waived" : "Pending", DemandRaisedAt: null, DemandStatus: "Pending", DemandNo: null,
      DemandRaisedOn: null, DemandNotes: null, DepositBankId: null, DepositBankName: null,
      CreatedBy: actorUserId ?? null, CreatedAt: new Date(), UpdatedBy: null, UpdatedAt: null,
    });
    await tx.request().input("id", sql.Int, m.Id).input("p", sql.Decimal(18, 2), parts[i]).input("by", sql.Int, actorUserId ?? null)
      .query("UPDATE dbo.CrmPaymentMilestone SET AmountDue = AmountDue - @p, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  }

  // The sold plots' share of the money on account moves to the new booking: taken off the seller's deposits
  // (newest first) and given to the new booking as one deposit. The ledger's customer move (seller -> buyer) is
  // the resale's own transfer voucher (postCrmResaleTransferToGL, by PaidAtTransfer).
  const { onAccountWithAvailableSql } = require("./crmPaymentFunding");
  const deposits = (await tx.request().input("b", sql.Int, sellerId).query(`
    SELECT o.Id, o.AvailableAmount FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = @b AND o.AvailableAmount > 0.009 ORDER BY o.Id DESC`)).recordset;
  const available = sum(deposits, "AvailableAmount");
  const moved = r2(available * ratio);
  let left = moved;
  for (const d of deposits) {
    if (!(left > 0.009)) break;
    const take = Math.min(left, r2(d.AvailableAmount));
    await tx.request().input("id", sql.Int, d.Id).input("t", sql.Decimal(18, 2), take).input("n", sql.NVarChar(300), `${note} — ₹${take} moved to ${bookingNo}`)
      .query(`UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = ISNULL(AppliedAmount, 0) + @t,
                Status = CASE WHEN ISNULL(AppliedAmount, 0) + @t >= Amount - 0.009 THEN 'Applied' ELSE 'PartiallyApplied' END,
                Notes = LTRIM(ISNULL(Notes, N'') + CHAR(10) + @n) WHERE Id = @id`);
    await syncCrmOnAccountLedger(tx, d.Id, actorEmail, note, { onlyDown: false });
    left = r2(left - take);
  }
  if (moved > 0.009) {
    const receiptNo = `RSL-${resale.Id}`;
    const oaId = (await tx.request().input("no", sql.NVarChar(30), receiptNo).input("b", sql.Int, newId).input("amt", sql.Decimal(18, 2), moved)
      .input("from", sql.Int, sellerId).input("rid", sql.Int, resale.Id).input("by", sql.Int, actorUserId ?? null)
      .input("n", sql.NVarChar(300), `${note}: its share of the money paid on ${bk.BookingNo}.`)
      .query(`INSERT INTO dbo.CrmOnAccountPayment (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode, Notes,
                HeldFromBookingId, HeldSourceType, HeldSourceRefId, CreatedBy, CreatedAt)
              OUTPUT INSERTED.Id
              VALUES (@no, @b, @amt, 0, 'Unapplied', CAST(SYSDATETIME() AS DATE), 'ResaleCredit', @n, @from, N'Resale', @rid, @by, SYSDATETIME())`)).recordset[0].Id;
    // Tracked on the buyer's on-account ledger once the deposit is theirs (the booking passes to them next).
    await postCrmHeldCreditReallocateLedgerOnly(require("../db").getPool(), {
      customerId: resale.ToCustomerId, newOnAccountId: oaId, amount: moved, companyId: bk.CompanyId, projectId: bk.ProjectId,
      receiptNo, userEmail: actorEmail, executor: tx, notes: `${note}: share of the money paid on ${bk.BookingNo}`,
    });
  }
  return { bookingId: newId, bookingNo, moved, soldValue };
}

/**
 * Passes one booking to another customer, inside the caller's transaction:
 * the new person's application (the one given, or a new Converted one) takes
 * the booking and its unit / plot lines; the old owner's co-applicants, home
 * loan (closed), bank details (back on their own application) and financing
 * type stay behind as their history. Used by a resale (before conveyance) and
 * by an ownership change (after it). Returns the new application's id.
 * `b` is the booking row (Id, BookingNo, UnitId, UnitNo, ProjectId, CompanyId,
 * ApplicationId, InterestedProject, InterestedUnit, PaymentPlanId).
 */
async function moveBookingToCustomer(tx, b, person, { applicationId = null, actorUserId, note, loanNote, plotIds = null }) {
  // plotIds: a booking split off for a part-plot resale (carvePlotsForResale). Only those plots' application lines
  // move, and the old owner's application keeps its co-applicants: it still holds the rest of their booking.
  const part = Array.isArray(plotIds) && plotIds.length ? plotIds.map(Number).filter(Number.isInteger) : null;
  let appId = applicationId;
  if (appId) {
    await tx.request().input("a", sql.Int, appId).input("uid", sql.Int, b.UnitId).input("pid", sql.Int, b.ProjectId).input("co", sql.Int, b.CompanyId)
      .input("pp", sql.Int, b.PaymentPlanId || null).input("ref", sql.Int, b.ApplicationId)
      .query(`UPDATE dbo.CrmApplication SET Status = N'Converted', PreferredUnitId = @uid, ProjectId = ISNULL(ProjectId, @pid), CompanyId = ISNULL(CompanyId, @co),
                PaymentPlanId = @pp, ReferredByApplicationId = @ref, UpdatedAt = SYSDATETIME() WHERE Id = @a`);
  } else {
    const { getNextDocNumber } = require("./docNumber");
    const appNo = await getNextDocNumber(require("../db").getPool(), "APP", "APP");
    const app = await tx.request()
      .input("no", sql.NVarChar(50), appNo).input("cid", sql.Int, person.Id)
      .input("name", sql.NVarChar(200), person.CustomerName).input("mob", sql.NVarChar(20), person.Mobile || null)
      .input("em", sql.NVarChar(200), person.Email || null).input("pid", sql.Int, b.ProjectId).input("co", sql.Int, b.CompanyId)
      .input("uid", sql.Int, b.UnitId).input("proj", sql.NVarChar(200), b.InterestedProject || null)
      .input("unit", sql.NVarChar(200), b.UnitNo || b.InterestedUnit || null).input("pp", sql.Int, b.PaymentPlanId || null)
      .input("ref", sql.Int, b.ApplicationId).input("by", sql.Int, actorUserId)
      .input("note", sql.NVarChar(sql.MAX), note)
      .query(`INSERT INTO dbo.CrmApplication (ApplicationNo, CustomerId, ApplicantName, Mobile, Email, ProjectId, CompanyId, PreferredUnitId,
                InterestedProject, InterestedUnit, PaymentPlanId, Source, Status, Notes, ReferredByApplicationId, DateOfApply, IsActive, CreatedBy, CreatedAt, AssignedTo, AssignedBy)
              OUTPUT INSERTED.Id
              VALUES (@no, @cid, @name, @mob, @em, @pid, @co, @uid, @proj, @unit, @pp, N'Other', N'Converted', @note, @ref, CAST(SYSDATETIME() AS DATE), 1, @by, SYSDATETIME(), @by, @by)`);
    appId = app.recordset[0].Id;
  }
  // One Active application line per unit / plot: the old owner's goes first.
  for (const t of part ? [["CrmApplicationPlot", "PlotId"]] : [["CrmApplicationUnit", "UnitId"], ["CrmApplicationPlot", "PlotId"]]) {
    const only = part ? ` AND ${t[1]} IN (${part.join(",")})` : "";
    const lines = (await tx.request().input("a", sql.Int, b.ApplicationId)
      .query(`SELECT ${t[1]} AS Ref, IsPrimary FROM dbo.${t[0]} WHERE ApplicationId = @a AND Status = N'Active'${only} ORDER BY IsPrimary DESC, Id`)).recordset;
    await tx.request().input("a", sql.Int, b.ApplicationId)
      .query(`UPDATE dbo.${t[0]} SET Status = N'Transferred' WHERE ApplicationId = @a AND Status = N'Active'${only}`);
    if (part && lines.length && !lines.some((l) => l.IsPrimary)) {
      // The old owner's main plot stays theirs: the first plot sold leads the buyer's lines.
      lines[0].IsPrimary = true;
    }
    if (part) {
      // ...and one of the plots the old owner keeps leads theirs.
      await tx.request().input("a", sql.Int, b.ApplicationId).query(`
        UPDATE dbo.${t[0]} SET IsPrimary = 1 WHERE Id = (SELECT TOP 1 Id FROM dbo.${t[0]} WHERE ApplicationId = @a AND Status = N'Active' ORDER BY IsPrimary DESC, Id)
          AND NOT EXISTS (SELECT 1 FROM dbo.${t[0]} WHERE ApplicationId = @a AND Status = N'Active' AND IsPrimary = 1)`);
    }
    for (const l of lines) {
      await tx.request().input("a", sql.Int, appId).input("r", sql.Int, l.Ref).input("pri", sql.Bit, l.IsPrimary ? 1 : 0)
        .query(`INSERT INTO dbo.${t[0]} (ApplicationId, ${t[1]}, Status, IsPrimary, CreatedAt) VALUES (@a, @r, N'Active', @pri, SYSDATETIME())`);
    }
  }
  // Bills raised so far stay the old owner's (migration 563).
  for (const t of ["MaintenanceBill", "ElectricityBill"]) {
    await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
      .query(`IF COL_LENGTH('dbo.${t}', 'BillToApplicationId') IS NOT NULL
                EXEC sp_executesql N'UPDATE dbo.${t} SET BillToApplicationId = @a WHERE BookingId = @b AND BillToApplicationId IS NULL', N'@a INT, @b INT', @a = @a, @b = @b`);
  }
  await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, appId).input("by", sql.Int, actorUserId)
    .query("UPDATE dbo.CrmBooking SET ApplicationId = @a, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b");
  await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
    .query(`UPDATE dbo.CrmCoApplicant SET IsActive = 0 WHERE (BookingId = @b${part ? "" : " OR ApplicationId = @a"}) AND IsActive = 1`);
  // What was the old owner's stays as their history, off the new booking:
  //  - their home loan is closed (its bank NOC was verified before),
  //    so it no longer asks the new person for a bank NOC or a sanction;
  //  - their bank details move to their own (old) application, so a refund
  //    or cancellation for the new person is never pre-filled with them;
  //  - how the property is financed is the new person's to declare.
  await tx.request().input("b", sql.Int, b.Id).input("n", sql.NVarChar(300), loanNote)
    .query(`UPDATE dbo.CrmLoanDetail SET SanctionStatus = N'Closed', UpdatedAt = SYSDATETIME(),
              Notes = LTRIM(ISNULL(Notes, N'') + CHAR(10) + @n)
            WHERE BookingId = @b AND ISNULL(SanctionStatus, N'') <> N'Closed'`);
  await tx.request().input("b", sql.Int, b.Id).input("a", sql.Int, b.ApplicationId)
    .query("UPDATE dbo.CrmCustomerBankDetail SET ApplicationId = ISNULL(ApplicationId, @a), BookingId = NULL, UpdatedAt = SYSDATETIME() WHERE BookingId = @b");
  await tx.request().input("b", sql.Int, b.Id)
    .query("UPDATE dbo.CrmBooking SET FinancingType = NULL WHERE Id = @b");
  return appId;
}

/**
 * Passes the bookings of a resale to its buyer. Runs inside the caller's
 * transaction; returns { applicationIds, paid }.
 */
async function endorseToBuyer(tx, resale, actorUserId, actorEmail = "system") {
  const ids = String(resale.BookingIds || resale.FromBookingId || "").split(",").map(Number).filter(Number.isInteger);
  if (!ids.length) throw new ResaleError("This resale names no booking to transfer");
  const buyer = (await tx.request().input("c", sql.Int, resale.ToCustomerId)
    .query("SELECT Id, CustomerName, Mobile, Email FROM dbo.CrmCustomer WHERE Id = @c")).recordset[0];
  if (!buyer) throw new ResaleError("Name the new buyer before completing the resale");
  const bReq = tx.request();
  ids.forEach((id, i) => bReq.input(`rid${i}`, sql.Int, id));
  const bInList = ids.map((_, i) => `@rid${i}`).join(",");
  const bookings = (await bReq.query(`
    SELECT b.Id, b.BookingNo, b.UnitId, b.UnitNo, b.ProjectId, b.CompanyId, b.ApplicationId, a.CustomerId,
           a.ProjectId AS AppProjectId, a.InterestedProject, a.InterestedUnit, a.PaymentPlanId,
           (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
             + (SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND Amount > ISNULL(AppliedAmount, 0)
               THEN Amount - ISNULL(AppliedAmount, 0) ELSE 0 END), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Paid
    FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK) JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${bInList}) AND ${LIVE}`)).recordset;
  if (bookings.length !== ids.length) throw new ResaleError("A booking in this resale is no longer live — it can't be transferred", 409);
  const conveyed = await conveyedReason(tx, ids);
  if (conveyed) throw new ResaleError(conveyed, 409);
  if (bookings.some((b) => b.CustomerId !== resale.FromCustomerId)) throw new ResaleError("The property no longer belongs to the seller on this resale", 409);
  if (resale.ToCustomerId === resale.FromCustomerId) throw new ResaleError("The new buyer is the same customer as the seller");

  // Some plots of the booking: they leave it as a booking of their own, and that one passes to the buyer.
  const plotIds = casePlotIds(resale);
  if (plotIds.length && bookings.length !== 1) throw new ResaleError("A villa is booked on these plots — the plots and the villa can only change hands together", 409);
  const carved = plotIds.length ? await carvePlotsForResale(tx, resale, actorUserId, actorEmail) : null;
  const moving = carved
    ? [{ ...bookings[0], Id: carved.bookingId, BookingNo: carved.bookingNo, UnitId: null, Paid: carved.moved }]
    : bookings;

  const applicationIds = [];
  let paid = 0;
  for (const b of moving) {
    paid += Number(b.Paid || 0);
    // The case opened the buyer's application already (their KYC and
    // co-applicants are on it): the first booking takes that one.
    const useApp = resale.BuyerApplicationId && !applicationIds.includes(resale.BuyerApplicationId) ? resale.BuyerApplicationId : null;
    applicationIds.push(await moveBookingToCustomer(tx, b, buyer, {
      applicationId: useApp, actorUserId, plotIds: carved ? plotIds : null,
      note: `Resale: ${b.BookingNo} passed to ${buyer.CustomerName} by endorsement (resale #${resale.Id}).`,
      loanNote: `Seller's loan — closed when the property was resold (case #${resale.Id})`,
    }));
  }
  paid = Math.round(paid * 100) / 100;
  await tx.request().input("id", sql.Int, resale.Id).input("paid", sql.Decimal(18, 2), paid).input("by", sql.Int, actorUserId)
    .input("to", sql.Int, carved ? carved.bookingId : null)
    .query(`UPDATE dbo.CrmUnitResale SET Status = N'Completed', PaidAtTransfer = @paid, CompletedAt = SYSDATETIME(),
              ToBookingId = ISNULL(@to, FromBookingId), UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  return { applicationIds, paid, bookingIds: carved ? [Number(resale.FromBookingId), carved.bookingId] : moving.map((b) => b.Id) };
}

// ── Buy-back (Kind = 'BuyBack') ────────────────────────────────────────────
// We buy a sold property back at an agreed price. Finance pays it through ONE
// payout voucher in Payments (NewPayment.SourceCrmResaleId, migration 551),
// like a refund. When Finance approves that voucher the property comes back:
// the seller's booking(s) close (Cancelled, as a cancellation closes them —
// every inventory and dues rule already reads that), the unit / plot lines are
// released to stock, and the difference between the agreed price and what the
// seller had paid goes to Property Buy-back Cost. Unpaid milestones simply die
// with the booking; earlier invoices are left as they are.

/** Raises the buy-back payout voucher. Inside the caller's transaction. */
async function raiseBuyBackVoucher(tx, resale, { bankId, paymentMode = "", actorEmail }) {
  const ids = String(resale.BookingIds || resale.FromBookingId || "").split(",").map(Number).filter(Number.isInteger);
  const bbReq = tx.request();
  ids.forEach((id, i) => bbReq.input(`bbid${i}`, sql.Int, id));
  const bbInList = ids.length ? ids.map((_, i) => `@bbid${i}`).join(",") : "0";
  // Serialize voucher creation with claim creation. Claim writers lock these
  // same deposit rows before checking buy-back state and inserting a claim.
  await bbReq.query(`
    SELECT Id FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK)
    WHERE BookingId IN (${bbInList}) ORDER BY BookingId, Id
  `);
  const bookings = (await bbReq.query(`
    SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectId, b.CompanyId, a.CustomerId,
           (SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND Amount > ISNULL(AppliedAmount, 0)
             THEN Amount - ISNULL(AppliedAmount, 0) ELSE 0 END), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS Unapplied
    FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id IN (${bbInList}) AND ${LIVE}`)).recordset;
  if (!bookings.length || bookings.length !== ids.length) throw new ResaleError("A booking in this buy-back is no longer live", 409);
  const conveyed = await conveyedReason(tx, ids);
  if (conveyed) throw new ResaleError(conveyed, 409);
  if (bookings.some((b) => b.CustomerId !== resale.FromCustomerId)) throw new ResaleError("The property no longer belongs to the seller on this buy-back", 409);
  // Money still on account counts as paid and completeBuyBack consumes it.
  // It must not already be promised to a refund or re-booking transfer.
  const refReq = tx.request();
  ids.forEach((id, i) => refReq.input(`refid${i}`, sql.Int, id));
  const refInList = ids.length ? ids.map((_, i) => `@refid${i}`).join(",") : "0";
  const claimed = (await refReq.query(`
    SELECT TOP 1 r.RefundNo FROM dbo.CrmRefund r
    WHERE r.BookingId IN (${refInList}) AND r.Status NOT IN ${REFUND_CLOSED_SQL}`)).recordset[0];
  if (claimed) throw new ResaleError(`Refund ${claimed.RefundNo} is open on this property's money — finish or reject it first`, 409);
  const transferClaimed = (await refReq.query(`
    SELECT TOP 1 rt.Id FROM dbo.CrmRebookingTransfer rt
    JOIN dbo.CrmOnAccountPayment oa ON oa.Id = rt.HeldOnAccountId
    WHERE oa.BookingId IN (${refInList}) AND rt.Status NOT IN ('Rejected', 'Applied')`)).recordset[0];
  if (transferClaimed) throw new ResaleError(`Re-booking transfer #${transferClaimed.Id} is open on this property's money — finish or reject it first`, 409);
  const price = Math.round(Number(resale.AgreedValue || 0) * 100) / 100;
  const tds = Math.round(Number(resale.TdsAmount || 0) * 100) / 100;
  if (!(price > 0)) throw new ResaleError("The buy-back has no agreed price");
  if (tds < 0 || tds >= price) throw new ResaleError("TDS must be less than the buy-back price");
  // No bank chosen here = Finance picks it on the voucher (as for refunds and
  // brokerage); Finance can't approve the voucher without one.

  const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
  const { ensureCrmCustomerLedgerHead } = require("./crmLedger");
  const bankName = bankId == null ? "" : (await tx.request().input("bid", sql.Int, bankId)
    .query("SELECT LHeadName FROM dbo.AccountHeadMaster WHERE LHeadId = @bid")).recordset[0]?.LHeadName;
  if (bankId != null && !bankName) throw new ResaleError("That bank account was not found");
  const sellerHeadId = await ensureCrmCustomerLedgerHead(tx, resale.FromCustomerId, actorEmail);
  const docTypeId = await resolveDocTypeId(tx, sql, "PAY");
  const docNo = await lockNextDocNumber(tx, sql, { docTypeId, tableName: "NewPayment", docNoColumn: "DocNo", issuedBy: actorEmail });
  const parts = (docNo || "").split("-");
  const today = new Date().toISOString().slice(0, 10);
  const fy = (await tx.request().input("d", sql.Date, today)
    .query("SELECT TOP 1 FId FROM dbo.FinYear WHERE @d >= FStartDate AND @d <= FEndDate ORDER BY FStartDate DESC")).recordset[0]?.FId ?? null;
  const lead = bookings[0];
  const ins = await tx.request()
    .input("name", sql.VarChar, "CRM Buy-back")
    .input("remarks", sql.NVarChar(1000), `Buy-back #${resale.Id} — ${bookings.map((b) => b.UnitNo || b.BookingNo).join(" + ")} bought back at ₹${price.toLocaleString("en-IN")}${tds ? ` (TDS ₹${tds.toLocaleString("en-IN")})` : ""}`)
    .input("mode", sql.VarChar(50), paymentMode || "").input("bankName", sql.VarChar(200), bankName).input("bankId", sql.Int, bankId)
    .input("amt", sql.Decimal(18, 2), price).input("tds", sql.Decimal(18, 2), tds || null).input("dt", sql.Date, today)
    .input("project", sql.VarChar, lead.ProjectId != null ? String(lead.ProjectId) : "")
    .input("company", sql.VarChar, lead.CompanyId != null ? String(lead.CompanyId) : "")
    .input("partyId", sql.Int, sellerHeadId)
    .input("docNo", sql.NVarChar(100), docNo).input("docTypeId", sql.Int, docTypeId)
    .input("docYear", sql.SmallInt, parseInt(parts[parts.length - 2], 10) || null).input("docSerial", sql.Int, parseInt(parts[parts.length - 1], 10) || null)
    .input("fy", sql.Int, fy).input("src", sql.Int, resale.Id).input("by", sql.NVarChar(100), actorEmail)
    .query(`INSERT INTO dbo.NewPayment (PPaymentName, PRemarks, PMode, PBankName, PBankID, PAmount, TDSAmount, PDocType, PDate,
              PProject, PCompany, PPartyId, DocNo, DocTypeId, DocYear, DocSerial, PFinYearId, SourceCrmResaleId,
              PCreatedAt, PCreatedBy, PApprovedBy, Status)
            OUTPUT INSERTED.PPaymentID
            VALUES (@name, @remarks, @mode, @bankName, @bankId, @amt, @tds, 'CRM Buy-back', @dt,
              @project, @company, @partyId, @docNo, @docTypeId, @docYear, @docSerial, @fy, @src,
              SYSDATETIME(), @by, NULL, 'Pending')`);
  const newPaymentId = ins.recordset[0].PPaymentID;
  await backPatchRecordId(tx, sql, docNo, "NewPayment", newPaymentId);
  await tx.request().input("id", sql.Int, resale.Id).input("np", sql.Int, newPaymentId)
    .query("UPDATE dbo.CrmUnitResale SET PayoutNewPaymentId = @np, UpdatedAt = SYSDATETIME() WHERE Id = @id");
  return { newPaymentId, docNo };
}

/**
 * Finance approved the buy-back voucher: the property comes back to stock.
 * Idempotent (a completed buy-back is left alone).
 */
async function completeBuyBack(pool, resaleId, newPaymentId, actorUserId, actorEmail) {
  const tx = pool.transaction();
  await tx.begin();
  let resale;
  try {
    resale = (await tx.request().input("id", sql.Int, resaleId)
      .query("SELECT * FROM dbo.CrmUnitResale WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id AND IsActive = 1")).recordset[0];
    // Only an approved buy-back completes (a cancelled or rejected one never does).
    if (!resale || resale.Kind !== "BuyBack" || resale.Status !== "Approved" || resale.PayoutNewPaymentId !== newPaymentId) {
      await tx.rollback();
      return { done: false };
    }
    const ids = String(resale.BookingIds || resale.FromBookingId).split(",").map(Number).filter(Number.isInteger);
    const cbReq = tx.request();
    ids.forEach((id, i) => cbReq.input(`cbid${i}`, sql.Int, id));
    const cbInList = ids.length ? ids.map((_, i) => `@cbid${i}`).join(",") : "0";
    const paid = (await cbReq.query(`
      SELECT (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId IN (${cbInList}))
           + (SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND Amount > ISNULL(AppliedAmount, 0)
               THEN Amount - ISNULL(AppliedAmount, 0) ELSE 0 END), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId IN (${cbInList})) AS Paid`)).recordset[0].Paid;
    const { releaseBookingInventoryLines } = require("./crmWorkflowGuards");
    const { syncApplicationOnBookingTerminal } = require("./crmApplicationWorkflow");
    for (const id of ids) {
      await tx.request().input("b", sql.Int, id).input("by", sql.Int, actorUserId)
        .query(`UPDATE dbo.CrmBooking SET Status = 'Cancelled', UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @b AND Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL}`);
      await releaseBookingInventoryLines(tx, id);
      // What sat on account was counted in the price paid back — use it up,
      // so it can't be refunded or transferred a second time.
      const usedUp = await tx.request().input("b", sql.Int, id).input("rid", sql.Int, resaleId).query(`
        UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = Amount, Status = 'Applied',
          Notes = ISNULL(Notes, '') + CHAR(10) + 'Paid back in buy-back #' + CAST(@rid AS NVARCHAR(20))
        OUTPUT INSERTED.Id
        WHERE BookingId = @b AND Amount - ISNULL(AppliedAmount, 0) > 0.009`);
      for (const u of usedUp.recordset) {
        await require("./crmLedger").syncCrmOnAccountLedger(tx, u.Id, actorEmail, `Paid back in buy-back #${resaleId}`);
      }
      await syncApplicationOnBookingTerminal(tx, id, "Cancelled", "BookingBoughtBack", `Bought back by the developer (buy-back #${resaleId})`, actorUserId);
      await tx.request().input("b", sql.Int, id).query("UPDATE dbo.CrmMoneyReceipt SET Status = 'Rejected', UpdatedAt = SYSDATETIME() WHERE BookingId = @b AND Status = 'Pending' AND ReceivedPaymentId IS NULL");
      await tx.request().input("b", sql.Int, id).input("by", sql.Int, actorUserId).query(`
        UPDATE dbo.ReceivedPayment SET RPStatus = 'Rejected', RPRejectedBy = @by, RPRejectedAt = SYSDATETIME(),
          RPRejectionNote = 'Auto-rejected — property bought back', RPUpdatedBy = @by, RPUpdatedAt = SYSDATETIME()
        WHERE CrmBookingId = @b AND RPStatus = 'Pending'`);
    }
    await tx.request().input("id", sql.Int, resaleId).input("paid", sql.Decimal(18, 2), paid).input("by", sql.Int, actorUserId)
      .query(`UPDATE dbo.CrmUnitResale SET Status = N'Completed', PaidAtTransfer = @paid, CompletedAt = SYSDATETIME(), UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
  // Posted after the property is back in stock, like every CRM posting: a
  // ledger failure is recorded and reported, never allowed to undo the buy-back.
  let outcome;
  try { outcome = await require("./crmLedger").postCrmBuyBackDifferenceToGL(pool, resaleId, actorEmail); }
  catch (e) { outcome = { posted: false, reason: `Buy-back difference not posted: ${e.message}` }; }
  await require("./approvalService").recordGLPosting("crm-buyback", resaleId, outcome, actorEmail);
  return { done: true, ledger: outcome };
}

/** Finance turned the voucher down: back to Approved, ready for a fresh voucher. */
async function buyBackVoucherRejected(pool, resaleId, newPaymentId, note) {
  await pool.request().input("id", sql.Int, resaleId).input("np", sql.Int, newPaymentId)
    .input("n", sql.NVarChar(500), `[Finance] ${note || "Payout voucher rejected"}`.slice(0, 500))
    .query(`UPDATE dbo.CrmUnitResale SET PayoutNewPaymentId = NULL, RejectionNote = @n, UpdatedAt = SYSDATETIME()
            WHERE Id = @id AND PayoutNewPaymentId = @np AND Status = N'Approved'`);
}

module.exports = { movingBookings, openResaleOn, casePlotIds, resalePropertySql, partPlotInvoiceCheck, conveyedReason, endorseToBuyer, moveBookingToCustomer, raiseBuyBackVoucher, completeBuyBack, buyBackVoucherRejected, ResaleError };
