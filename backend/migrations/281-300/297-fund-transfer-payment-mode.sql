-- Migration 297: add Payment Mode + cheque/digital-reference detail to
-- dbo.FundTransfer, mirroring dbo.NewPayment's Mode/cheque fields so a Fund
-- Transfer can record exactly how the cash actually moved (Cash / Cheque /
-- Post-Dated Cheque / NEFT / UPI / RTGS / IMPS / Card), not just which two
-- ledger accounts it moved between.
--
-- Cheque leaf tracking reuses the existing dbo.ChequeMaster lot mechanism
-- (see backend/routes/newPayment.js's /cheque-lots, /cheque-numbers/:lotId,
-- /deduct-cheque) — a cheque number "used" by a Fund Transfer is recorded
-- here exactly like NewPayment.PChequeNo/PChequeLotId, and newPayment.js is
-- updated in the same change to also treat FundTransfer's cheque numbers as
-- unavailable, so the same physical cheque leaf can't be issued twice
-- across the two modules.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'Mode')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD Mode NVARCHAR(30) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'ChequeLotId')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD ChequeLotId INT NULL CONSTRAINT FK_FT_ChequeLot FOREIGN KEY REFERENCES dbo.ChequeMaster(CId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'ChequeLotNumber')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD ChequeLotNumber NVARCHAR(50) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'ChequeNo')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD ChequeNo NVARCHAR(20) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'ChequeDate')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD ChequeDate DATE NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'IsPostDated')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD IsPostDated BIT NOT NULL CONSTRAINT DF_FT_IsPostDated DEFAULT 0;
END
GO

-- Single generic reference column for NEFT/UPI/RTGS/IMPS/Card — these modes
-- don't have the same leaf-consumption/uniqueness concern a cheque does, so
-- one free-text reference field (matching what the underlying bank
-- statement/receipt would show) is enough, rather than five near-identical
-- mode-specific columns.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FundTransfer') AND name = 'DigitalRefNumber')
BEGIN
  ALTER TABLE dbo.FundTransfer ADD DigitalRefNumber NVARCHAR(100) NULL;
END
GO

-- Prevent the same cheque leaf from being reserved twice *within* Fund
-- Transfer itself (cross-module dedup against NewPayment is enforced in
-- application code — see newPayment.js's /cheque-numbers and /deduct-cheque
-- changes in this same commit).
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_FundTransfer_ChequeLot_ChequeNo' AND object_id = OBJECT_ID('dbo.FundTransfer')
)
BEGIN
  CREATE UNIQUE INDEX UX_FundTransfer_ChequeLot_ChequeNo
    ON dbo.FundTransfer(ChequeLotId, ChequeNo)
    WHERE ChequeLotId IS NOT NULL AND ChequeNo IS NOT NULL;
END
GO

PRINT '297-fund-transfer-payment-mode applied successfully.';
GO
