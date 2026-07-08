-- ============================================================
-- Migration 149: CRM Module Tables
-- Full real-estate CRM: Application → Booking → Welcome Call
-- → Agreement → Agreement Documents → Payment Milestones
-- ============================================================

-- CRM Application (walk-in or promoted from SA Lead)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplication' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmApplication (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    ApplicationNo   NVARCHAR(30)      NOT NULL UNIQUE,
    LeadId          INT               NULL REFERENCES dbo.SaLead(Id),
    ApplicantName   NVARCHAR(200)     NOT NULL,
    Mobile          NVARCHAR(20)      NOT NULL,
    AltMobile       NVARCHAR(20)      NULL,
    Email           NVARCHAR(200)     NULL,
    -- Property interest
    InterestedProject NVARCHAR(200)   NULL,
    InterestedUnit    NVARCHAR(100)   NULL,
    PropertyType      NVARCHAR(50)    NULL,
    BhkPreference     NVARCHAR(30)    NULL,
    BudgetMin         DECIMAL(18,2)   NULL,
    BudgetMax         DECIMAL(18,2)   NULL,
    -- Source
    Source          NVARCHAR(200)     NULL,
    -- Assignment
    AssignedTo      INT               NULL REFERENCES dbo.Users(id),
    -- Status: Draft / Submitted / Approved / Rejected / Cancelled
    Status          NVARCHAR(30)      NOT NULL DEFAULT 'Draft',
    Notes           NVARCHAR(MAX)     NULL,
    IsActive        BIT               NOT NULL DEFAULT 1,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT               NULL,
    UpdatedAt       DATETIME2(3)      NULL
  );
  PRINT 'Created dbo.CrmApplication';
END
GO

-- CRM Booking
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBooking' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBooking (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BookingNo       NVARCHAR(30)      NOT NULL UNIQUE,
    ApplicationId   INT               NOT NULL REFERENCES dbo.CrmApplication(Id),
    -- Unit
    ProjectId       INT               NULL,
    ProjectName     NVARCHAR(200)     NULL,
    UnitNo          NVARCHAR(100)     NOT NULL,
    BlockName       NVARCHAR(100)     NULL,
    FloorName       NVARCHAR(100)     NULL,
    UnitType        NVARCHAR(100)     NULL,
    AreaSqFt        DECIMAL(18,2)     NULL,
    RatePerSqFt     DECIMAL(18,2)     NULL,
    TotalValue      DECIMAL(18,2)     NULL,
    -- Booking payment
    BookingAmount   DECIMAL(18,2)     NULL DEFAULT 0,
    BookingDate     DATE              NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    PaymentMode     NVARCHAR(50)      NULL,
    -- Assignment
    AssignedTo      INT               NULL REFERENCES dbo.Users(id),
    -- Status: Draft / Confirmed / Cancelled
    Status          NVARCHAR(30)      NOT NULL DEFAULT 'Draft',
    Notes           NVARCHAR(MAX)     NULL,
    IsActive        BIT               NOT NULL DEFAULT 1,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT               NULL,
    UpdatedAt       DATETIME2(3)      NULL
  );
  PRINT 'Created dbo.CrmBooking';
END
GO

-- CRM Welcome Call log
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmWelcomeCall' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmWelcomeCall (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BookingId       INT               NOT NULL REFERENCES dbo.CrmBooking(Id),
    CalledBy        INT               NULL REFERENCES dbo.Users(id),
    CallDate        DATETIME2(3)      NULL,
    DurationSeconds INT               NULL,
    -- Outcome: Welcomed / NotReachable / RequestedCallback / VoiceMail
    Outcome         NVARCHAR(50)      NULL,
    NextCallDate    DATE              NULL,
    Notes           NVARCHAR(MAX)     NULL,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmWelcomeCall';
END
GO

