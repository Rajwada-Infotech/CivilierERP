-- ============================================================
-- Migration 425: Make CrmCustomer.CustomerName and Mobile nullable
-- No fields are mandatory on the customer form any more — staff
-- can register a walk-in with just the details they have on hand
-- and fill in the rest later.
-- ============================================================

-- 1. Allow CustomerName to be NULL
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmCustomer')
    AND name = 'CustomerName'
    AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmCustomer ALTER COLUMN CustomerName NVARCHAR(200) NULL;
  PRINT 'CrmCustomer.CustomerName is now nullable';
END
GO

-- 2. Allow Mobile to be NULL
--    Must drop the filtered unique index first (it references the column),
--    then recreate it scoped to non-NULL, non-empty values only so that
--    multiple blank-mobile rows are allowed while a real number is still
--    unique across active customers.
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomer')
    AND name = 'UQ_CrmCustomer_Mobile'
)
BEGIN
  DROP INDEX UQ_CrmCustomer_Mobile ON dbo.CrmCustomer;
  PRINT 'Dropped UQ_CrmCustomer_Mobile index';
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmCustomer')
    AND name = 'Mobile'
    AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmCustomer ALTER COLUMN Mobile NVARCHAR(20) NULL;
  PRINT 'CrmCustomer.Mobile is now nullable';
END
GO

-- Recreate the unique index: only enforce uniqueness when Mobile is
-- actually provided (non-NULL and non-empty) and the record is active.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomer')
    AND name = 'UQ_CrmCustomer_Mobile'
)
BEGIN
  CREATE UNIQUE INDEX UQ_CrmCustomer_Mobile
    ON dbo.CrmCustomer(Mobile)
    WHERE IsActive = 1 AND Mobile IS NOT NULL AND Mobile <> '';
  PRINT 'Recreated UQ_CrmCustomer_Mobile (non-null, non-empty, active only)';
END
GO
