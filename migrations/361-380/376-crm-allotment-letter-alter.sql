-- Migration 376: Alter CrmAllotmentLetter — correct RERA Section 13 workflow.
--
-- Old flow (migration 373, incorrect): Draft → Issued
--   The letter started as a Draft, and staff manually marked it Issued.
--
-- Correct RERA flow: Issued → Acknowledged
--   The letter is auto-generated and immediately Issued (the system creates
--   the numbered RERA document from booking data). The customer then signs
--   and returns it, which triggers Acknowledged — starting the 30-day clock
--   for executing the Agreement for Sale.
--
-- This migration:
--   1. Adds AcknowledgedOn column (idempotent — safe to run multiple times).
--   2. Migrates any existing Draft records to Issued status.
--   3. Ensures IssuedOn is set for all rows (fallback to today if NULL).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmAllotmentLetter') AND name = 'AcknowledgedOn'
)
BEGIN
  ALTER TABLE dbo.CrmAllotmentLetter ADD AcknowledgedOn DATE NULL;
  PRINT 'Added AcknowledgedOn to CrmAllotmentLetter';
END
GO

-- Migrate Draft → Issued. Draft is no longer a valid status.
-- Set IssuedOn to today for any rows where it was NULL.
UPDATE dbo.CrmAllotmentLetter
SET
  Status   = 'Issued',
  IssuedOn = ISNULL(IssuedOn, CONVERT(DATE, SYSDATETIME())),
  UpdatedAt = SYSDATETIME()
WHERE Status = 'Draft';

PRINT CAST(@@ROWCOUNT AS NVARCHAR) + ' Draft record(s) migrated to Issued.';
GO
