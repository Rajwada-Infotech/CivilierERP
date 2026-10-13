-- Migration 558: a resale / buy-back becomes a CASE that moves through stages.
--
-- Under the rules for passing a flat on before conveyance (RERA allottee
-- transfer; West Bengal practice), the developer first checks the seller's
-- dues and issues its NOC, the new buyer is onboarded and pays the transfer
-- fee, and a tripartite DEED OF ASSIGNMENT (seller + buyer + developer) is
-- stamped and registered at the Sub-Registrar; the final sale deed is later
-- made in the new buyer's name. A buy-back of a property whose agreement is
-- registered needs a registered CANCELLATION DEED (otherwise a cancellation
-- letter). Stamp duty and fees are entered per case from the Sub-Registrar's
-- assessment — no rate is hard-coded.
--
-- After the sale deed is registered a resale is a private sale between
-- owners: dbo.CrmOwnershipChange only records the new owner (deed copy), so
-- maintenance, service tickets and the portal follow the right person.

-- ── Case columns on dbo.CrmUnitResale ────────────────────────────────────────
IF COL_LENGTH('dbo.CrmUnitResale', 'SellerHasLoan') IS NULL ALTER TABLE dbo.CrmUnitResale ADD SellerHasLoan BIT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'SellerClearedAt') IS NULL ALTER TABLE dbo.CrmUnitResale ADD SellerClearedAt DATETIME2 NULL, SellerClearedBy INT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'NocNo') IS NULL ALTER TABLE dbo.CrmUnitResale ADD NocNo NVARCHAR(40) NULL, NocIssuedAt DATETIME2 NULL, NocIssuedBy INT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'BuyerApplicationId') IS NULL ALTER TABLE dbo.CrmUnitResale ADD BuyerApplicationId INT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'FeeInvoiceId') IS NULL ALTER TABLE dbo.CrmUnitResale ADD FeeInvoiceId INT NULL;
-- Deed: Assignment (resale) | CancellationDeed (buy-back, agreement registered) | CancellationLetter (buy-back, not registered)
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedType') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedType NVARCHAR(30) NULL;
-- Draft -> LegalApproved -> Consented -> Executed -> DutyPaid -> Registered
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedStatus') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedStatus NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedLegalApprovedAt') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedLegalApprovedAt DATETIME2 NULL, DeedLegalApprovedBy INT NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedSellerConsentAt') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedSellerConsentAt DATETIME2 NULL, DeedBuyerConsentAt DATETIME2 NULL, DeedConsentMethod NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedExecutionDate') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedExecutionDate DATE NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedStampDuty') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedStampDuty DECIMAL(18,2) NULL, DeedRegistrationFee DECIMAL(18,2) NULL,
  DeedDutyPaidAt DATETIME2 NULL, DeedDutyPaidRef NVARCHAR(100) NULL, DeedDutyPaidBy NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.CrmUnitResale', 'DeedRegNo') IS NULL ALTER TABLE dbo.CrmUnitResale ADD DeedRegNo NVARCHAR(100) NULL, DeedRegDate DATE NULL, DeedRegOffice NVARCHAR(200) NULL, DeedRegisteredBy INT NULL;
GO

-- ── Case documents ───────────────────────────────────────────────────────────
-- SellerLoanNoc | DeveloperNoc | DeedDraft | StampDutyReceipt | RegisteredDeed | CancellationLetter | Other
IF OBJECT_ID('dbo.CrmResaleDocument', 'U') IS NULL
CREATE TABLE dbo.CrmResaleDocument (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  ResaleId INT NOT NULL,
  DocumentType NVARCHAR(40) NOT NULL,
  FileName NVARCHAR(300) NULL,
  FileBase64 NVARCHAR(MAX) NULL,
  FileSize BIGINT NULL,
  MimeType NVARCHAR(150) NULL,
  Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmResaleDocument_Status DEFAULT N'Uploaded', -- Uploaded | Verified | Rejected
  Remarks NVARCHAR(1000) NULL,
  VerifiedBy INT NULL, VerifiedAt DATETIME2 NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_CrmResaleDocument_Active DEFAULT 1,
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmResaleDocument_Created DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmResaleDocument_Resale' AND object_id = OBJECT_ID('dbo.CrmResaleDocument'))
  CREATE INDEX IX_CrmResaleDocument_Resale ON dbo.CrmResaleDocument (ResaleId, DocumentType) WHERE IsActive = 1;
GO

-- ── Ownership change after the sale deed (private resale) ────────────────────
IF OBJECT_ID('dbo.CrmOwnershipChange', 'U') IS NULL
CREATE TABLE dbo.CrmOwnershipChange (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  BookingId INT NOT NULL,
  FromCustomerId INT NOT NULL,
  ToCustomerId INT NOT NULL,
  DeedNo NVARCHAR(100) NULL,
  DeedDate DATE NULL,
  RegOffice NVARCHAR(200) NULL,
  ConsiderationValue DECIMAL(18,2) NULL,
  FileName NVARCHAR(300) NULL, FileBase64 NVARCHAR(MAX) NULL, FileSize BIGINT NULL, MimeType NVARCHAR(150) NULL,
  Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmOwnershipChange_Status DEFAULT N'Pending', -- Pending | Approved | Rejected
  Notes NVARCHAR(1000) NULL,
  ApprovedBy INT NULL, ApprovedAt DATETIME2 NULL, RejectionNote NVARCHAR(500) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_CrmOwnershipChange_Active DEFAULT 1,
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmOwnershipChange_Created DEFAULT SYSDATETIME(),
  UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmOwnershipChange_Booking' AND object_id = OBJECT_ID('dbo.CrmOwnershipChange'))
  CREATE INDEX IX_CrmOwnershipChange_Booking ON dbo.CrmOwnershipChange (BookingId) WHERE IsActive = 1;
GO
