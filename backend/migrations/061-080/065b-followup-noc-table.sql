-- Migration 065: Create FollowupNOCs table
--
-- ApplicantId → dbo.AccountHeadMaster.LHeadId  (LHeadType = 'A')
-- ProjectId   → dbo.enterprise.id              (business_type = 'P')
-- CompanyId   → dbo.enterprise.id              (business_type = 'C')
-- No FK to FollowupApplicants — applicant is sourced from AccountHeadMaster.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupNOCs' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupNOCs (
        Id               INT           IDENTITY(1,1) PRIMARY KEY,
        NOCNo            NVARCHAR(50)  NULL,

        -- Applicant: AccountHeadMaster.LHeadId WHERE LHeadType = 'A'
        ApplicantId      INT           NOT NULL,

        -- Unit & Agreement links (optional, from Followup module)
        UnitSelectionId  INT           NULL,
        AgreementId      INT           NULL,

        -- Project: enterprise.id WHERE business_type = 'P'
        ProjectId        INT           NULL,

        -- Company: enterprise.id WHERE business_type = 'C'
        CompanyId        INT           NULL,

        NOCDate          DATE          NULL,
        ApprovalDate     DATE          NULL,
        IssuedDate       DATE          NULL,
        ApprovedBy       NVARCHAR(200) NULL,
        Reason           NVARCHAR(500) NULL,
        Status           NVARCHAR(30)  NOT NULL DEFAULT 'Pending',
        Notes            NVARCHAR(MAX) NULL,
        IsDeleted        BIT           NOT NULL DEFAULT 0,
        CreatedBy        NVARCHAR(100) NULL,
        CreatedAt        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedBy        NVARCHAR(100) NULL,
        UpdatedAt        DATETIME2     NULL,

        CONSTRAINT FK_FNOC_UnitSelection
            FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id),

        CONSTRAINT FK_FNOC_Agreement
            FOREIGN KEY (AgreementId) REFERENCES dbo.FollowupAgreements(Id),

        CONSTRAINT CK_FNOC_Status
            CHECK (Status IN ('Pending','Approved','Issued','Rejected'))
    );
END;
GO

-- ── Indexes ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupNOCs_ApplicantId' AND object_id = OBJECT_ID('dbo.FollowupNOCs'))
    CREATE INDEX IX_FollowupNOCs_ApplicantId ON dbo.FollowupNOCs(ApplicantId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupNOCs_Status' AND object_id = OBJECT_ID('dbo.FollowupNOCs'))
    CREATE INDEX IX_FollowupNOCs_Status ON dbo.FollowupNOCs(Status, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupNOCs_AgreementId' AND object_id = OBJECT_ID('dbo.FollowupNOCs'))
    CREATE INDEX IX_FollowupNOCs_AgreementId ON dbo.FollowupNOCs(AgreementId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupNOCs_ProjectId' AND object_id = OBJECT_ID('dbo.FollowupNOCs'))
    CREATE INDEX IX_FollowupNOCs_ProjectId ON dbo.FollowupNOCs(ProjectId, IsDeleted);
GO
