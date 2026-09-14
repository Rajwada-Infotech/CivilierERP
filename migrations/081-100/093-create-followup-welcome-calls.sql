-- Migration 093: Create FollowupWelcomeCalls table
-- Run: node migrate.js up

IF OBJECT_ID('dbo.FollowupWelcomeCalls', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupWelcomeCalls (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    CallNo              NVARCHAR(50)    NULL,
    BookingId           INT             NULL,
    ApplicantId         INT             NULL,
    CallDate            DATE            NOT NULL CONSTRAINT DF_FWC_CallDate DEFAULT CAST(SYSDATETIME() AS DATE),
    CallTime            NVARCHAR(10)    NULL,
    Duration            NVARCHAR(20)    NULL,
    Outcome             NVARCHAR(50)    NULL,   -- connected, no_answer, callback, voicemail
    BankSelected        NVARCHAR(200)   NULL,
    LoanRequired        BIT             NOT NULL CONSTRAINT DF_FWC_LoanRequired DEFAULT 0,
    ExpectedLoanAmount  DECIMAL(18,2)   NULL,
    PreferredBanker     NVARCHAR(200)   NULL,
    AssignedTo          INT             NULL,
    Notes               NVARCHAR(MAX)   NULL,
    Status              NVARCHAR(50)    NOT NULL CONSTRAINT DF_FWC_Status DEFAULT 'Scheduled',
    CreatedBy           NVARCHAR(100)   NULL,
    CreatedAt           DATETIME2       NOT NULL CONSTRAINT DF_FWC_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy           NVARCHAR(100)   NULL,
    UpdatedAt           DATETIME2       NULL,
    IsDeleted           BIT             NOT NULL CONSTRAINT DF_FWC_IsDeleted DEFAULT 0
  );

  CREATE INDEX IX_FWC_BookingId    ON dbo.FollowupWelcomeCalls(BookingId);
  CREATE INDEX IX_FWC_ApplicantId  ON dbo.FollowupWelcomeCalls(ApplicantId);
  CREATE INDEX IX_FWC_CallDate     ON dbo.FollowupWelcomeCalls(CallDate);
  CREATE INDEX IX_FWC_Status       ON dbo.FollowupWelcomeCalls(Status);
  CREATE INDEX IX_FWC_IsDeleted    ON dbo.FollowupWelcomeCalls(IsDeleted);

  PRINT 'Created dbo.FollowupWelcomeCalls';
END
ELSE
BEGIN
  PRINT 'dbo.FollowupWelcomeCalls already exists — skipping';
END;
