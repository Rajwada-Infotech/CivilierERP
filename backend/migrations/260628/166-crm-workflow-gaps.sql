-- ============================================================
-- Migration 166: CRM workflow gap closures
-- 1) Occupation/Income on customer KYC (Occupation mandatory, income
--    optional — matches "if applicable" in the source spec).
-- 2) Unit Change audit trail — UnitId stays otherwise immutable after
--    booking creation; changes only happen through the new authorized
--    /change-unit endpoint, always logged here.
-- 3) Required documents + responsible department per payment milestone.
-- 4) Agreement execution-date reschedule history — ProposedDateByCompany/
--    ProposedDateByCustomer are overwritten in place on CrmAgreement; this
--    preserves every prior value instead of losing it.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'Occupation')
BEGIN
  ALTER TABLE dbo.CrmCustomerBankDetail ADD Occupation NVARCHAR(100) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'AnnualIncome')
BEGIN
  ALTER TABLE dbo.CrmCustomerBankDetail ADD AnnualIncome DECIMAL(18,2) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmUnitChangeLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmUnitChangeLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    BookingId   INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    OldUnitId   INT           NULL REFERENCES dbo.UnitMaster(Id),
    NewUnitId   INT           NOT NULL REFERENCES dbo.UnitMaster(Id),
    Reason      NVARCHAR(MAX) NOT NULL,
    ChangedBy   INT           NULL,
    ChangedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmUnitChangeLog_Booking ON dbo.CrmUnitChangeLog(BookingId);
  PRINT 'Created dbo.CrmUnitChangeLog';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'RequiredDocuments')
BEGIN
  ALTER TABLE dbo.CrmPaymentMilestone ADD RequiredDocuments NVARCHAR(MAX) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'ResponsibleDepartment')
BEGIN
  ALTER TABLE dbo.CrmPaymentMilestone ADD ResponsibleDepartment NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmAgreementDateHistory' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmAgreementDateHistory (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    AgreementId  INT           NOT NULL REFERENCES dbo.CrmAgreement(Id),
    -- ProposedBy: Company / Customer
    ProposedBy   NVARCHAR(20)  NOT NULL,
    ProposedDate DATE          NOT NULL,
    Reason       NVARCHAR(MAX) NULL,
    CreatedBy    INT           NULL,
    CreatedAt    DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmAgreementDateHistory_Agreement ON dbo.CrmAgreementDateHistory(AgreementId);
  PRINT 'Created dbo.CrmAgreementDateHistory';
END
GO

PRINT 'Migration 166 complete — CRM workflow gap closures';