-- CRM Agreement
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmAgreement' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmAgreement (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    AgreementNo     NVARCHAR(50)      NULL,
    BookingId       INT               NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    AgreementDate   DATE              NULL,
    LegalName       NVARCHAR(300)     NULL,
    LegalAddress    NVARCHAR(MAX)     NULL,
    PanNo           NVARCHAR(20)      NULL,
    AadhaarNo       NVARCHAR(20)      NULL,
    -- Status: Draft / Executed / Registered / Cancelled
    Status          NVARCHAR(30)      NOT NULL DEFAULT 'Draft',
    Notes           NVARCHAR(MAX)     NULL,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT               NULL,
    UpdatedAt       DATETIME2(3)      NULL
  );
  PRINT 'Created dbo.CrmAgreement';
END
GO

-- CRM Agreement Documents
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmAgreementDocument' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmAgreementDocument (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    AgreementId     INT               NOT NULL REFERENCES dbo.CrmAgreement(Id),
    -- Type: SaleAgreement / AllotmentLetter / PossessionLetter / RegistrationDoc / NOC / Other
    DocumentType    NVARCHAR(100)     NOT NULL,
    DocumentUrl     NVARCHAR(2000)    NULL,
    FileName        NVARCHAR(300)     NULL,
    IssuedBy        NVARCHAR(200)     NULL,
    -- Status: Pending / Uploaded / Verified / Rejected
    Status          NVARCHAR(30)      NOT NULL DEFAULT 'Pending',
    Remarks         NVARCHAR(MAX)     NULL,
    UploadedAt      DATETIME2(3)      NULL,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmAgreementDocument';
END
GO

-- CRM Payment Milestones
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPaymentMilestone' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmPaymentMilestone (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    BookingId       INT               NOT NULL REFERENCES dbo.CrmBooking(Id),
    MilestoneNo     INT               NOT NULL,
    -- Name: Booking / Agreement / Foundation / Plinth / Superstructure / SlabCasting / Plastering / Handover / PLC / Other
    MilestoneName   NVARCHAR(200)     NOT NULL,
    DueDate         DATE              NULL,
    AmountDue       DECIMAL(18,2)     NOT NULL DEFAULT 0,
    AmountPaid      DECIMAL(18,2)     NULL DEFAULT 0,
    PaidDate        DATE              NULL,
    -- PaymentMode: Cash / Cheque / NEFT / RTGS / UPI / Loan / Other
    PaymentMode     NVARCHAR(50)      NULL,
    TransactionRef  NVARCHAR(200)     NULL,
    -- Status: Pending / Paid / Overdue / Waived
    Status          NVARCHAR(30)      NOT NULL DEFAULT 'Pending',
    Remarks         NVARCHAR(MAX)     NULL,
    CreatedBy       INT               NULL,
    CreatedAt       DATETIME2(3)      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT               NULL,
    UpdatedAt       DATETIME2(3)      NULL
  );
  PRINT 'Created dbo.CrmPaymentMilestone';
END
GO

-- ── Page Definitions ──────────────────────────────────────────────────────────
DECLARE @base INT = 600;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-applications',  'Applications',       'CRM', 'CRM Pipeline',   'view,create,edit',        @base + 10, 1, 'migration-149'),
  ('crm-bookings',      'Bookings',           'CRM', 'CRM Pipeline',   'view,create,edit',        @base + 20, 1, 'migration-149'),
  ('crm-welcome-calls', 'Welcome Calls',      'CRM', 'CRM Pipeline',   'view,create',             @base + 30, 1, 'migration-149'),
  ('crm-agreements',    'Agreements',         'CRM', 'CRM Documents',  'view,create,edit',        @base + 40, 1, 'migration-149'),
  ('crm-documents',     'Agreement Papers',   'CRM', 'CRM Documents',  'view,create,edit',        @base + 50, 1, 'migration-149'),
  ('crm-payments',      'Payment Milestones', 'CRM', 'CRM Finance',    'view,create,edit',        @base + 60, 1, 'migration-149')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());

PRINT 'Seeded CRM PageDefinitions';
GO
