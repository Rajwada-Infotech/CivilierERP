-- ============================================================
-- Migration 152: CRM Full-Fledged Parity
-- Brings the CRM module to feature parity with the Follow-Up
-- module — as its own independent, parallel set of tables.
-- Nothing here touches or replaces Followup* tables.
-- ============================================================

-- 8-step legal workflow (mirrors the Follow-Up legal milestone concept, CRM-native)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmLegalMilestone' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmLegalMilestone (
    Id                    INT IDENTITY(1,1) PRIMARY KEY,
    MilestoneNo           NVARCHAR(30)  NULL,
    BookingId             INT           NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),

    DocCollectionDue      DATE NULL, DocCollectionDone      DATE NULL, DocCollectionStatus      NVARCHAR(30) NOT NULL DEFAULT 'Pending', DocCollectionNotes      NVARCHAR(MAX) NULL,
    LegalReviewDue        DATE NULL, LegalReviewDone        DATE NULL, LegalReviewStatus        NVARCHAR(30) NOT NULL DEFAULT 'Pending', LegalReviewNotes        NVARCHAR(MAX) NULL,
    DraftingDue           DATE NULL, DraftingDone           DATE NULL, DraftingStatus           NVARCHAR(30) NOT NULL DEFAULT 'Pending', DraftingNotes           NVARCHAR(MAX) NULL,
    InternalApprovalDue   DATE NULL, InternalApprovalDone   DATE NULL, InternalApprovalStatus   NVARCHAR(30) NOT NULL DEFAULT 'Pending', InternalApprovalNotes   NVARCHAR(MAX) NULL,
    DocSharedDue          DATE NULL, DocSharedDone          DATE NULL, DocSharedStatus          NVARCHAR(30) NOT NULL DEFAULT 'Pending', DocSharedNotes          NVARCHAR(MAX) NULL,
    MutualAgreementDue    DATE NULL, MutualAgreementDone    DATE NULL, MutualAgreementStatus    NVARCHAR(30) NOT NULL DEFAULT 'Pending', MutualAgreementNotes    NVARCHAR(MAX) NULL,
    DirectorMeetingDue    DATE NULL, DirectorMeetingDone    DATE NULL, DirectorMeetingStatus    NVARCHAR(30) NOT NULL DEFAULT 'Pending', DirectorMeetingNotes    NVARCHAR(MAX) NULL,
    FinalExecutionDue     DATE NULL, FinalExecutionDone     DATE NULL, FinalExecutionStatus     NVARCHAR(30) NOT NULL DEFAULT 'Pending', FinalExecutionNotes     NVARCHAR(MAX) NULL,

    CurrentStep     INT           NOT NULL DEFAULT 1,
    OverallStatus   NVARCHAR(30)  NOT NULL DEFAULT 'In Progress',
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmLegalMilestone';
END
GO

