// CRM money check — every live booking against the rules its figures must obey.
//
//   node scripts/crmMoneyCheck.js            read-only report
//   node scripts/crmMoneyCheck.js --dry-run  also re-adds each faulty booking's totals inside a
//                                            transaction, shows before -> after, and rolls back
//   node scripts/crmMoneyCheck.js --apply    the same, committed
//
// What --apply repairs: a booking whose stored Parking / Extra charges total disagrees with
// its own parking and extra-charge rows, or whose unpaid payment steps don't add up to its
// Grand Total. The repair is the same add-up every parking / extra-charge change runs
// (rollupBookingTotals: GST, totals, then the unpaid steps). Paid and part-paid steps are never
// moved. Anything it can't settle is listed for a decision, never changed.
const path = require("path");
const root = path.join(__dirname, "..");
try { require(path.join(root, "node_modules/dotenv")).config({ path: path.join(root, ".env"), quiet: true }); } catch { /* env from the container */ }
const { getPool, connectDB, sql } = require(path.join(root, "db"));
const { DEAD_BOOKING_SQL } = require(path.join(root, "constants/crmStatuses"));

const MODE = process.argv.includes("--apply") ? "apply" : process.argv.includes("--dry-run") ? "dry-run" : "read";
const LIVE = `b.IsActive = 1 AND NOT (b.Status IN ${DEAD_BOOKING_SQL})`;

const CHECKS = {
  parking: ["Parking total differs from the booking's parking rows", `
    SELECT b.Id, b.BookingNo, b.ParkingTotal, x.Rows AS ParkingRows
    FROM dbo.CrmBooking b CROSS APPLY (SELECT ISNULL(SUM(TotalAmount),0) Rows FROM dbo.CrmParkingAllotment p WHERE p.BookingId = b.Id AND p.IsActive = 1) x
    WHERE ${LIVE} AND ABS(ISNULL(b.ParkingTotal,0) - x.Rows) > 1`],
  extra: ["Extra charges total differs from the booking's charge rows", `
    SELECT b.Id, b.BookingNo, b.ExtraChargesTotal, x.Rows AS ChargeRows
    FROM dbo.CrmBooking b CROSS APPLY (SELECT ISNULL(SUM(TotalAmount),0) Rows FROM dbo.CrmExtraCharge c WHERE c.BookingId = b.Id AND c.IsActive = 1) x
    WHERE ${LIVE} AND ABS(ISNULL(b.ExtraChargesTotal,0) - x.Rows) > 1`],
  schedule: ["Payment schedule does not add up to the Grand Total", `
    SELECT b.Id, b.BookingNo, b.GrandTotal, s.Sched AS ScheduleTotal, s.Sched - b.GrandTotal AS Diff, s.OpenSteps AS UnpaidSteps
    FROM dbo.CrmBooking b CROSS APPLY (
      SELECT SUM(AmountDue) Sched, COUNT(*) N, SUM(CASE WHEN Status NOT IN ('Paid','Waived') AND ISNULL(AmountPaid,0) = 0 AND MilestoneNo <> 1 THEN 1 ELSE 0 END) OpenSteps
      FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id) s
    WHERE ${LIVE} AND s.N > 0 AND ABS(s.Sched - b.GrandTotal) > 1`],
  grand: ["Grand Total is not Unit + Unit GST + Parking + Extra charges - Credit notes", `
    SELECT b.Id, b.BookingNo, b.GrandTotal, b.TotalValue + ISNULL(b.UnitGstAmount,0) + ISNULL(b.ParkingTotal,0) + ISNULL(b.ExtraChargesTotal,0) - ISNULL(b.CreditNoteTotal,0) AS Expected
    FROM dbo.CrmBooking b WHERE ${LIVE}
      AND ABS(b.GrandTotal - (b.TotalValue + ISNULL(b.UnitGstAmount,0) + ISNULL(b.ParkingTotal,0) + ISNULL(b.ExtraChargesTotal,0) - ISNULL(b.CreditNoteTotal,0))) > 1`],
  area: ["Unit price is not Area x Rate", `
    SELECT b.Id, b.BookingNo, b.AreaSqFt, b.RatePerSqFt, b.TotalValue, ROUND(b.AreaSqFt * b.RatePerSqFt, 2) AS AreaTimesRate
    FROM dbo.CrmBooking b WHERE ${LIVE} AND b.AreaSqFt > 0 AND b.RatePerSqFt > 0 AND ABS(b.TotalValue - ROUND(b.AreaSqFt * b.RatePerSqFt, 2)) > 1`],
  lines: ["Unit / plot lines do not add up to the unit price", `
    SELECT b.Id, b.BookingNo, b.TotalValue, l.Lines
    FROM dbo.CrmBooking b CROSS APPLY (SELECT SUM(AllocatedValue) Lines, COUNT(*) N FROM (
      SELECT AllocatedValue FROM dbo.CrmBookingUnit x WHERE x.BookingId = b.Id AND x.Status = N'Active'
      UNION ALL SELECT AllocatedValue FROM dbo.CrmBookingPlot y WHERE y.BookingId = b.Id AND y.Status = N'Active') z) l
    WHERE ${LIVE} AND l.N > 0 AND ABS(l.Lines - b.TotalValue) > 1`],
  paid: ["A step's paid figure differs from its receipts", `
    SELECT b.Id, b.BookingNo, m.MilestoneNo, m.MilestoneName, m.AmountPaid, r.Rcpt
    FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    CROSS APPLY (SELECT ISNULL(SUM(Amount),0) Rcpt FROM dbo.CrmPaymentReceipt r WHERE r.MilestoneId = m.Id) r
    WHERE ${LIVE} AND ABS(ISNULL(m.AmountPaid,0) - r.Rcpt) > 1`],
  status: ["A step's status disagrees with its money", `
    SELECT b.Id, b.BookingNo, m.MilestoneNo, m.MilestoneName, m.Status, m.AmountDue, m.AmountPaid
    FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    WHERE ${LIVE} AND m.AmountDue > 0
      AND ((m.Status = 'Paid' AND ISNULL(m.AmountPaid,0) < m.AmountDue - 1) OR (m.Status = 'Pending' AND ISNULL(m.AmountPaid,0) >= m.AmountDue))`],
  overpaid: ["Paid more than the Grand Total (needs a decision: refund or move to account)", `
    SELECT b.Id, b.BookingNo, b.GrandTotal, p.Paid, p.Paid - b.GrandTotal AS PaidOver
    FROM dbo.CrmBooking b CROSS APPLY (SELECT ISNULL(SUM(AmountPaid),0) Paid FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id) p
    WHERE ${LIVE} AND p.Paid > b.GrandTotal + 1`],
};
// What a re-add can repair; the rest is reported only.
const REPAIRABLE = ["parking", "extra", "schedule", "grand"];

