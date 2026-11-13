-- 662: Deed Registration — payment management before Final Registration.
--   • Consideration date, and every change of the consideration kept as a revision (old → new total, date, reason,
--     optional valuation it follows) — the price agreed months ago can change when the land's valuation changes.
--   • Payment schedule: the instalments agreed (due date, amount, purpose).
--   • Payments themselves are the land's Payment History (LegalPayment), so they show on the land too.
--   • Final Registration needs the full consideration paid, dated on or after the last payment (checked in the app).
-- Schema; an advance already entered on the consideration becomes that land's first payment (derived, not sample data).
IF COL_LENGTH('dbo.LegalLand', 'ConsDate') IS NULL ALTER TABLE dbo.LegalLand ADD ConsDate DATE NULL;
GO
IF OBJECT_ID('dbo.LegalConsiderationRevision', 'U') IS NULL
CREATE TABLE dbo.LegalConsiderationRevision (
  RevisionId    INT IDENTITY(1,1) CONSTRAINT PK_LegalConsiderationRevision PRIMARY KEY,
  LandId        INT NOT NULL CONSTRAINT FK_LegalConsiderationRevision_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  RevisionDate  DATE NOT NULL,
  OldTotal      DECIMAL(18,2) NULL,
  NewTotal      DECIMAL(18,2) NOT NULL,
  OldRate       DECIMAL(18,2) NULL,
  NewRate       DECIMAL(18,2) NULL,
  ValuationId   INT NULL,
  Reason        NVARCHAR(1000) NULL,
  CreatedBy     INT NULL,
  CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_LegalConsiderationRevision_At DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('dbo.LegalPaymentSchedule', 'U') IS NULL
CREATE TABLE dbo.LegalPaymentSchedule (
  ScheduleId    INT IDENTITY(1,1) CONSTRAINT PK_LegalPaymentSchedule PRIMARY KEY,
  LandId        INT NOT NULL CONSTRAINT FK_LegalPaymentSchedule_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  DueDate       DATE NOT NULL,
  Amount        DECIMAL(18,2) NOT NULL,
  TxnTypeId     INT NULL,
  Remarks       NVARCHAR(1000) NULL,
  CreatedBy     INT NULL,
  CreatedAt     DATETIME2 NOT NULL CONSTRAINT DF_LegalPaymentSchedule_At DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalConsiderationRevision_Land') CREATE INDEX IX_LegalConsiderationRevision_Land ON dbo.LegalConsiderationRevision (LandId, RevisionDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalPaymentSchedule_Land') CREATE INDEX IX_LegalPaymentSchedule_Land ON dbo.LegalPaymentSchedule (LandId, DueDate);
GO
-- Existing consideration: its date and first revision; its advance becomes a payment when the land has none yet.
UPDATE dbo.LegalLand SET ConsDate = CAST(ISNULL(UpdatedAt, CreatedAt) AS DATE) WHERE ConsTotalAmount IS NOT NULL AND ConsDate IS NULL;
INSERT INTO dbo.LegalConsiderationRevision (LandId, RevisionDate, NewTotal, NewRate, Reason, CreatedBy)
SELECT l.LandId, l.ConsDate, l.ConsTotalAmount, l.ConsRate, N'Consideration agreed', l.UpdatedBy FROM dbo.LegalLand l
WHERE l.ConsTotalAmount IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalConsiderationRevision r WHERE r.LandId = l.LandId);
INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Remarks, CreatedBy)
SELECT l.LandId, l.ConsDate, (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Advance'),
       l.ConsAdvanceAmount,
       ISNULL(l.ConsPaymentModeId, (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'payment-mode' ORDER BY SortOrder)),
       N'Advance (from consideration)', l.UpdatedBy
FROM dbo.LegalLand l
WHERE l.ConsAdvanceAmount > 0 AND NOT EXISTS (SELECT 1 FROM dbo.LegalPayment p WHERE p.LandId = l.LandId)
  AND EXISTS (SELECT 1 FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Advance');
GO
