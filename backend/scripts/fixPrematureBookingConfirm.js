// Bookings that reached Status 'Approved' while their WorkflowStage never
// reached 'Confirmed' — on production these were approved 22–25 Sep 2026,
// before the crm-bookings workflow existed (migration 554, 9 Oct), so one
// approval completed them. The user confirmed (2026-10-27) they stay
// approved; this only sets the stage to Confirmed so the record agrees with
// its status, and logs why. It writes no approval it didn't receive: no
// Director stamp, no ApprovalAuditLog row.
//
//   node scripts/fixPrematureBookingConfirm.js           dry run (default)
//   node scripts/fixPrematureBookingConfirm.js --apply   write
const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");
const NOTE = "Approved before the Director level was set up in Approval Setup; confirmed by data fix";

(async () => {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`
    SELECT Id, BookingNo, Status, WorkflowStage, MarketingHeadApprovedAt, ConfirmedAt
    FROM dbo.CrmBooking
    WHERE IsActive = 1 AND Status = 'Approved' AND WorkflowStage <> 'Confirmed'
    ORDER BY Id`)).recordset;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} booking(s):`);
  console.table(rows);
  if (!APPLY || !rows.length) {
    if (!APPLY) console.log("Nothing written. Re-run with --apply to set WorkflowStage = 'Confirmed'.");
    await closeDB();
    return;
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const r of rows) {
      await tx.request().input("id", sql.Int, r.Id).query(`
        UPDATE dbo.CrmBooking
        SET WorkflowStage = 'Confirmed',
            ConfirmedAt = ISNULL(ConfirmedAt, MarketingHeadApprovedAt),
            ReadyForApprovalAt = NULL,
            UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND Status = 'Approved' AND WorkflowStage <> 'Confirmed'`);
      await tx.request()
        .input("id", sql.Int, r.Id)
        .input("note", sql.NVarChar(sql.MAX), NOTE)
        .query(`INSERT INTO dbo.CrmBookingStageLog (BookingId, Stage, [Action], Remarks, ActorId, CreatedAt)
                VALUES (@id, 'Confirmed', 'ConfirmedByDataFix', @note, NULL, SYSDATETIME())`);
    }
    await tx.commit();
    console.log(`Done — ${rows.length} booking(s) set to Confirmed.`);
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  await closeDB();
})().catch(async (e) => { console.error("FAILED:", e.message); try { await closeDB(); } catch (_) {} process.exit(1); });
