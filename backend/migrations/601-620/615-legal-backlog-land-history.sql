-- 615 · Existing / backlog land and the full land history.
-- One central land register for both kinds of land: a land is either a New Acquisition (it goes through the
-- 31-step pipeline) or Existing / Backlog (already owned; its history is entered directly, section by section).
-- The existing history tables are extended rather than duplicated; two new ones are added (legal records and
-- land tax). No records are inserted except missing document categories (a fixed reference list).
SET NOCOUNT ON;
GO

-- ── Land: entry type, possession, acquisition date, quick identifiers ─────────────────────────────
IF COL_LENGTH(N'dbo.LegalLand', N'EntryType') IS NULL
  ALTER TABLE dbo.LegalLand ADD EntryType NVARCHAR(20) NOT NULL
    CONSTRAINT DF_LegalLand_EntryType DEFAULT N'New Acquisition'
    CONSTRAINT CK_LegalLand_EntryType CHECK (EntryType IN (N'New Acquisition', N'Existing / Backlog'));
IF COL_LENGTH(N'dbo.LegalLand', N'PossessionStatus') IS NULL
  ALTER TABLE dbo.LegalLand ADD PossessionStatus NVARCHAR(30) NULL;
-- When the land was acquired (history) — not when it was entered here (that is CreatedAt).
IF COL_LENGTH(N'dbo.LegalLand', N'AcquisitionDate') IS NULL
  ALTER TABLE dbo.LegalLand ADD AcquisitionDate DATE NULL, AcquisitionDateApprox BIT NOT NULL CONSTRAINT DF_LegalLand_AcqApprox DEFAULT 0;
-- The land's own Dag / Khatian numbers for search and duplicate checks (the full RS / LR records stay in their tables).
IF COL_LENGTH(N'dbo.LegalLand', N'RsDagNo') IS NULL
  ALTER TABLE dbo.LegalLand ADD RsDagNo NVARCHAR(60) NULL, LrDagNo NVARCHAR(60) NULL, RsKhatianNo NVARCHAR(60) NULL, LrKhatianNo NVARCHAR(60) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LegalLand_Mouza_Dag')
  CREATE INDEX IX_LegalLand_Mouza_Dag ON dbo.LegalLand (MouzaId, RsDagNo, LrDagNo);
GO

-- ── Acquisition / transfer history: agreement date and deed type ──────────────────────────────────
IF COL_LENGTH(N'dbo.LegalOwnershipEvent', N'AgreementDate') IS NULL
  ALTER TABLE dbo.LegalOwnershipEvent ADD AgreementDate DATE NULL,
    DeedTypeId INT NULL CONSTRAINT FK_LegalOwnershipEvent_DeedType REFERENCES dbo.LegalDeedType(DeedTypeId);
GO

-- ── Loans & mortgages: the loan side and the release ──────────────────────────────────────────────
IF COL_LENGTH(N'dbo.LegalMortgage', N'LoanStatus') IS NULL
  ALTER TABLE dbo.LegalMortgage ADD
    LoanType NVARCHAR(60) NULL,
    LoanStatus NVARCHAR(20) NULL CONSTRAINT CK_LegalMortgage_LoanStatus CHECK (LoanStatus IN (N'Active', N'Closed', N'Overdue', N'Unknown')),
    MortgageDeedNo NVARCHAR(80) NULL,
    MortgageRegDate DATE NULL,
    LoanClosureDate DATE NULL,
    BankNocDetails NVARCHAR(500) NULL,
    AgreementFileId INT NULL CONSTRAINT FK_LegalMortgage_AgreementFile REFERENCES dbo.LegalMasterFile(FileId),
    MortgageDeedFileId INT NULL CONSTRAINT FK_LegalMortgage_DeedFile REFERENCES dbo.LegalMasterFile(FileId);
GO

