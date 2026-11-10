-- Migration 632: one active Possession Notice per booking, enforced by the database.
--
-- The list of bookings that can get a notice leaves out any with a Draft or Sent one, but creating a notice never checked,
-- so a double click or a stale page could put two live offers out for the same unit. A new one is still allowed after the
-- last was Acknowledged or Disputed.
--
-- Additive and safe to run again. If a booking already has two active notices the index is not created: it says so, and
-- the extra one needs clearing first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmPossessionNotice_OneActive' AND object_id = OBJECT_ID('dbo.CrmPossessionNotice'))
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.CrmPossessionNotice WHERE Status IN (N'Draft', N'Sent') GROUP BY BookingId HAVING COUNT(*) > 1)
    PRINT 'Migration 632: a booking has more than one Draft or Sent possession notice. Clear the extra one, then run this again.';
  ELSE
    EXEC('CREATE UNIQUE INDEX UX_CrmPossessionNotice_OneActive ON dbo.CrmPossessionNotice (BookingId) WHERE Status IN (N''Draft'', N''Sent'')');
END
GO
