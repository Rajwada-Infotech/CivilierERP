-- 131-create-sa-inquiry-site-visit-tables.sql
-- Creates SaInquiryCall and SaSiteVisit tables.
-- Idempotent: guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaInquiryCall' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaInquiryCall (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    LeadId          INT            NOT NULL CONSTRAINT FK_SaInquiry_Lead FOREIGN KEY REFERENCES dbo.SaLead(Id),
    SalespersonId   INT            NULL,
    CallTime        DATETIME2(3)   NOT NULL CONSTRAINT DF_SaInquiry_CallTime DEFAULT (SYSDATETIME()),
    DurationSeconds INT            NULL,
    RecordingUrl    NVARCHAR(500)  NULL,
    Outcome         NVARCHAR(50)   NULL,
    Remarks         NVARCHAR(MAX)  NULL,
    Classification  NVARCHAR(30)   NULL,
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_SaInquiry_CreatedAt DEFAULT (SYSDATETIME())
  );

  CREATE INDEX IX_SaInquiry_Lead ON dbo.SaInquiryCall(LeadId);
  CREATE INDEX IX_SaInquiry_Salesperson ON dbo.SaInquiryCall(SalespersonId, CallTime);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaSiteVisit' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaSiteVisit (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    LeadId          INT            NOT NULL CONSTRAINT FK_SaSiteVisit_Lead FOREIGN KEY REFERENCES dbo.SaLead(Id),
    ProjectName     NVARCHAR(200)  NULL,
    PreferredDate   DATE           NULL,
    PreferredTime   NVARCHAR(20)   NULL,
    ExecutiveId     INT            NULL,
    PickupRequired  BIT            NOT NULL CONSTRAINT DF_SaSiteVisit_Pickup DEFAULT (0),
    CustomerNotes   NVARCHAR(MAX)  NULL,
    Status          NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaSiteVisit_Status DEFAULT ('Scheduled'),
    IsActive        BIT            NOT NULL CONSTRAINT DF_SaSiteVisit_IsActive DEFAULT (1),
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_SaSiteVisit_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy       INT            NULL,
    UpdatedAt       DATETIME2(3)   NULL
  );

  CREATE INDEX IX_SaSiteVisit_Lead ON dbo.SaSiteVisit(LeadId);
  CREATE INDEX IX_SaSiteVisit_Date ON dbo.SaSiteVisit(PreferredDate, Status);
END
GO

PRINT 'Migration 131: SaInquiryCall + SaSiteVisit created';
GO