-- ── Mutation: the case number ─────────────────────────────────────────────────────────────────────
IF COL_LENGTH(N'dbo.LegalMutation', N'CaseNo') IS NULL
  ALTER TABLE dbo.LegalMutation ADD CaseNo NVARCHAR(80) NULL;
GO

-- ── Payments: a historical payment need not belong to a purchase recorded here ───────────────────
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.LegalPayment') AND name = N'TransactionId' AND is_nullable = 0)
  ALTER TABLE dbo.LegalPayment ALTER COLUMN TransactionId INT NULL;
GO

-- ── Legal history: notices, orders, judgments, POA, NOC, affidavits, reports… (court cases stay in LegalCase)
IF OBJECT_ID(N'dbo.LegalLandLegalRecord', N'U') IS NULL
CREATE TABLE dbo.LegalLandLegalRecord (
  LegalRecordId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalLandLegalRecord PRIMARY KEY,
  LandId INT NOT NULL CONSTRAINT FK_LegalLandLegalRecord_Land REFERENCES dbo.LegalLand(LandId),
  RecordType NVARCHAR(40) NOT NULL,
  CaseNumber NVARCHAR(80) NULL,
  CourtAuthority NVARCHAR(200) NULL,
  PartiesInvolved NVARCHAR(500) NULL,
  FilingDate DATE NULL,
  OrderDate DATE NULL,
  RecordStatus NVARCHAR(30) NULL,
  Description NVARCHAR(2000) NULL,
  RelatedPerson NVARCHAR(200) NULL,
  DocumentRef NVARCHAR(120) NULL,
  DocFileId INT NULL CONSTRAINT FK_LegalLandLegalRecord_File REFERENCES dbo.LegalMasterFile(FileId),
  VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandLegalRecord_Verif DEFAULT N'Pending',
  VerifiedBy INT NULL CONSTRAINT FK_LegalLandLegalRecord_VerifiedBy REFERENCES dbo.users(id),
  VerifiedAt DATETIME2 NULL,
  Remarks NVARCHAR(1000) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_LegalLandLegalRecord_IsActive DEFAULT 1,
  CreatedBy INT NULL CONSTRAINT FK_LegalLandLegalRecord_CreatedBy REFERENCES dbo.users(id),
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandLegalRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL CONSTRAINT FK_LegalLandLegalRecord_UpdatedBy REFERENCES dbo.users(id),
  UpdatedAt DATETIME2 NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LegalLandLegalRecord_Land')
  CREATE INDEX IX_LegalLandLegalRecord_Land ON dbo.LegalLandLegalRecord (LandId);
GO

-- ── Land tax / Khajna ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.LegalLandTax', N'U') IS NULL
CREATE TABLE dbo.LegalLandTax (
  TaxId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LegalLandTax PRIMARY KEY,
  LandId INT NOT NULL CONSTRAINT FK_LegalLandTax_Land REFERENCES dbo.LegalLand(LandId),
  TaxYear NVARCHAR(9) NOT NULL,
  PaymentDate DATE NULL,
  Amount DECIMAL(18, 2) NULL,
  ReceiptNo NVARCHAR(60) NULL,
  PaymentRef NVARCHAR(100) NULL,
  RelatedOwner NVARCHAR(200) NULL,
  ReceiptFileId INT NULL CONSTRAINT FK_LegalLandTax_File REFERENCES dbo.LegalMasterFile(FileId),
  VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandTax_Verif DEFAULT N'Pending',
  VerifiedBy INT NULL CONSTRAINT FK_LegalLandTax_VerifiedBy REFERENCES dbo.users(id),
  VerifiedAt DATETIME2 NULL,
  Remarks NVARCHAR(1000) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_LegalLandTax_IsActive DEFAULT 1,
  CreatedBy INT NULL CONSTRAINT FK_LegalLandTax_CreatedBy REFERENCES dbo.users(id),
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandTax_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL CONSTRAINT FK_LegalLandTax_UpdatedBy REFERENCES dbo.users(id),
  UpdatedAt DATETIME2 NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LegalLandTax_Land')
  CREATE INDEX IX_LegalLandTax_Land ON dbo.LegalLandTax (LandId, TaxYear);
GO

-- ── Documents: what a document relates to, and its registration date ──────────────────────────────
IF COL_LENGTH(N'dbo.LegalLandDocument', N'RegistrationDate') IS NULL
  ALTER TABLE dbo.LegalLandDocument ADD
    RegistrationDate DATE NULL,
    RelatedOwner NVARCHAR(200) NULL,
    RelatedLegalRecordId INT NULL CONSTRAINT FK_LegalLandDocument_LegalRecord REFERENCES dbo.LegalLandLegalRecord(LegalRecordId),
    RelatedMortgageId INT NULL CONSTRAINT FK_LegalLandDocument_Mortgage REFERENCES dbo.LegalMortgage(MortgageId),
    Description NVARCHAR(1000) NULL;
GO

-- ── Document categories the archive needs (fixed reference list; existing ones are kept) ──────────
DECLARE @t TABLE (Code NVARCHAR(40), Name NVARCHAR(150), Category NVARCHAR(40), Sensitivity NVARCHAR(30), Retention NVARCHAR(20));
INSERT INTO @t VALUES
  (N'SALE-DEED', N'Sale Deed', N'Title', N'Confidential', N'Permanent'),
  (N'GIFT-DEED', N'Gift Deed', N'Title', N'Confidential', N'Permanent'),
  (N'PARTITION-DEED', N'Partition Deed', N'Title', N'Confidential', N'Permanent'),
  (N'RS-KHATIAN', N'RS Khatian', N'Land Record', N'Internal', N'Permanent'),
  (N'LR-KHATIAN', N'LR Khatian', N'Land Record', N'Internal', N'Permanent'),
  (N'RS-PLOT', N'RS Plot Record', N'Land Record', N'Internal', N'Permanent'),
  (N'LR-PLOT', N'LR Plot Record', N'Land Record', N'Internal', N'Permanent'),
  (N'MUTATION-ORDER', N'Mutation Order', N'Land Record', N'Internal', N'Permanent'),
  (N'REG-CERT', N'Registration Certificate', N'Registration', N'Confidential', N'Permanent'),
  (N'CERT-COPY', N'Certified Copy', N'Land Record', N'Internal', N'Permanent'),
  (N'COURT-ORDER', N'Court Order', N'Legal', N'Confidential', N'Permanent'),
  (N'LEGAL-OPINION', N'Legal Opinion', N'Legal', N'Confidential', N'Permanent'),
  (N'SURVEY-REPORT', N'Survey Report', N'Survey', N'Internal', N'Permanent'),
  (N'VALUATION-REPORT', N'Valuation Report', N'Survey', N'Internal', N'10 Years'),
  (N'LOAN-AGREEMENT', N'Loan Agreement', N'Loan & Mortgage', N'Confidential', N'Permanent'),
  (N'MORTGAGE-DEED', N'Mortgage Deed', N'Loan & Mortgage', N'Confidential', N'Permanent'),
  (N'MORTGAGE-RELEASE', N'Mortgage Release Document', N'Loan & Mortgage', N'Confidential', N'Permanent'),
  (N'BANK-NOC', N'Bank NOC', N'Loan & Mortgage', N'Confidential', N'Permanent'),
  (N'PAYMENT-RECEIPT', N'Payment Receipt', N'Payment', N'Internal', N'8 Years'),
  (N'OTHER', N'Other Document', N'Other', N'Internal', N'Permanent');
INSERT INTO dbo.LegalDocumentType (DocTypeCode, DocTypeName, Category, Sensitivity, RetentionClass, CreatedBy)
SELECT t.Code, t.Name, t.Category, t.Sensitivity, t.Retention, NULL FROM @t t
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalDocumentType d WHERE d.DocTypeCode = t.Code);
GO
