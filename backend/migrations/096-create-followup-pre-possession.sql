-- Migration 096: Pre-Possession Clearance

IF OBJECT_ID('dbo.FollowupPrePossession', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupPrePossession (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    ClearanceNo         NVARCHAR(50)    NULL,          -- auto: PPC000001
    ApplicantId         INT             NOT NULL,
    UnitSelectionId     INT             NULL,
    HandoverId          INT             NULL,
    ProjectId           INT             NULL,
    CompanyId           INT             NULL,

    -- Clearance checklist (stored as bit flags)
    StructuralClearance BIT             NOT NULL CONSTRAINT DF_PP_Structural    DEFAULT 0,
    ElectricalClearance BIT             NOT NULL CONSTRAINT DF_PP_Electrical    DEFAULT 0,
    PlumbingClearance   BIT             NOT NULL CONSTRAINT DF_PP_Plumbing      DEFAULT 0,
    PaintingClearance   BIT             NOT NULL CONSTRAINT DF_PP_Painting      DEFAULT 0,
    FlooringClearance   BIT             NOT NULL CONSTRAINT DF_PP_Flooring      DEFAULT 0,
    FireClearance       BIT             NOT NULL CONSTRAINT DF_PP_Fire          DEFAULT 0,
    OccupancyCertIssued BIT             NOT NULL CONSTRAINT DF_PP_OC            DEFAULT 0,
    SnagListCleared     BIT             NOT NULL CONSTRAINT DF_PP_SnagList      DEFAULT 0,

    ClearanceDate       DATE            NULL,
    InspectedBy         NVARCHAR(200)   NULL,
    Status              NVARCHAR(30)    NOT NULL CONSTRAINT DF_PP_Status        DEFAULT 'Pending',
    Notes               NVARCHAR(MAX)   NULL,
    CreatedBy           NVARCHAR(100)   NULL,
    CreatedAt           DATETIME2       NOT NULL CONSTRAINT DF_PP_CreatedAt     DEFAULT SYSDATETIME(),
    UpdatedBy           NVARCHAR(100)   NULL,
    UpdatedAt           DATETIME2       NULL,
    IsDeleted           BIT             NOT NULL CONSTRAINT DF_PP_IsDeleted     DEFAULT 0
  );

  CREATE INDEX IX_PP_ApplicantId   ON dbo.FollowupPrePossession(ApplicantId);
  CREATE INDEX IX_PP_HandoverId    ON dbo.FollowupPrePossession(HandoverId);
  CREATE INDEX IX_PP_Status        ON dbo.FollowupPrePossession(Status);
  PRINT 'Created dbo.FollowupPrePossession';
END
ELSE
  PRINT 'dbo.FollowupPrePossession already exists — skipping';