const money = (n) => (n == null ? "-" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

(async () => {
  await connectDB(); const pool = getPool();
  const live = (await pool.request().query(`SELECT COUNT(*) N FROM dbo.CrmBooking b WHERE ${LIVE}`)).recordset[0].N;
  console.log(`\nCRM money check — ${MODE} — ${live} live bookings\n`);

  const found = {};
  for (const [key, [title, q]] of Object.entries(CHECKS)) {
    const rows = (await pool.request().query(q)).recordset;
    found[key] = rows;
    console.log(`${rows.length ? "PROBLEM" : "ok     "}  ${title}: ${rows.length}`);
    if (rows.length) console.table(rows.slice(0, 25).map(({ Id, ...r }) => r));
  }
  if (MODE === "read") { console.log("\nRead-only. Run with --dry-run to see the repairs."); process.exit(0); }

  const ids = [...new Set(REPAIRABLE.flatMap((k) => found[k].map((r) => r.Id)))];
  console.log(`\n${ids.length} booking(s) to re-add (${MODE}).`);
  const { rollupBookingTotals } = require(path.join(root, "routes/crmParking"));
  const snap = async (db, id) => {
    const b = (await db.request().input("id", sql.Int, id).query(
      "SELECT BookingNo, ParkingTotal, ExtraChargesTotal, UnitGstAmount, GrandTotal FROM dbo.CrmBooking WHERE Id = @id")).recordset[0];
    const s = (await db.request().input("id", sql.Int, id).query(
      "SELECT ISNULL(SUM(AmountDue),0) S FROM dbo.CrmPaymentMilestone WHERE BookingId = @id")).recordset[0].S;
    return { ...b, Schedule: s };
  };
  const out = [];
  for (const id of ids) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const before = await snap(tx, id);
      await rollupBookingTotals(tx, id);
      const after = await snap(tx, id);
      out.push({
        Booking: before.BookingNo,
        Parking: `${money(before.ParkingTotal)} -> ${money(after.ParkingTotal)}`,
        Extras: `${money(before.ExtraChargesTotal)} -> ${money(after.ExtraChargesTotal)}`,
        "Unit GST": `${money(before.UnitGstAmount)} -> ${money(after.UnitGstAmount)}`,
        "Grand Total": `${money(before.GrandTotal)} -> ${money(after.GrandTotal)}`,
        Schedule: `${money(before.Schedule)} -> ${money(after.Schedule)}`,
        "Adds up": Math.abs(Number(after.Schedule) - Number(after.GrandTotal)) <= 1 ? "yes" : "NO - needs a decision",
      });
      if (MODE === "apply") await tx.commit(); else await tx.rollback();
    } catch (e) {
      try { await tx.rollback(); } catch { /* already rolled back */ }
      out.push({ Booking: id, Error: e.message });
    }
  }
  if (out.length) console.table(out);
  console.log(MODE === "apply" ? "\nApplied. Run again without flags to re-verify." : "\nDry run — nothing was saved. Run with --apply to save.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
