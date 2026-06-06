-- Migration 097: Possession Notice (30/60-day tracking)

IF OBJECT_ID('dbo.FollowupPossessionNotices', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupPossessionNotices (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    NoticeNo            NVARCHAR(50)    NULL,          -- auto: PN000001
    ApplicantId         INT             NOT NULL,
    UnitSelectionId     INT             NULL,
    HandoverId          INT             NULL,
    PrePossessionId     INT             NULL,
    ProjectId           INT             NULL,
    CompanyId           INT             NULL,

    NoticeDate          DATE            NULL,
    NoticeType          NVARCHAR(20)    NOT NULL CONSTRAINT DF_PN_NoticeType    DEFAULT '30-day',
    -- NoticeType: '30-day' | '60-day' | 'Final'
    ScheduledPossDate   DATE            NULL,
    ActualPossDate      DATE            NULL,
    SentVia             NVARCHAR(100)   NULL,          -- Email / WhatsApp / Courier / Hand Delivery
    AcknowledgedDate    DATE            NULL,
    AcknowledgedBy      NVARCHAR(200)   NULL,
    Status              NVARCHAR(30)    NOT NULL CONSTRAINT DF_PN_Status        DEFAULT 'Sent',
    -- Status: 'Sent' | 'Acknowledged' | 'Overdue' | 'Cancelled'
    Notes               NVARCHAR(MAX)   NULL,
    CreatedBy           NVARCHAR(100)   NULL,
    CreatedAt           DATETIME2       NOT NULL CONSTRAINT DF_PN_CreatedAt     DEFAULT SYSDATETIME(),
    UpdatedBy           NVARCHAR(100)   NULL,
    UpdatedAt           DATETIME2       NULL,
    IsDeleted           BIT             NOT NULL CONSTRAINT DF_PN_IsDeleted     DEFAULT 0
  );

  CREATE INDEX IX_PN_ApplicantId   ON dbo.FollowupPossessionNotices(ApplicantId);
  CREATE INDEX IX_PN_HandoverId    ON dbo.FollowupPossessionNotices(HandoverId);
  CREATE INDEX IX_PN_Status        ON dbo.FollowupPossessionNotices(Status);
  PRINT 'Created dbo.FollowupPossessionNotices';
END
ELSE
  PRINT 'dbo.FollowupPossessionNotices already exists — skipping';