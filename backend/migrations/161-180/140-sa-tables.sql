-- 01-sa-tables.sql
-- Creates all Sales Automation tables.
-- Idempotent: every table guarded by IF NOT EXISTS.

-- ── Social Media Platform ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaSocialMediaPlatform' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaSocialMediaPlatform (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    Name            NVARCHAR(150)  NOT NULL,
    PlatformType    NVARCHAR(50)   NULL,
    AccountDetails  NVARCHAR(MAX)  NULL,
    Notes           NVARCHAR(MAX)  NULL,
    IsActive        BIT            NOT NULL CONSTRAINT DF_SaSocialMedia_IsActive  DEFAULT (1),
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_SaSocialMedia_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy       INT            NULL,
    UpdatedAt       DATETIME2(3)   NULL
  );
  CREATE INDEX IX_SaSocialMedia_Active ON dbo.SaSocialMediaPlatform(IsActive) INCLUDE (Name, PlatformType);
END
GO

-- ── Campaign ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaCampaign' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaCampaign (
    Id                 INT            IDENTITY(1,1) PRIMARY KEY,
    CampaignCode       NVARCHAR(50)   NOT NULL,
    Name               NVARCHAR(200)  NOT NULL,
    Objective          NVARCHAR(MAX)  NULL,
    PlatformId         INT            NOT NULL,
    StartDate          DATE           NULL,
    EndDate            DATE           NULL,
    Budget             DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaCampaign_Budget    DEFAULT (0),
    Status             NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaCampaign_Status    DEFAULT ('Active'),
    MarketingManagerId INT            NULL,
    IsActive           BIT            NOT NULL CONSTRAINT DF_SaCampaign_IsActive  DEFAULT (1),
    CreatedBy          INT            NULL,
    CreatedAt          DATETIME2(3)   NOT NULL CONSTRAINT DF_SaCampaign_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy          INT            NULL,
    UpdatedAt          DATETIME2(3)   NULL,
    CONSTRAINT FK_SaCampaign_Platform FOREIGN KEY (PlatformId) REFERENCES dbo.SaSocialMediaPlatform(Id),
    CONSTRAINT UQ_SaCampaign_Code UNIQUE (CampaignCode)
  );
  CREATE INDEX IX_SaCampaign_Platform ON dbo.SaCampaign(PlatformId) INCLUDE (Name, Status, IsActive);
END
GO

-- ── Ad ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaAd' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaAd (
    Id            INT            IDENTITY(1,1) PRIMARY KEY,
    CampaignId    INT            NOT NULL,
    Name          NVARCHAR(200)  NOT NULL,
    CreativeRef   NVARCHAR(500)  NULL,
    AdType        NVARCHAR(50)   NULL,
    Budget        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaAd_Budget     DEFAULT (0),
    DailySpend    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaAd_DailySpend DEFAULT (0),
    Spent         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaAd_Spent      DEFAULT (0),
    Status        NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaAd_Status     DEFAULT ('Active'),
    RunningSince  DATE           NULL,
    IsActive      BIT            NOT NULL CONSTRAINT DF_SaAd_IsActive   DEFAULT (1),
    CreatedBy     INT            NULL,
    CreatedAt     DATETIME2(3)   NOT NULL CONSTRAINT DF_SaAd_CreatedAt  DEFAULT (SYSDATETIME()),
    UpdatedBy     INT            NULL,
    UpdatedAt     DATETIME2(3)   NULL,
    CONSTRAINT FK_SaAd_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.SaCampaign(Id)
  );
  CREATE INDEX IX_SaAd_Campaign ON dbo.SaAd(CampaignId) INCLUDE (Name, Status, IsActive);
END
GO

