-- ============================================================
-- Migration 150: CRM After-Sales Workflow
-- Handover/Snags, Service Tickets, Cancellation/Refund,
-- Home Loan tracking, Referral chain
-- ============================================================

-- Referral tracking: an application can be sourced by an existing customer
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'ReferredByApplicationId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD ReferredByApplicationId INT NULL REFERENCES dbo.CrmApplication(Id);
  PRINT 'Added ReferredByApplicationId to CrmApplication';
END
GO

-- Home Loan / Bank coordination (one per booking)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmLoanDetail' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmLoanDetail (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BookingId       INT               NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    BankName        NVARCHAR(200)     NULL,
    BranchName      NVARCHAR(200)     NULL,
    LoanAmount      DECIMAL(18,2)     NULL,
    -- SanctionStatus: NotApplied / Applied / Sanctioned / Rejected / Disbursed
    SanctionStatus  NVARCHAR(30)      NOT NULL DEFAULT 'NotApplied',
    SanctionDate    DATE              NULL,
    DisbursedAmount DECIMAL(18,2)     NULL DEFAULT 0,
    LoanAccountNo   NVARCHAR(100)     NULL,
    RmName          NVARCHAR(200)     NULL,
    RmContact       NVARCHAR(20)      NULL,
    Notes           NVARCHAR(MAX)     NULL,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT               NULL,
    UpdatedAt       DATETIME2(3)      NULL
  );
  PRINT 'Created dbo.CrmLoanDetail';
END
GO

-- Possession / Handover
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmHandover' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmHandover (
    Id                    INT IDENTITY(1,1) PRIMARY KEY,
    BookingId             INT           NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    ScheduledDate         DATE          NULL,
    ActualHandoverDate    DATE          NULL,
    KeyHandoverBy         INT           NULL REFERENCES dbo.Users(id),
    FinalDuesCleared      BIT           NOT NULL DEFAULT 0,
    CustomerAcknowledged  BIT           NOT NULL DEFAULT 0,
    -- Status: Scheduled / SnagInspection / SnagPending / Completed / Cancelled
    Status                NVARCHAR(30)  NOT NULL DEFAULT 'Scheduled',
    Notes                 NVARCHAR(MAX) NULL,
    CreatedBy             INT           NULL,
    CreatedAt             DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy             INT           NULL,
    UpdatedAt             DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmHandover';
END
GO

-- Snag / defect list raised during handover inspection
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmSnagItem' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmSnagItem (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    HandoverId    INT           NOT NULL REFERENCES dbo.CrmHandover(Id),
    -- Category: Electrical / Plumbing / Civil / Paint / Carpentry / Other
    Category      NVARCHAR(50)  NOT NULL,
    Description   NVARCHAR(MAX) NOT NULL,
    PhotoUrl      NVARCHAR(2000) NULL,
    -- Status: Open / InProgress / Resolved / Rejected
    Status        NVARCHAR(30)  NOT NULL DEFAULT 'Open',
    RaisedBy      INT           NULL REFERENCES dbo.Users(id),
    ResolvedBy    INT           NULL REFERENCES dbo.Users(id),
    ResolvedAt    DATETIME2(3)  NULL,
    CreatedAt     DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmSnagItem';
END
GO

-- After-sales service tickets (warranty repairs, complaints, society issues)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmServiceTicket' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmServiceTicket (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    TicketNo        NVARCHAR(30)  NOT NULL UNIQUE,
    BookingId       INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    -- Category: Warranty / Complaint / ServiceRequest / SocietyIssue / Other
    Category        NVARCHAR(50)  NOT NULL,
    -- Priority: Low / Normal / High / Urgent
    Priority        NVARCHAR(20)  NOT NULL DEFAULT 'Normal',
    Subject         NVARCHAR(300) NOT NULL,
    Description     NVARCHAR(MAX) NULL,
    -- Status: Open / Assigned / InProgress / Resolved / Closed / Reopened
    Status          NVARCHAR(30)  NOT NULL DEFAULT 'Open',
    AssignedTo      INT           NULL REFERENCES dbo.Users(id),
    SlaDueDate      DATETIME2(3)  NULL,
    ResolvedAt      DATETIME2(3)  NULL,
    ResolutionNotes NVARCHAR(MAX) NULL,
    CustomerRating  INT           NULL, -- 1-5
    CustomerFeedback NVARCHAR(MAX) NULL,
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmServiceTicket';
END
GO

-- Booking cancellation / refund workflow
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmCancellation' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmCancellation (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    BookingId         INT           NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    RequestedDate     DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    Reason            NVARCHAR(MAX) NULL,
    AmountPaidTillDate DECIMAL(18,2) NULL,
    DeductionPercent  DECIMAL(5,2)  NOT NULL DEFAULT 0,
    DeductionAmount   DECIMAL(18,2) NULL,
    RefundAmount      DECIMAL(18,2) NULL,
    -- Status: Requested / Approved / Rejected / Refunded
    Status            NVARCHAR(30)  NOT NULL DEFAULT 'Requested',
    RequestedBy       INT           NULL REFERENCES dbo.Users(id),
    ApprovedBy        INT           NULL REFERENCES dbo.Users(id),
    ApprovedAt        DATETIME2(3)  NULL,
    RefundDate        DATE          NULL,
    RefundMode        NVARCHAR(50)  NULL,
    RefundRef         NVARCHAR(200) NULL,
    Notes             NVARCHAR(MAX) NULL,
    CreatedAt         DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt         DATETIME2(3)  NULL
  );
  PRINT 'Created dbo.CrmCancellation';
END
GO

-- ── Page Definitions ──────────────────────────────────────────────────────────
DECLARE @base INT = 700;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-loan-details',    'Home Loan Tracking',   'CRM', 'CRM Finance',    'view,create,edit', @base + 5,  1, 'migration-150'),
  ('crm-handover',        'Possession & Handover','CRM', 'CRM After-Sales','view,create,edit', @base + 10, 1, 'migration-150'),
  ('crm-service-tickets', 'Service Tickets',      'CRM', 'CRM After-Sales','view,create,edit', @base + 20, 1, 'migration-150'),
  ('crm-cancellations',   'Cancellations',        'CRM', 'CRM After-Sales','view,create,edit', @base + 30, 1, 'migration-150'),
  ('crm-customer-360',    'Customer 360',         'CRM', 'CRM After-Sales','view',             @base + 40, 1, 'migration-150')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());

PRINT 'Seeded CRM after-sales PageDefinitions';
GO
