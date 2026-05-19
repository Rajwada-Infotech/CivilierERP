-- Migration 065: Create FollowupNOCs table

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupNOCs' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupNOCs (
        Id               INT           IDENTITY(1,1) PRIMARY KEY,
        NOCNo            NVARCHAR(50)  NULL,
        ApplicantId      INT           NOT NULL,
        UnitSelectionId  INT           NULL,
        AgreementId      INT           NULL,
        ProjectId        INT           NULL,
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
        CreatedAt        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy        NVARCHAR(100) NULL,
        UpdatedAt        DATETIME2     NULL,

        CONSTRAINT FK_FNOC_Applicant
            FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplicants(Id),

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
GO