-- NOC (organisation + bank, mirrors Follow-Up's combined NOC concept)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmNoc' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmNoc (
    Id                     INT IDENTITY(1,1) PRIMARY KEY,
    NocNo                  NVARCHAR(30)  NULL,
    BookingId              INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    -- NocType: Organisation / Bank
    NocType                NVARCHAR(30)  NOT NULL DEFAULT 'Organisation',
    NocDate                DATE          NULL,
    ApprovalDate           DATE          NULL,
    IssuedDate             DATE          NULL,
    ApprovedBy             NVARCHAR(200) NULL,
    Reason                 NVARCHAR(500) NULL,
    -- Status: Pending / Approved / Issued / Rejected
    Status                 NVARCHAR(30)  NOT NULL DEFAULT 'Pending',
    -- Bank-specific fields (populated when NocType = 'Bank')
    BankName               NVARCHAR(255) NULL,
    LoanAccountNo          NVARCHAR(100) NULL,
    LoanSanctionStatus     NVARCHAR(50)  NULL,
    LoanSanctionDate       DATE          NULL,
    LoanDisbursementStatus NVARCHAR(50)  NULL,
    LoanDisbursementDate   DATE          NULL,
    LoanAmount             DECIMAL(18,2) NULL,
    Notes                  NVARCHAR(MAX) NULL,
    CreatedBy              INT           NULL,
    CreatedAt              DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy              INT           NULL,
    UpdatedAt              DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmNoc';
END
GO

-- Sale Deed (registration & execution tracking)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmSalesDeed' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmSalesDeed (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    DeedNo              NVARCHAR(30)  NULL,
    BookingId           INT           NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    AgreementId         INT           NULL REFERENCES dbo.CrmAgreement(Id),
    DeedValue           DECIMAL(18,2) NULL,
    StampDuty           DECIMAL(18,2) NULL,
    RegistrationFee     DECIMAL(18,2) NULL,
    SubRegistrarOffice  NVARCHAR(255) NULL,
    RegistrationNo      NVARCHAR(100) NULL,
    BookNo              NVARCHAR(100) NULL,
    PartNo              NVARCHAR(100) NULL,
    DeedDate            DATE          NULL,
    RegistrationDate    DATE          NULL,
    PossessionDate      DATE          NULL,
    ExecutedBy          NVARCHAR(200) NULL,
    WitnessNames        NVARCHAR(500) NULL,
    -- Status: Draft / Executed / Registered / Overdue / Cancelled
    Status               NVARCHAR(30) NOT NULL DEFAULT 'Draft',
    Notes                NVARCHAR(MAX) NULL,
    CreatedBy            INT NULL,
    CreatedAt            DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy            INT NULL,
    UpdatedAt            DATETIME2(3) NULL
  );
  PRINT 'Created dbo.CrmSalesDeed';
END
GO

-- Pre-possession checklist
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPrePossession' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPrePossession (
    Id                      INT IDENTITY(1,1) PRIMARY KEY,
    BookingId               INT           NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    DuesClearedCheck        BIT           NOT NULL DEFAULT 0,
    DocumentationCheck      BIT           NOT NULL DEFAULT 0,
    QualityInspectionCheck  BIT           NOT NULL DEFAULT 0,
    UtilityReadinessCheck   BIT           NOT NULL DEFAULT 0,
    ScheduledInspectionDate DATE          NULL,
    InspectionCompletedDate DATE          NULL,
    -- Status: Pending / InProgress / Ready / Blocked
    Status                  NVARCHAR(30)  NOT NULL DEFAULT 'Pending',
    Notes                   NVARCHAR(MAX) NULL,
    CreatedBy               INT           NULL,
    CreatedAt               DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy               INT           NULL,
    UpdatedAt               DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmPrePossession';
END
GO

-- Possession notice (formal notice issuance to buyer)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPossessionNotice' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPossessionNotice (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    NoticeNo        NVARCHAR(30)  NULL,
    BookingId       INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    NoticeDate      DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    OfferedDate     DATE          NULL,
    ResponseDeadline DATE         NULL,
    DeliveryMode    NVARCHAR(50)  NULL, -- Post / Email / Courier / InPerson
    -- Status: Draft / Sent / Acknowledged / Disputed
    Status          NVARCHAR(30)  NOT NULL DEFAULT 'Draft',
    Notes           NVARCHAR(MAX) NULL,
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmPossessionNotice';
END
GO

-- Construction progress updates
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmConstructionUpdate' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmConstructionUpdate (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    ProjectName     NVARCHAR(200) NOT NULL,
    UpdateDate      DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    PercentComplete DECIMAL(5,2)  NULL,
    Stage           NVARCHAR(100) NULL, -- Foundation / Superstructure / Finishing / Handover-Ready
    Summary         NVARCHAR(MAX) NULL,
    PhotoUrls       NVARCHAR(MAX) NULL, -- JSON array
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmConstructionUpdate';
END
GO

-- Unified communication log across the CRM chain (calls, emails, messages, notices)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmCommunicationLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmCommunicationLog (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    ApplicationId INT           NULL REFERENCES dbo.CrmApplication(Id),
    BookingId     INT           NULL REFERENCES dbo.CrmBooking(Id),
    -- Channel: Call / Email / SMS / WhatsApp / InPerson / Letter
    Channel       NVARCHAR(30)  NOT NULL,
    -- Direction: Inbound / Outbound
    Direction     NVARCHAR(20)  NULL,
    Subject       NVARCHAR(300) NULL,
    Summary       NVARCHAR(MAX) NULL,
    ContactedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    CreatedBy     INT           NULL,
    CreatedAt     DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmCommunicationLog';
END
GO

-- Generic audit trail for all CRM entities (mirrors SaLeadAudit pattern)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmAuditLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmAuditLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    EntityType  NVARCHAR(30)  NOT NULL, -- Application / Booking / Agreement / Noc / SalesDeed / Handover
    EntityId    INT           NOT NULL,
    Field       NVARCHAR(50)  NOT NULL,
    OldValue    NVARCHAR(500) NULL,
    NewValue    NVARCHAR(500) NULL,
    ChangedBy   INT           NULL,
    ChangedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmAuditLog_Entity ON dbo.CrmAuditLog(EntityType, EntityId);
  PRINT 'Created dbo.CrmAuditLog';
END
GO

-- Payment receipts — supports partial/installment receipts against a milestone
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPaymentReceipt' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPaymentReceipt (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    ReceiptNo      NVARCHAR(30)  NULL,
    MilestoneId    INT           NOT NULL REFERENCES dbo.CrmPaymentMilestone(Id),
    Amount         DECIMAL(18,2) NOT NULL,
    ReceivedDate   DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    PaymentMode    NVARCHAR(50)  NULL,
    TransactionRef NVARCHAR(200) NULL,
    Notes          NVARCHAR(MAX) NULL,
    CreatedBy      INT           NULL,
    CreatedAt      DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmPaymentReceipt';
END
GO

-- Demand tracking on the milestone itself
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DemandRaisedAt')
BEGIN
  ALTER TABLE dbo.CrmPaymentMilestone ADD DemandRaisedAt DATETIME2(3) NULL;
  PRINT 'Added DemandRaisedAt to CrmPaymentMilestone';
END
GO

-- ── Page Definitions ──────────────────────────────────────────────────────────
DECLARE @base INT = 800;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-legal-milestones',    'Legal Milestones',      'CRM', 'CRM Legal',         'view,create,edit', @base + 5,  1, 'migration-152'),
  ('crm-noc',                 'NOC (Org & Bank)',      'CRM', 'CRM Legal',         'view,create,edit', @base + 10, 1, 'migration-152'),
  ('crm-sales-deed',          'Sale Deed',             'CRM', 'CRM Legal',         'view,create,edit', @base + 15, 1, 'migration-152'),
  ('crm-pre-possession',      'Pre-Possession Check',  'CRM', 'CRM Closure',       'view,create,edit', @base + 20, 1, 'migration-152'),
  ('crm-possession-notice',   'Possession Notice',     'CRM', 'CRM Closure',       'view,create,edit', @base + 25, 1, 'migration-152'),
  ('crm-construction-updates','Construction Updates',  'CRM', 'CRM Closure',       'view,create',      @base + 30, 1, 'migration-152'),
  ('crm-communication',       'Communication Log',     'CRM', 'CRM Pipeline',      'view,create',      @base + 35, 1, 'migration-152'),
  ('crm-dashboard',           'CRM Dashboard',         'CRM', 'CRM Pipeline',      'view',              @base + 1,  1, 'migration-152')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());

PRINT 'Seeded CRM parity PageDefinitions';
GO
