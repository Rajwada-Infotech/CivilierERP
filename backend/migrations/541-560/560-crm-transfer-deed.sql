-- Migration 560: the TRANSFER DEED of a resale / buy-back case — its own legal
-- chain, the way an Agreement for Sale has one (Agreement -> AFS Query
-- Payment -> AFS Registry), kept apart from it so the live agreement pages are
-- untouched.
--
--   Resale  : tripartite DEED OF ASSIGNMENT — seller + buyer + developer
--   Buy-back: CANCELLATION DEED of a registered agreement — seller + developer
--
-- Legal workspace (dbo.CrmTransferDeed): legal executive -> mandatory papers
-- requested / uploaded / verified -> Legal Head approval (workflow
-- 'crm-transfer-deeds') -> sent to the parties, who approve or ask for a
-- recheck in the portal (or staff record it for them: proxy) -> signing date
-- proposed, accepted by every party, approved (workflow
-- 'crm-transfer-deed-date') -> executed.
-- Stamp duty (dbo.CrmTransferDeedPayment): info sent -> paid with proof ->
-- confirmed. Registry (dbo.CrmTransferDeedRegistry): Sub-Registrar visit
-- scheduled -> registered with number and a verified copy.
-- dbo.CrmTransferDeedLog keeps every action (who, on whose behalf, how).

IF OBJECT_ID('dbo.CrmTransferDeed', 'U') IS NULL
CREATE TABLE dbo.CrmTransferDeed (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  DeedNo NVARCHAR(40) NOT NULL,
  ResaleId INT NOT NULL,
  BookingId INT NOT NULL,
  DeedType NVARCHAR(30) NOT NULL,                 -- Assignment | CancellationDeed
  Status NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmTransferDeed_Status DEFAULT N'Draft',
  LegalExecutiveId INT NULL,
  SeniorApprovalStatus NVARCHAR(20) NULL,          -- Pending | Approved | Rejected (workflow crm-transfer-deeds)
  SeniorApprovedBy INT NULL, SeniorApprovedAt DATETIME2 NULL, SeniorRemarks NVARCHAR(1000) NULL,
  SentToPartiesAt DATETIME2 NULL,
  SellerApproval NVARCHAR(20) NULL, SellerApprovedAt DATETIME2 NULL, SellerRemarks NVARCHAR(1000) NULL, SellerViaProxy BIT NULL,
  BuyerApproval NVARCHAR(20) NULL, BuyerApprovedAt DATETIME2 NULL, BuyerRemarks NVARCHAR(1000) NULL, BuyerViaProxy BIT NULL,
  ProposedDate DATE NULL, ProposedBy NVARCHAR(20) NULL, -- Company | Seller | Buyer
  SellerDateAccepted BIT NULL, BuyerDateAccepted BIT NULL,
  DateApprovalStatus NVARCHAR(20) NULL,            -- Pending | Approved | Rejected (workflow crm-transfer-deed-date)
  DeedDate DATE NULL,
  ExecutedAt DATETIME2 NULL, ExecutedBy INT NULL,
  VersionNo INT NOT NULL CONSTRAINT DF_CrmTransferDeed_Version DEFAULT 1,
  RecheckCount INT NOT NULL CONSTRAINT DF_CrmTransferDeed_Recheck DEFAULT 0,
  IsActive BIT NOT NULL CONSTRAINT DF_CrmTransferDeed_Active DEFAULT 1,
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmTransferDeed_Created DEFAULT SYSDATETIME(),
  UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL
);
GO
-- One live deed per case.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmTransferDeed_Resale' AND object_id = OBJECT_ID('dbo.CrmTransferDeed'))
  CREATE UNIQUE INDEX UX_CrmTransferDeed_Resale ON dbo.CrmTransferDeed (ResaleId) WHERE IsActive = 1 AND Status <> N'Cancelled';
GO

