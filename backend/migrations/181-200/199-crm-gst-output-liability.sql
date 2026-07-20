-- CRM bookings/receipts had zero GST tracking — TotalValue/milestones/
-- receipts were plain numbers with no output-tax split, so the GST the
-- company collects from customers (and owes the government) was invisible
-- to Finance. Pricing is GST-inclusive; this adds:
--   1. CrmBooking.HsnCode — lets staff tag a booking with its applicable
--      HSN classification (rate itself always comes live from dbo.HSN —
--      "everything dynamically changeable", never hardcoded here).
--   2. A "GST Output Liability - CRM Sales" GL account, classified under
--      whatever Duties & Taxes liability group already exists in this
--      chart of accounts (falls back to creating one under CURRENT
--      LIABILITIES if none does, rather than guessing an existing AGId).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'HsnCode')
  ALTER TABLE dbo.CrmBooking ADD HsnCode VARCHAR(20) NULL;
GO

DECLARE @dutiesGroupId INT;

-- Prefer an existing Duties & Taxes style group if this chart of accounts
-- has one. Matches "DUTY & TAXES" (this codebase's actual name, singular
-- "DUTY" with an ampersand — a naive "%DUTIES%TAX%" LIKE pattern misses it).
SELECT TOP 1 @dutiesGroupId = AGId
FROM dbo.AccountGroup
WHERE Name LIKE '%DUT%TAX%' OR Name LIKE '%TAX%PAYABLE%' OR Code IN ('DT', 'DTX');

-- Otherwise fall back to CURRENT LIABILITIES itself (AGId 8) rather than
-- guessing at TDS PAYABLE's parent — that parent can be an expense-side
-- group in some charts of accounts (e.g. DEFERRED TAX under TAX EXPENSE),
-- which is wrong for a liability like GST payable.
IF @dutiesGroupId IS NULL
  SET @dutiesGroupId = 8;

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CRM-GST-OUTPUT')
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus, Status, LBelongsTo,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms, LCountry,
     IsSystemGenerated, CreatedBy, CreatedAt)
  VALUES
    ('GST Output Liability - CRM Sales', 'CRM-GST-OUTPUT', 'GL', 1, 'Approved', @dutiesGroupId,
     'N/A', 'N/A', 'N/A', 'India',
     1, 'system', SYSDATETIME());
END
GO
