-- Migration 095: Legal Booking Milestones (Track A, 8-step sequential)

IF OBJECT_ID('dbo.FollowupLegalMilestones', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupLegalMilestones (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    MilestoneNo         NVARCHAR(50)    NULL,          -- auto: LM000001
    ApplicantId         INT             NOT NULL,
    UnitSelectionId     INT             NULL,
    BookingId           INT             NULL,
    AgreementId         INT             NULL,
    ProjectId           INT             NULL,
    CompanyId           INT             NULL,

    -- The 8 sequential steps stored as date + status columns
    -- Step 1: Document Collection
    DocCollectionDue    DATE            NULL,
    DocCollectionDone   DATE            NULL,
    DocCollectionStatus NVARCHAR(30)    NOT NULL CONSTRAINT DF_LM_DocCollStatus    DEFAULT 'Pending',
    DocCollectionNotes  NVARCHAR(MAX)   NULL,

    -- Step 2: Legal Review Initiation
    LegalReviewDue      DATE            NULL,
    LegalReviewDone     DATE            NULL,
    LegalReviewStatus   NVARCHAR(30)    NOT NULL CONSTRAINT DF_LM_LegalRevStatus   DEFAULT 'Pending',
    LegalReviewNotes    NVARCHAR(MAX)   NULL,

    -- Step 3: Sales Deed / Agreement Drafting
    DraftingDue         DATE            NULL,
    DraftingDone        DATE            NULL,
    DraftingStatus      NVARCHAR(30)    NOT NULL CONSTRAINT DF_LM_DraftingStatus   DEFAULT 'Pending',
    DraftingNotes       NVARCHAR(MAX)   NULL,

    -- Step 4: Internal Legal Approval
    InternalApprovalDue    DATE         NULL,
    InternalApprovalDone   DATE         NULL,
    InternalApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LM_IntApprStatus    DEFAULT 'Pending',
    InternalApprovalNotes  NVARCHAR(MAX) NULL,

    -- Step 5: Document Shared with Customer
    DocSharedDue        DATE            NULL,
    DocSharedDone       DATE            NULL,
    DocSharedStatus     NVARCHAR(30)    NOT NULL CONSTRAINT DF_LM_DocSharedStatus  DEFAULT 'Pending',
    DocSharedNotes      NVARCHAR(MAX)   NULL,

    -- Step 6: Mutual Agreement
    MutualAgreementDue  DATE            NULL,
    MutualAgreementDone DATE            NULL,
    MutualAgreementStatus NVARCHAR(30)  NOT NULL CONSTRAINT DF_LM_MutualAgrStatus  DEFAULT 'Pending',
    MutualAgreementNotes  NVARCHAR(MAX) NULL,

    -- Step 7: Director Meeting
    DirectorMeetingDue  DATE            NULL,
    DirectorMeetingDone DATE            NULL,
    DirectorMeetingStatus NVARCHAR(30)  NOT NULL CONSTRAINT DF_LM_DirMtgStatus     DEFAULT 'Pending',
    DirectorMeetingNotes  NVARCHAR(MAX) NULL,

    -- Step 8: Final Execution & Registration
    FinalExecutionDue   DATE            NULL,
    FinalExecutionDone  DATE            NULL,
    FinalExecutionStatus NVARCHAR(30)   NOT NULL CONSTRAINT DF_LM_FinalExecStatus  DEFAULT 'Pending',
    FinalExecutionNotes  NVARCHAR(MAX)  NULL,

    -- Overall
    CurrentStep         INT             NOT NULL CONSTRAINT DF_LM_CurrentStep      DEFAULT 1,
    OverallStatus       NVARCHAR(30)    NOT NULL CONSTRAINT DF_LM_OverallStatus     DEFAULT 'In Progress',
    Notes               NVARCHAR(MAX)   NULL,
    CreatedBy           NVARCHAR(100)   NULL,
    CreatedAt           DATETIME2       NOT NULL CONSTRAINT DF_LM_CreatedAt         DEFAULT SYSDATETIME(),
    UpdatedBy           NVARCHAR(100)   NULL,
    UpdatedAt           DATETIME2       NULL,
    IsDeleted           BIT             NOT NULL CONSTRAINT DF_LM_IsDeleted         DEFAULT 0
  );

  CREATE INDEX IX_LM_ApplicantId     ON dbo.FollowupLegalMilestones(ApplicantId);
  CREATE INDEX IX_LM_BookingId       ON dbo.FollowupLegalMilestones(BookingId);
  CREATE INDEX IX_LM_OverallStatus   ON dbo.FollowupLegalMilestones(OverallStatus);
  CREATE INDEX IX_LM_IsDeleted       ON dbo.FollowupLegalMilestones(IsDeleted);
  PRINT 'Created dbo.FollowupLegalMilestones';
END
ELSE
  PRINT 'dbo.FollowupLegalMilestones already exists — skipping';