-- ── Lead ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLead' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLead (
    Id                    INT            IDENTITY(1,1) PRIMARY KEY,
    LeadUid               NVARCHAR(50)   NOT NULL CONSTRAINT UQ_SaLead_Uid UNIQUE,
    CustomerName          NVARCHAR(200)  NOT NULL,
    Mobile                NVARCHAR(20)   NOT NULL,
    AltMobile             NVARCHAR(20)   NULL,
    Email                 NVARCHAR(200)  NULL,
    PlatformId            INT            NULL CONSTRAINT FK_SaLead_Platform FOREIGN KEY REFERENCES dbo.SaSocialMediaPlatform(Id),
    CampaignId            INT            NULL CONSTRAINT FK_SaLead_Campaign FOREIGN KEY REFERENCES dbo.SaCampaign(Id),
    AdId                  INT            NULL CONSTRAINT FK_SaLead_Ad       FOREIGN KEY REFERENCES dbo.SaAd(Id),
    DateGenerated         DATE           NOT NULL CONSTRAINT DF_SaLead_DateGenerated DEFAULT (CAST(SYSDATETIME() AS DATE)),
    CustomerRemarks       NVARCHAR(MAX)  NULL,
    Status                NVARCHAR(30)   NOT NULL CONSTRAINT DF_SaLead_Status   DEFAULT ('New'),
    Classification        NVARCHAR(30)   NULL,
    AssignedTeamLeadId    INT            NULL,
    AssignedSalespersonId INT            NULL,
    FollowupCustomerId    INT            NULL,
    BookingId             INT            NULL,
    IsActive              BIT            NOT NULL CONSTRAINT DF_SaLead_IsActive DEFAULT (1),
    CreatedBy             INT            NULL,
    CreatedAt             DATETIME2(3)   NOT NULL CONSTRAINT DF_SaLead_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy             INT            NULL,
    UpdatedAt             DATETIME2(3)   NULL
  );
  CREATE INDEX IX_SaLead_Status   ON dbo.SaLead(Status) INCLUDE (CustomerName, Mobile, AssignedSalespersonId);
  CREATE INDEX IX_SaLead_Campaign ON dbo.SaLead(CampaignId, AdId) INCLUDE (Status, DateGenerated);
END
GO

-- ── Lead Distribution ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadDistribution' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadDistribution (
    Id            INT          IDENTITY(1,1) PRIMARY KEY,
    LeadId        INT          NOT NULL CONSTRAINT FK_SaLeadDist_Lead FOREIGN KEY REFERENCES dbo.SaLead(Id),
    FromUserId    INT          NOT NULL,
    ToUserId      INT          NOT NULL,
    Level         TINYINT      NOT NULL,
    Method        NVARCHAR(20) NOT NULL CONSTRAINT DF_SaLeadDist_Method DEFAULT ('Equal'),
    DistributedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SaLeadDist_At    DEFAULT (SYSDATETIME()),
    DistributedBy INT          NULL
  );
  CREATE INDEX IX_SaLeadDist_Lead   ON dbo.SaLeadDistribution(LeadId);
  CREATE INDEX IX_SaLeadDist_ToUser ON dbo.SaLeadDistribution(ToUserId, Level);
END
GO

-- ── Inquiry Call ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaInquiryCall' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaInquiryCall (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    LeadId          INT            NOT NULL CONSTRAINT FK_SaInquiry_Lead FOREIGN KEY REFERENCES dbo.SaLead(Id),
    SalespersonId   INT            NULL,
    CallTime        DATETIME2(3)   NOT NULL CONSTRAINT DF_SaInquiry_CallTime  DEFAULT (SYSDATETIME()),
    DurationSeconds INT            NULL,
    RecordingUrl    NVARCHAR(500)  NULL,
    Outcome         NVARCHAR(50)   NULL,
    Remarks         NVARCHAR(MAX)  NULL,
    Classification  NVARCHAR(30)   NULL,
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_SaInquiry_CreatedAt DEFAULT (SYSDATETIME())
  );
  CREATE INDEX IX_SaInquiry_Lead        ON dbo.SaInquiryCall(LeadId);
  CREATE INDEX IX_SaInquiry_Salesperson ON dbo.SaInquiryCall(SalespersonId, CallTime);
END
GO

-- ── Site Visit ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaSiteVisit' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaSiteVisit (
    Id             INT            IDENTITY(1,1) PRIMARY KEY,
    LeadId         INT            NOT NULL CONSTRAINT FK_SaSiteVisit_Lead     FOREIGN KEY REFERENCES dbo.SaLead(Id),
    ProjectName    NVARCHAR(200)  NULL,
    PreferredDate  DATE           NULL,
    PreferredTime  NVARCHAR(20)   NULL,
    ExecutiveId    INT            NULL,
    PickupRequired BIT            NOT NULL CONSTRAINT DF_SaSiteVisit_Pickup   DEFAULT (0),
    CustomerNotes  NVARCHAR(MAX)  NULL,
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaSiteVisit_Status   DEFAULT ('Scheduled'),
    IsActive       BIT            NOT NULL CONSTRAINT DF_SaSiteVisit_IsActive DEFAULT (1),
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2(3)   NOT NULL CONSTRAINT DF_SaSiteVisit_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2(3)   NULL
  );
  CREATE INDEX IX_SaSiteVisit_Lead ON dbo.SaSiteVisit(LeadId);
  CREATE INDEX IX_SaSiteVisit_Date ON dbo.SaSiteVisit(PreferredDate, Status);
