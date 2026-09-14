-- Migration 342: add Payment Mode fields to dbo.LoanSanction

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'PaymentMode')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD PaymentMode NVARCHAR(30) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'ChequeLotId')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD ChequeLotId INT NULL CONSTRAINT FK_LoanSanction_ChequeLot FOREIGN KEY REFERENCES dbo.ChequeMaster(CId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'ChequeLotNumber')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD ChequeLotNumber NVARCHAR(50) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'ChequeNo')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD ChequeNo NVARCHAR(20) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'ChequeDate')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD ChequeDate DATE NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'IsPostDated')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD IsPostDated BIT NOT NULL CONSTRAINT DF_LoanSanction_IsPostDated DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'DigitalRefNumber')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD DigitalRefNumber NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_LoanSanction_ChequeLot_ChequeNo' AND object_id = OBJECT_ID('dbo.LoanSanction')
)
BEGIN
  CREATE UNIQUE INDEX UX_LoanSanction_ChequeLot_ChequeNo
    ON dbo.LoanSanction(ChequeLotId, ChequeNo)
    WHERE ChequeLotId IS NOT NULL AND ChequeNo IS NOT NULL;
END
GO

PRINT '342-loan-sanction-payment-mode applied successfully.';
GO
