-- Migration 458: Payment Mode + cheque/digital-reference detail on
-- dbo.JournalVoucher, mirroring dbo.FundTransfer (migration 297) so a JV can
-- record how a settlement actually moved (Cash / Cheque / Post-Dated Cheque /
-- NEFT / UPI / RTGS / IMPS / Card) and which bank account / cheque leaf it used.
--
-- Cheque leaves come from the same dbo.ChequeMaster lots as Payment, Fund
-- Transfer and Loan Sanction; the cross-module "already used" checks live in
-- application code (backend/utils/settlementMode.js + newPayment.js's
-- /cheque-numbers and /deduct-cheque), which now also count Journal Vouchers.
--
-- All columns are nullable: a plain journal has no mode at all.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'Mode')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD Mode NVARCHAR(30) NULL;
END
GO

-- The bank account (dbo.AccountHeadMaster / BankMaster id) the settlement ran
-- through — the cheque book being drawn from belongs to it.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'BankId')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD BankId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'ChequeLotId')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD ChequeLotId INT NULL CONSTRAINT FK_JV_ChequeLot FOREIGN KEY REFERENCES dbo.ChequeMaster(CId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'ChequeLotNumber')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD ChequeLotNumber NVARCHAR(50) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'ChequeNo')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD ChequeNo NVARCHAR(20) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'ChequeDate')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD ChequeDate DATE NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'IsPostDated')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD IsPostDated BIT NOT NULL CONSTRAINT DF_JV_IsPostDated DEFAULT 0;
END
GO

-- One generic reference for NEFT/UPI/RTGS/IMPS/Card (UTR / transaction id / auth code).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.JournalVoucher') AND name = 'DigitalRefNumber')
BEGIN
  ALTER TABLE dbo.JournalVoucher ADD DigitalRefNumber NVARCHAR(100) NULL;
END
GO

PRINT '458-journal-voucher-payment-mode applied successfully.';
GO