END
GO

-- ── Marketing Invoice ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaMarketingInvoice' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaMarketingInvoice (
    Id            INT            IDENTITY(1,1) PRIMARY KEY,
    InvoiceNumber NVARCHAR(50)   NOT NULL CONSTRAINT UQ_SaMarketingInvoice_No UNIQUE,
    VendorName    NVARCHAR(200)  NULL,
    CampaignId    INT            NULL CONSTRAINT FK_SaMktInv_Campaign FOREIGN KEY REFERENCES dbo.SaCampaign(Id),
    AdId          INT            NULL CONSTRAINT FK_SaMktInv_Ad       FOREIGN KEY REFERENCES dbo.SaAd(Id),
    InvoiceDate   DATE           NULL,
    Amount        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaMktInv_Amount    DEFAULT (0),
    GstAmount     DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaMktInv_Gst       DEFAULT (0),
    TotalAmount   AS (Amount + GstAmount) PERSISTED,
    DueDate       DATE           NULL,
    PaymentStatus NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaMktInv_PayStatus DEFAULT ('Pending'),
    Notes         NVARCHAR(MAX)  NULL,
    IsActive      BIT            NOT NULL CONSTRAINT DF_SaMktInv_IsActive  DEFAULT (1),
    CreatedBy     INT            NULL,
    CreatedAt     DATETIME2(3)   NOT NULL CONSTRAINT DF_SaMktInv_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy     INT            NULL,
    UpdatedAt     DATETIME2(3)   NULL
  );
  CREATE INDEX IX_SaMktInv_Campaign ON dbo.SaMarketingInvoice(CampaignId) INCLUDE (PaymentStatus, Amount);
  CREATE INDEX IX_SaMktInv_Status   ON dbo.SaMarketingInvoice(PaymentStatus) INCLUDE (InvoiceNumber, DueDate, Amount);
END
GO

-- Approval columns on SaMarketingInvoice
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaMarketingInvoice') AND name = 'ApprovalStatus')
  ALTER TABLE dbo.SaMarketingInvoice ADD ApprovalStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_SaMarketingInvoice_ApprovalStatus DEFAULT 'Pending';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaMarketingInvoice') AND name = 'ApprovedBy')
  ALTER TABLE dbo.SaMarketingInvoice ADD ApprovedBy INT NULL, ApprovedAt DATETIME2(3) NULL, ApprovalNotes NVARCHAR(500) NULL;
GO

-- ── Distribution Rules ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaDistributionRule' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaDistributionRule (
    Id        INT          IDENTITY(1,1) PRIMARY KEY,
    Level     TINYINT      NOT NULL,
    ScopeType NVARCHAR(20) NOT NULL,
    ScopeId   INT          NULL,
    Method    NVARCHAR(20) NOT NULL CONSTRAINT DF_SaDistRule_Method    DEFAULT ('Percentage'),
    IsActive  BIT          NOT NULL CONSTRAINT DF_SaDistRule_IsActive  DEFAULT (1),
    CreatedBy INT          NULL,
    CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SaDistRule_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt DATETIME2(3) NULL
  );
  CREATE INDEX IX_SaDistRule_Lookup ON dbo.SaDistributionRule(Level, ScopeType, ScopeId, IsActive);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaDistributionRuleMember' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaDistributionRuleMember (
    Id        INT          IDENTITY(1,1) PRIMARY KEY,
    RuleId    INT          NOT NULL CONSTRAINT FK_SaDistRuleMember_Rule     FOREIGN KEY REFERENCES dbo.SaDistributionRule(Id),
    UserId    INT          NOT NULL,
    Weight    DECIMAL(7,2) NOT NULL CONSTRAINT DF_SaDistRuleMember_Weight   DEFAULT (0),
    IsActive  BIT          NOT NULL CONSTRAINT DF_SaDistRuleMember_IsActive DEFAULT (1),
    SortOrder INT          NOT NULL CONSTRAINT DF_SaDistRuleMember_Sort     DEFAULT (0)
  );
  CREATE INDEX IX_SaDistRuleMember_Rule ON dbo.SaDistributionRuleMember(RuleId, IsActive);