IF OBJECT_ID('dbo.CrmTransferDeedDocument', 'U') IS NULL
CREATE TABLE dbo.CrmTransferDeedDocument (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  DeedId INT NOT NULL,
  DocumentType NVARCHAR(40) NOT NULL,
  Label NVARCHAR(200) NOT NULL,
  Party NVARCHAR(20) NOT NULL,                     -- Seller | Buyer | Company
  IsMandatory BIT NOT NULL CONSTRAINT DF_CrmTDDoc_Mandatory DEFAULT 1,
  Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmTDDoc_Status DEFAULT N'Requested', -- Requested | Uploaded | Verified | Rejected
  FileName NVARCHAR(300) NULL, FileBase64 NVARCHAR(MAX) NULL, FileSize BIGINT NULL, MimeType NVARCHAR(150) NULL,
  Remarks NVARCHAR(1000) NULL,
  UploadedByType NVARCHAR(20) NULL,                -- Staff | Portal | Proxy
  UploadedBy INT NULL, UploadedAt DATETIME2 NULL,
  VerifiedBy INT NULL, VerifiedAt DATETIME2 NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_CrmTDDoc_Active DEFAULT 1,
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmTDDoc_Created DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmTDDoc_Deed' AND object_id = OBJECT_ID('dbo.CrmTransferDeedDocument'))
  CREATE INDEX IX_CrmTDDoc_Deed ON dbo.CrmTransferDeedDocument (DeedId) WHERE IsActive = 1;
GO

IF OBJECT_ID('dbo.CrmTransferDeedLog', 'U') IS NULL
CREATE TABLE dbo.CrmTransferDeedLog (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  DeedId INT NOT NULL,
  Action NVARCHAR(60) NOT NULL,
  Party NVARCHAR(20) NULL,                         -- whose action it is (Seller / Buyer / Company)
  ActorType NVARCHAR(20) NOT NULL,                 -- Staff | Portal | Proxy
  ActorUserId INT NULL, PortalCustomerId INT NULL,
  Method NVARCHAR(30) NULL,                        -- proxy: Phone | InPerson | Email | WhatsApp | Other
  Remarks NVARCHAR(1000) NULL,
  At DATETIME2 NOT NULL CONSTRAINT DF_CrmTDLog_At DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmTDLog_Deed' AND object_id = OBJECT_ID('dbo.CrmTransferDeedLog'))
  CREATE INDEX IX_CrmTDLog_Deed ON dbo.CrmTransferDeedLog (DeedId, At);
GO

IF OBJECT_ID('dbo.CrmTransferDeedPayment', 'U') IS NULL
CREATE TABLE dbo.CrmTransferDeedPayment (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  DeedId INT NOT NULL,
  Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmTDPay_Status DEFAULT N'InfoSent', -- InfoSent | ProofUploaded | Confirmed | Rejected
  StampDuty DECIMAL(18,2) NOT NULL, RegistrationFee DECIMAL(18,2) NOT NULL,
  PayableBy NVARCHAR(20) NOT NULL,                 -- Buyer | Seller | Developer | Shared
  InfoSentAt DATETIME2 NULL, InfoSentBy INT NULL, InfoRemarks NVARCHAR(1000) NULL,
  PaidRef NVARCHAR(100) NULL, PaidOn DATE NULL, AmountPaid DECIMAL(18,2) NULL,
  ProofFileName NVARCHAR(300) NULL, ProofBase64 NVARCHAR(MAX) NULL, ProofMimeType NVARCHAR(150) NULL, ProofUploadedAt DATETIME2 NULL, ProofUploadedByType NVARCHAR(20) NULL,
  ConfirmedBy INT NULL, ConfirmedAt DATETIME2 NULL, ConfirmRemarks NVARCHAR(1000) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_CrmTDPay_Active DEFAULT 1,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmTDPay_Created DEFAULT SYSDATETIME(), UpdatedAt DATETIME2 NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmTDPay_Deed' AND object_id = OBJECT_ID('dbo.CrmTransferDeedPayment'))
  CREATE UNIQUE INDEX UX_CrmTDPay_Deed ON dbo.CrmTransferDeedPayment (DeedId) WHERE IsActive = 1;
GO

IF OBJECT_ID('dbo.CrmTransferDeedRegistry', 'U') IS NULL
CREATE TABLE dbo.CrmTransferDeedRegistry (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  DeedId INT NOT NULL,
  Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CrmTDReg_Status DEFAULT N'Scheduled', -- Scheduled | Completed | Cancelled
  Office NVARCHAR(200) NOT NULL, ScheduledAt DATETIME2 NOT NULL, Attendees NVARCHAR(500) NULL,
  RegNo NVARCHAR(100) NULL, RegDate DATE NULL,
  ScheduledBy INT NULL, CompletedBy INT NULL, CompletedAt DATETIME2 NULL, Remarks NVARCHAR(1000) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_CrmTDReg_Active DEFAULT 1,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmTDReg_Created DEFAULT SYSDATETIME(), UpdatedAt DATETIME2 NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_CrmTDReg_Deed' AND object_id = OBJECT_ID('dbo.CrmTransferDeedRegistry'))
  CREATE UNIQUE INDEX UX_CrmTDReg_Deed ON dbo.CrmTransferDeedRegistry (DeedId) WHERE IsActive = 1 AND Status <> N'Cancelled';
GO

-- ── Approval workflows: start from who approves the agreement's legal papers
-- and its date today — copied from those workflows' levels and people when
-- this runs, never a fixed role or id. Approval Setup edits them separately
-- afterwards. Seeded only when nothing targets the module yet.
IF OBJECT_ID('dbo.ApprovalWorkflows', 'U') IS NOT NULL
BEGIN
  DECLARE @pairs TABLE (NewModule NVARCHAR(100), FromModule NVARCHAR(100), Name NVARCHAR(200), Tbl NVARCHAR(100), Descr NVARCHAR(500));
  INSERT INTO @pairs VALUES
    (N'crm-transfer-deeds', N'crm-agreements', N'CRM Transfer Deed — Legal Head Approval', N'CrmTransferDeed',
     N'Deed of assignment / cancellation deed of a resale or buy-back, before it goes to the parties. Started from the agreement''s senior approval.'),
    (N'crm-transfer-deed-date', N'crm-agreement-date', N'CRM Transfer Deed — Date Approval', N'CrmTransferDeedDate',
     N'The signing date every party accepted, before it is fixed. Started from the agreement''s date approval.');
  DECLARE @m NVARCHAR(100), @f NVARCHAR(100), @n NVARCHAR(200), @t NVARCHAR(100), @d NVARCHAR(500);
  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT NewModule, FromModule, Name, Tbl, Descr FROM @pairs;
  OPEN cur; FETCH NEXT FROM cur INTO @m, @f, @n, @t, @d;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE N'%"' + @m + N'"%')
    BEGIN
      INSERT INTO dbo.ApprovalWorkflows (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
      SELECT TOP 1 @n, @t, w.Levels, w.Approvers, N'Active', @d, N'migration-560', SYSDATETIME(), ISNULL(w.type, N'sequential'),
             N'["' + @m + N'"]', 1, ISNULL(w.LevelsJson, N'[]'), w.LevelsData
      FROM dbo.ApprovalWorkflows w WHERE w.modules LIKE N'%"' + @f + N'"%' AND w.active = 1 ORDER BY w.Id;
      IF @@ROWCOUNT = 0 PRINT CONCAT('Migration 560: no ', @f, ' workflow to start ', @m, ' from — set it up in Approval Setup.');
    END
    FETCH NEXT FROM cur INTO @m, @f, @n, @t, @d;
  END
  CLOSE cur; DEALLOCATE cur;
END
GO
