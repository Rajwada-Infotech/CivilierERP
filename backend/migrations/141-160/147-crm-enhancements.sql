-- Migration 147: CRM Enhancement — Lead preferences, Channel Partners,
-- Activity Log, Lead Tasks, and Commission Tracking.
-- All blocks are idempotent (IF NOT EXISTS guards).

-- ── 1. Add CRM columns to dbo.SaLead ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'SourceType')
  ALTER TABLE dbo.SaLead ADD SourceType NVARCHAR(30) NULL;        -- Ad|WalkIn|Referral|PortalInquiry|ColdCall|Website|EventLead|Other

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'ChannelPartnerId')
  ALTER TABLE dbo.SaLead ADD ChannelPartnerId INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'BudgetMin')
  ALTER TABLE dbo.SaLead ADD BudgetMin DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'BudgetMax')
  ALTER TABLE dbo.SaLead ADD BudgetMax DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'PropertyType')
  ALTER TABLE dbo.SaLead ADD PropertyType NVARCHAR(50) NULL;      -- Apartment|Villa|Commercial|Plot|Warehouse|Studio

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'BhkPreference')
  ALTER TABLE dbo.SaLead ADD BhkPreference NVARCHAR(30) NULL;     -- Studio|1BHK|2BHK|3BHK|4BHK+

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'PreferredLocation')
  ALTER TABLE dbo.SaLead ADD PreferredLocation NVARCHAR(200) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'PurchaseTimeline')
  ALTER TABLE dbo.SaLead ADD PurchaseTimeline NVARCHAR(30) NULL;  -- Immediate|3Months|6Months|1Year|JustExploring

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SaLead') AND name = 'LastActivityAt')
  ALTER TABLE dbo.SaLead ADD LastActivityAt DATETIME2(3) NULL;
GO

-- ── 2. dbo.SaChannelPartner ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaChannelPartner' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaChannelPartner (
    Id             INT           IDENTITY(1,1) PRIMARY KEY,
    PartnerCode    NVARCHAR(20)  NOT NULL,
    Name           NVARCHAR(200) NOT NULL,
    Mobile         NVARCHAR(20)  NULL,
    Email          NVARCHAR(200) NULL,
    FirmName       NVARCHAR(200) NULL,
    Region         NVARCHAR(200) NULL,
    CommissionRate DECIMAL(5,2)  NULL,       -- default % of booking value
    BankDetails    NVARCHAR(MAX) NULL,        -- JSON blob: BankName, AccNo, IFSC
    Notes          NVARCHAR(MAX) NULL,
    IsActive       BIT           NOT NULL DEFAULT 1,
    CreatedBy      INT           NULL,
    CreatedAt      DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy      INT           NULL,
    UpdatedAt      DATETIME2(3)  NULL,
    CONSTRAINT UQ_SaChannelPartner_Code UNIQUE (PartnerCode)
  );
  CREATE INDEX IX_SaChannelPartner_Active ON dbo.SaChannelPartner (IsActive);
END;
GO

-- Add FK from SaLead to SaChannelPartner (added after table creation)
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SaLead_ChannelPartner'
)
  ALTER TABLE dbo.SaLead
  ADD CONSTRAINT FK_SaLead_ChannelPartner
      FOREIGN KEY (ChannelPartnerId) REFERENCES dbo.SaChannelPartner(Id);
GO

-- ── 3. dbo.SaLeadActivity — unified activity / communication log ─────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadActivity' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadActivity (
    Id              INT           IDENTITY(1,1) PRIMARY KEY,
    LeadId          INT           NOT NULL,
    ActivityType    NVARCHAR(30)  NOT NULL,   -- Call|WhatsApp|Email|Meeting|Note|SMS|SiteVisit
    Direction       NVARCHAR(10)  NULL,        -- Inbound|Outbound
    DurationSeconds INT           NULL,
    Outcome         NVARCHAR(50)  NULL,        -- Connected|NoAnswer|CallBack|Interested|NotInterested
    Summary         NVARCHAR(MAX) NOT NULL,
    NextFollowupDate DATE         NULL,
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_SaLeadActivity_Lead FOREIGN KEY (LeadId) REFERENCES dbo.SaLead(Id)
  );
  CREATE INDEX IX_SaLeadActivity_Lead ON dbo.SaLeadActivity (LeadId, CreatedAt DESC);
  CREATE INDEX IX_SaLeadActivity_NextFollowup ON dbo.SaLeadActivity (NextFollowupDate) WHERE NextFollowupDate IS NOT NULL;
