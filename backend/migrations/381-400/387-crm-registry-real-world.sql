-- Migration 387: Registry — real-world registration mechanics.
-- A Sub-Registrar Office appointment in practice has a specific office and
-- time slot (not just a date), requires two witnesses with ID, and needs
-- both parties (or their authorized representatives) confirmed present
-- before the deed can actually be registered. None of that existed —
-- Schedule only took a bare date and Complete only took the post-facto
-- registration numbers.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmRegistry') AND name = 'AppointmentTime')
BEGIN
  ALTER TABLE dbo.CrmRegistry ADD
    AppointmentTime      NVARCHAR(20) NULL,      -- e.g. "11:30 AM" — free text, offices don't run on exact slots
    AppointmentOffice     NVARCHAR(255) NULL,      -- chosen at scheduling time, may differ from the office actually used
    WitnessNames          NVARCHAR(500) NULL,      -- two witnesses, required by the Registration Act for a sale deed
    BuyerAttended         BIT NOT NULL DEFAULT 0,
    SellerAttended        BIT NOT NULL DEFAULT 0,  -- builder/seller representative
    AttendanceNotes       NVARCHAR(MAX) NULL;
  PRINT 'Added appointment/attendance columns to dbo.CrmRegistry';
END
GO

PRINT 'Migration 387 complete — Registry real-world mechanics';
GO