END
GO

-- ── Sales Team ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaSalesTeam' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaSalesTeam (
    Id             INT          IDENTITY(1,1) PRIMARY KEY,
    TeamLeadUserId INT          NOT NULL,
    MemberUserId   INT          NOT NULL,
    IsActive       BIT          NOT NULL CONSTRAINT DF_SaSalesTeam_IsActive  DEFAULT (1),
    JoinedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_SaSalesTeam_JoinedAt  DEFAULT (SYSDATETIME()),
    CreatedBy      INT          NULL,
    CreatedAt      DATETIME2(3) NOT NULL CONSTRAINT DF_SaSalesTeam_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt      DATETIME2(3) NULL,
    CONSTRAINT UQ_SaSalesTeam_Member UNIQUE (MemberUserId)
  );
  CREATE INDEX IX_SaSalesTeam_Lead ON dbo.SaSalesTeam(TeamLeadUserId, IsActive);
END
GO

-- ── Lead Transfer Request ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadTransferRequest' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadTransferRequest (
    Id                INT            IDENTITY(1,1) PRIMARY KEY,
    RequestedByUserId INT            NOT NULL,
    FromTeamLeadId    INT            NOT NULL,
    ToTeamLeadId      INT            NOT NULL,
    Status            NVARCHAR(20)   NOT NULL DEFAULT 'Pending',
    RequestNotes      NVARCHAR(1000) NULL,
    AdminNotes        NVARCHAR(1000) NULL,
    ResolvedBy        INT            NULL,
    ResolvedAt        DATETIME2(3)   NULL,
    CreatedAt         DATETIME2(3)   NOT NULL DEFAULT GETDATE(),
    UpdatedAt         DATETIME2(3)   NULL,
    CONSTRAINT FK_LeadTransferReq_RequestedBy FOREIGN KEY (RequestedByUserId) REFERENCES dbo.Users(id),
    CONSTRAINT FK_LeadTransferReq_FromTL      FOREIGN KEY (FromTeamLeadId)    REFERENCES dbo.Users(id),
    CONSTRAINT FK_LeadTransferReq_ToTL        FOREIGN KEY (ToTeamLeadId)      REFERENCES dbo.Users(id),
    CONSTRAINT CK_LeadTransferReq_Status      CHECK (Status IN ('Pending','Approved','Rejected'))
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadTransferRequestItem' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadTransferRequestItem (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    TransferRequestId INT NOT NULL,
    LeadId            INT NOT NULL,
    Transferred       BIT NOT NULL DEFAULT 0,
    CONSTRAINT FK_LeadTransferItem_Request FOREIGN KEY (TransferRequestId) REFERENCES dbo.SaLeadTransferRequest(Id),
    CONSTRAINT FK_LeadTransferItem_Lead    FOREIGN KEY (LeadId)            REFERENCES dbo.SaLead(Id),
    CONSTRAINT UQ_LeadTransferItem         UNIQUE (TransferRequestId, LeadId)
  );
END
GO

-- ── Lead Audit ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadAudit' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadAudit (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    LeadId    INT           NOT NULL CONSTRAINT FK_SaLeadAudit_Lead FOREIGN KEY REFERENCES dbo.SaLead(Id),
    Field     NVARCHAR(50)  NOT NULL,
    OldValue  NVARCHAR(500) NULL,
    NewValue  NVARCHAR(500) NULL,
    ChangedBy INT           NULL,
    ChangedAt DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_SaLeadAudit_Lead ON dbo.SaLeadAudit(LeadId, ChangedAt DESC);
END
GO

-- ── Notifications ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaNotification' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaNotification (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    UserId    INT           NOT NULL CONSTRAINT FK_SaNotification_User FOREIGN KEY REFERENCES dbo.Users(id),
    Type      NVARCHAR(50)  NOT NULL,
    Title     NVARCHAR(200) NOT NULL,
    Body      NVARCHAR(500) NULL,
    RefId     INT           NULL,
    RefType   NVARCHAR(50)  NULL,
    IsRead    BIT           NOT NULL DEFAULT 0,
    CreatedAt DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_SaNotification_User ON dbo.SaNotification(UserId, IsRead, CreatedAt DESC);
END
GO

PRINT '01-sa-tables: done';