END;
GO

-- ── 4. dbo.SaLeadTask — follow-up tasks and reminders ───────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaLeadTask' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaLeadTask (
    Id           INT           IDENTITY(1,1) PRIMARY KEY,
    LeadId       INT           NOT NULL,
    Title        NVARCHAR(200) NOT NULL,
    Description  NVARCHAR(MAX) NULL,
    AssignedTo   INT           NULL,           -- FK Users
    DueDate      DATETIME2(3)  NULL,
    Priority     NVARCHAR(10)  NOT NULL DEFAULT 'Normal',  -- Low|Normal|High|Urgent
    Status       NVARCHAR(20)  NOT NULL DEFAULT 'Pending', -- Pending|InProgress|Done|Cancelled
    CompletedAt  DATETIME2(3)  NULL,
    CreatedBy    INT           NULL,
    CreatedAt    DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy    INT           NULL,
    UpdatedAt    DATETIME2(3)  NULL,
    CONSTRAINT FK_SaLeadTask_Lead       FOREIGN KEY (LeadId)     REFERENCES dbo.SaLead(Id),
    CONSTRAINT FK_SaLeadTask_AssignedTo FOREIGN KEY (AssignedTo) REFERENCES dbo.Users(id),
    CONSTRAINT CK_SaLeadTask_Priority   CHECK (Priority IN ('Low','Normal','High','Urgent')),
    CONSTRAINT CK_SaLeadTask_Status     CHECK (Status IN ('Pending','InProgress','Done','Cancelled'))
  );
  CREATE INDEX IX_SaLeadTask_Assignee ON dbo.SaLeadTask (AssignedTo, Status, DueDate);
  CREATE INDEX IX_SaLeadTask_Lead     ON dbo.SaLeadTask (LeadId, Status);
END;
GO

-- ── 5. dbo.SaCommission — per-booking commission records ────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SaCommission' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SaCommission (
    Id                  INT          IDENTITY(1,1) PRIMARY KEY,
    LeadId              INT          NULL,
    BookingId           INT          NULL,                -- references FollowupBookings.Id
    SalespersonId       INT          NULL,
    TeamLeadId          INT          NULL,
    ChannelPartnerId    INT          NULL,
    BookingValue        DECIMAL(18,2) NULL,
    SpRate              DECIMAL(5,2)  NULL,               -- % for salesperson
    SpAmount            DECIMAL(18,2) NULL,
    TlRate              DECIMAL(5,2)  NULL,               -- % for team lead
    TlAmount            DECIMAL(18,2) NULL,
    CpRate              DECIMAL(5,2)  NULL,               -- % for channel partner
    CpAmount            DECIMAL(18,2) NULL,
    Status              NVARCHAR(20)  NOT NULL DEFAULT 'Pending', -- Pending|Approved|Paid
    ApprovedBy          INT           NULL,
    ApprovedAt          DATETIME2(3)  NULL,
    PaidAt              DATETIME2(3)  NULL,
    Notes               NVARCHAR(MAX) NULL,
    CreatedAt           DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy           INT           NULL,
    UpdatedAt           DATETIME2(3)  NULL,
    CONSTRAINT FK_SaCommission_Lead    FOREIGN KEY (LeadId)           REFERENCES dbo.SaLead(Id),
    CONSTRAINT FK_SaCommission_SP      FOREIGN KEY (SalespersonId)    REFERENCES dbo.Users(id),
    CONSTRAINT FK_SaCommission_TL      FOREIGN KEY (TeamLeadId)       REFERENCES dbo.Users(id),
    CONSTRAINT FK_SaCommission_CP      FOREIGN KEY (ChannelPartnerId) REFERENCES dbo.SaChannelPartner(Id),
    CONSTRAINT CK_SaCommission_Status  CHECK (Status IN ('Pending','Approved','Paid'))
  );
  CREATE INDEX IX_SaCommission_Lead ON dbo.SaCommission (LeadId);
  CREATE INDEX IX_SaCommission_SP   ON dbo.SaCommission (SalespersonId, Status);
END;
GO

PRINT 'Migration 147 complete — CRM enhancement tables created';
