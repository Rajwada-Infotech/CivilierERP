-- Migration 068: Create FollowupConstructionUpdates table
--
-- Tracks construction progress updates sent to applicants / owners per unit/project.
-- ApplicantId  → dbo.AccountHeadMaster.LHeadId  (LHeadType = 'A')
-- ProjectId    → dbo.enterprise.id              (business_type = 'P')
-- CompanyId    → dbo.enterprise.id              (business_type = 'C')
-- UnitSelectionId → dbo.FollowupUnitSelections.Id (optional)

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupConstructionUpdates' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupConstructionUpdates (
        Id                  INT             IDENTITY(1,1) PRIMARY KEY,
        UpdateNo            NVARCHAR(50)    NULL,           -- e.g. CU000001

        -- Applicant / owner
        ApplicantId         INT             NOT NULL,
        UnitSelectionId     INT             NULL,

        -- Project / company
        ProjectId           INT             NULL,
        CompanyId           INT             NULL,

        -- Update details
        UpdateDate          DATE            NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
        Stage               NVARCHAR(100)   NULL,   -- e.g. 'Foundation', 'Slab', 'Brickwork', 'Plastering', 'Finishing', 'Completion'
        PercentComplete     TINYINT         NULL,   -- 0-100
        Description         NVARCHAR(MAX)   NULL,   -- free-text progress description
        SharedWith          NVARCHAR(500)   NULL,   -- email / phone / name of person the update was shared with
        SharedOn            DATE            NULL,   -- when was it communicated
        MediaLinks          NVARCHAR(MAX)   NULL,   -- JSON array or comma-separated URLs of photos/videos

        -- Workflow
        Status              NVARCHAR(30)    NOT NULL DEFAULT 'Draft',
        Notes               NVARCHAR(MAX)   NULL,

        IsDeleted           BIT             NOT NULL DEFAULT 0,
        CreatedBy           NVARCHAR(100)   NULL,
        CreatedAt           DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy           NVARCHAR(100)   NULL,
        UpdatedAt           DATETIME2       NULL,

        CONSTRAINT FK_FCU_UnitSelection
            FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id),

        CONSTRAINT CK_FCU_Status
            CHECK (Status IN ('Draft', 'Sent', 'Acknowledged', 'Disputed')),

        CONSTRAINT CK_FCU_PercentComplete
            CHECK (PercentComplete IS NULL OR (PercentComplete >= 0 AND PercentComplete <= 100))
    );
END;
GO

-- ── Indexes ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FCU_ApplicantId' AND object_id = OBJECT_ID('dbo.FollowupConstructionUpdates'))
    CREATE INDEX IX_FCU_ApplicantId ON dbo.FollowupConstructionUpdates(ApplicantId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FCU_ProjectId' AND object_id = OBJECT_ID('dbo.FollowupConstructionUpdates'))
    CREATE INDEX IX_FCU_ProjectId ON dbo.FollowupConstructionUpdates(ProjectId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FCU_UpdateDate' AND object_id = OBJECT_ID('dbo.FollowupConstructionUpdates'))
    CREATE INDEX IX_FCU_UpdateDate ON dbo.FollowupConstructionUpdates(UpdateDate, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FCU_Status' AND object_id = OBJECT_ID('dbo.FollowupConstructionUpdates'))
    CREATE INDEX IX_FCU_Status ON dbo.FollowupConstructionUpdates(Status, IsDeleted);
GO
