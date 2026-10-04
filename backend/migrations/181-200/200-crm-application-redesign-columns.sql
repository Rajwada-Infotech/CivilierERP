-- Application/Booking redesign: the Application now captures everything a
-- Booking needs (unit rate, payment plan, token/booking amount, payment
-- mode, apply date) so a Booking can be auto-created the moment the
-- Application is approved instead of requiring a separate manual step.
-- BudgetMin/BudgetMax are intentionally NOT dropped here (data-preserving —
-- the app layer simply stops reading/writing them); AssignedBy is new and
-- captures who actually filed the application (fixed forever), distinct
-- from AssignedTo which may be reassigned later via lead-transfer flows.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'AssignedBy')
  ALTER TABLE dbo.CrmApplication ADD AssignedBy INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'RatePerSqFt')
  ALTER TABLE dbo.CrmApplication ADD RatePerSqFt DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'DateOfApply')
  ALTER TABLE dbo.CrmApplication ADD DateOfApply DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'PaymentPlanId')
  ALTER TABLE dbo.CrmApplication ADD PaymentPlanId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'TokenType')
  ALTER TABLE dbo.CrmApplication ADD TokenType NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'TokenValue')
  ALTER TABLE dbo.CrmApplication ADD TokenValue DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'BookingAmount')
  ALTER TABLE dbo.CrmApplication ADD BookingAmount DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'PaymentMode')
  ALTER TABLE dbo.CrmApplication ADD PaymentMode NVARCHAR(50) NULL;
GO

-- ApplicationId hooks onto the two existing capture systems (bank/KYC
-- detail, document upload) instead of building third/fourth parallel ones.
-- Both tables' BookingId was NOT NULL (bank detail also UNIQUE on it) —
-- relax to nullable so an Application-stage row (no booking yet) can exist,
-- and replace the plain unique constraint with a filtered one so multiple
-- Application-only rows (BookingId IS NULL) don't collide, while "one bank
-- detail row per booking" stays enforced once a booking does exist.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'ApplicationId')
  ALTER TABLE dbo.CrmCustomerBankDetail ADD ApplicationId INT NULL;
GO

DECLARE @BookingUniqueConstraint NVARCHAR(128);

SELECT TOP 1 @BookingUniqueConstraint = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id
 AND ic.index_id = kc.unique_index_id
JOIN sys.columns c
  ON c.object_id = ic.object_id
 AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
  AND kc.[type] = 'UQ'
  AND c.name = 'BookingId'
  AND NOT EXISTS (
    SELECT 1
    FROM sys.index_columns ic2
    WHERE ic2.object_id = ic.object_id
      AND ic2.index_id = ic.index_id
      AND ic2.column_id <> ic.column_id
  );

IF @BookingUniqueConstraint IS NOT NULL
BEGIN
  DECLARE @DropBookingUniqueSql NVARCHAR(MAX) =
    N'ALTER TABLE dbo.CrmCustomerBankDetail DROP CONSTRAINT ' + QUOTENAME(@BookingUniqueConstraint);
  EXEC sp_executesql @DropBookingUniqueSql;
END
GO

ALTER TABLE dbo.CrmCustomerBankDetail ALTER COLUMN BookingId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmCustomerBankDetail_BookingId' AND object_id = OBJECT_ID('dbo.CrmCustomerBankDetail'))
  CREATE UNIQUE INDEX UX_CrmCustomerBankDetail_BookingId ON dbo.CrmCustomerBankDetail (BookingId) WHERE BookingId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmCustomerBankDetail_ApplicationId' AND object_id = OBJECT_ID('dbo.CrmCustomerBankDetail'))
  CREATE UNIQUE INDEX UX_CrmCustomerBankDetail_ApplicationId ON dbo.CrmCustomerBankDetail (ApplicationId) WHERE ApplicationId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBookingDocument') AND name = 'ApplicationId')
  ALTER TABLE dbo.CrmBookingDocument ADD ApplicationId INT NULL;
GO

ALTER TABLE dbo.CrmBookingDocument ALTER COLUMN BookingId INT NULL;
GO
