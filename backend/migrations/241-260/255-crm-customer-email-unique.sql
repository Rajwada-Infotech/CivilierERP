-- Migration 255: Add filtered unique index on CrmCustomer.Email.
--
-- Portal login is by customer email again, while the identity anchor remains
-- CustomerId. Email is optional, but every active nonblank email must identify
-- at most one active customer or login becomes ambiguous. Co-applicant emails
-- live in dbo.CrmCoApplicant and do not participate in portal identity.

IF EXISTS (
  SELECT 1
  FROM dbo.CrmCustomer
  WHERE IsActive = 1
    AND Email IS NOT NULL
    AND LTRIM(RTRIM(Email)) <> ''
  GROUP BY LOWER(LTRIM(RTRIM(Email)))
  HAVING COUNT(*) > 1
)
BEGIN
  THROW 51055, 'Cannot create UQ_CrmCustomer_Email: duplicate active customer emails exist.', 1;
END

UPDATE dbo.CrmCustomer
SET Email = NULLIF(LOWER(LTRIM(RTRIM(Email))), '')
WHERE IsActive = 1;

IF EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomer')
    AND name = 'UQ_CrmCustomer_Email'
    AND ISNULL(filter_definition, '') NOT LIKE '%Email]<>''''%'
    AND ISNULL(filter_definition, '') NOT LIKE '%Email <> ''''%'
)
BEGIN
  DROP INDEX UQ_CrmCustomer_Email ON dbo.CrmCustomer;
  PRINT 'Dropped UQ_CrmCustomer_Email with old filter';
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomer')
    AND name = 'UQ_CrmCustomer_Email'
)
BEGIN
  CREATE UNIQUE INDEX UQ_CrmCustomer_Email
    ON dbo.CrmCustomer(Email)
    WHERE IsActive = 1 AND Email IS NOT NULL AND Email <> '';
  PRINT 'Created UQ_CrmCustomer_Email';
END
ELSE
BEGIN
  PRINT 'UQ_CrmCustomer_Email already exists - skipped';
END
