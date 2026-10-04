-- Removes the "Allotment Letter" concept entirely — it was never wired up
-- to any create/issue endpoint (confirmed: no INSERT into this table
-- existed anywhere in the codebase), had no actual gate on any downstream
-- legal step, and the user wants it gone. Drops the table only if it's
-- genuinely empty (defensive — if some other process ever did insert a row,
-- this migration stops short of destroying real data and needs a manual
-- look instead of blindly dropping).

IF OBJECT_ID('dbo.CrmAllotmentLetter', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.CrmAllotmentLetter)
  BEGIN
    DROP TABLE dbo.CrmAllotmentLetter;
    PRINT 'Dropped CrmAllotmentLetter (was empty)';
  END
  ELSE
    PRINT 'CrmAllotmentLetter has existing rows — left in place, needs manual review';
END
GO

DELETE FROM dbo.PageDefinitions WHERE PageKey = 'crm-allotment-letter';
GO
