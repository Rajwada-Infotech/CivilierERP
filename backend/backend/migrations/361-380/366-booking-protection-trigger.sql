-- Migration 366: DB-level protection trigger on CrmBooking
-- Application-level guards in crmBookings.js prevent deletion of bookings with
-- protected financial/legal records, but a direct SQL query, migration script,
-- or future developer bypassing the route would circumvent them entirely.
-- This INSTEAD OF DELETE trigger is the last line of defence at the DB layer.
--
-- Checks for: Agreements, SalesDeeds, non-rejected MoneyReceipts,
-- OnAccountPayments, and PaymentReceipts (via CrmPaymentMilestone).
-- Operational records (WelcomeCalls, Handovers, NOC, etc.) are NOT checked
-- here — they are handled by the application-layer transaction.

IF OBJECT_ID('dbo.trg_CrmBooking_PreventUnsafeDelete', 'TR') IS NOT NULL
  DROP TRIGGER dbo.trg_CrmBooking_PreventUnsafeDelete;
GO

CREATE TRIGGER dbo.trg_CrmBooking_PreventUnsafeDelete
ON dbo.CrmBooking
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1 FROM deleted d
    WHERE
      EXISTS (SELECT 1 FROM dbo.CrmAgreement       WHERE BookingId = d.Id)
      OR EXISTS (SELECT 1 FROM dbo.CrmSalesDeed     WHERE BookingId = d.Id)
      OR EXISTS (SELECT 1 FROM dbo.CrmMoneyReceipt  WHERE BookingId = d.Id AND Status <> 'Rejected')
      OR EXISTS (SELECT 1 FROM dbo.CrmOnAccountPayment WHERE BookingId = d.Id)
      OR EXISTS (
          SELECT 1 FROM dbo.CrmPaymentReceipt r
          JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
          WHERE m.BookingId = d.Id
      )
  )
  BEGIN
    RAISERROR(
      'DB Safety [366]: Cannot delete CrmBooking — Agreements, SalesDeeds, MoneyReceipts, or Payment records exist. Use the authorised permanent-delete endpoint which enforces all checks before removal.',
      16, 1
    );
    RETURN;
  END;

  -- No protected records — execute the actual deletion.
  DELETE b FROM dbo.CrmBooking b
  INNER JOIN deleted d ON d.Id = b.Id;
END;
GO

PRINT 'Created trigger dbo.trg_CrmBooking_PreventUnsafeDelete';
GO
