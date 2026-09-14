-- Migration 064: Create Followup module tables
-- FollowupApplicants, FollowupUnitSelections, FollowupAgreements

-- ── FollowupApplicants ────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupApplicants' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupApplicants (
        Id                INT           IDENTITY(1,1) PRIMARY KEY,
        ApplicantNo       NVARCHAR(50)  NULL,
        ApplicantName     NVARCHAR(200) NOT NULL,
        PrimaryMobile     NVARCHAR(20)  NULL,
        Email             NVARCHAR(200) NULL,
        City              NVARCHAR(100) NULL,
        Source            NVARCHAR(100) NULL,
        ProjectId         INT           NULL,
        CompanyId         INT           NULL,
        PreferredUnitType NVARCHAR(100) NULL,
        BudgetAmount      DECIMAL(18,2) NULL,
        Status            NVARCHAR(50)  NOT NULL DEFAULT 'Active',
        AssignedTo        NVARCHAR(100) NULL,
        Notes             NVARCHAR(MAX) NULL,
        IsDeleted         BIT           NOT NULL DEFAULT 0,
        CreatedBy         NVARCHAR(100) NULL,
        CreatedAt         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy         NVARCHAR(100) NULL,
        UpdatedAt         DATETIME2     NULL
    );
END;
GO

-- Trigger for ApplicantNo (Separate from table creation)
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_FollowupApplicants_ApplicantNo')
BEGIN
    EXEC('
        CREATE TRIGGER dbo.trg_FollowupApplicants_ApplicantNo
        ON dbo.FollowupApplicants
        AFTER INSERT
        AS
        BEGIN
            SET NOCOUNT ON;
            UPDATE fa
            SET ApplicantNo = ''APP'' + RIGHT(''000000'' + CAST(i.Id AS NVARCHAR(10)), 6)
            FROM dbo.FollowupApplicants fa
            INNER JOIN inserted i ON fa.Id = i.Id
            WHERE fa.ApplicantNo IS NULL;
        END;
    ');
END;
GO

-- ── FollowupUnitSelections ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupUnitSelections' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupUnitSelections (
        Id            INT           IDENTITY(1,1) PRIMARY KEY,
        SelectionNo   NVARCHAR(50)  NULL,
        ApplicantId   INT           NOT NULL,
        ProjectId     INT           NULL,
        CompanyId     INT           NULL,
        UnitNo        NVARCHAR(100) NOT NULL,
        BlockName     NVARCHAR(100) NULL,
        FloorName     NVARCHAR(100) NULL,
        UnitType      NVARCHAR(100) NULL,
        AreaSqFt      DECIMAL(18,2) NULL,
        RatePerSqFt   DECIMAL(18,2) NULL,
        TotalValue    DECIMAL(18,2) NULL,
        BookingAmount DECIMAL(18,2) NULL,
        SelectionDate DATE          NULL,
        Status        NVARCHAR(50)  NOT NULL DEFAULT 'Active',
        Notes         NVARCHAR(MAX) NULL,
        IsDeleted     BIT           NOT NULL DEFAULT 0,
        CreatedBy     NVARCHAR(100) NULL,
        CreatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy     NVARCHAR(100) NULL,
        UpdatedAt     DATETIME2     NULL,

        CONSTRAINT FK_FUS_Applicant
            FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplicants(Id)
    );
END;
GO

-- Trigger for SelectionNo
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_FollowupUnitSelections_SelectionNo')
BEGIN
    EXEC('
        CREATE TRIGGER dbo.trg_FollowupUnitSelections_SelectionNo
        ON dbo.FollowupUnitSelections
        AFTER INSERT
        AS
        BEGIN
            SET NOCOUNT ON;
            UPDATE fus
            SET SelectionNo = ''SEL'' + RIGHT(''000000'' + CAST(i.Id AS NVARCHAR(10)), 6)
            FROM dbo.FollowupUnitSelections fus
            INNER JOIN inserted i ON fus.Id = i.Id
            WHERE fus.SelectionNo IS NULL;
        END;
    ');
END;
GO

-- ── FollowupAgreements ────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupAgreements' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupAgreements (
        Id               INT           IDENTITY(1,1) PRIMARY KEY,
        AgreementNo      NVARCHAR(50)  NULL,
        ApplicantId      INT           NOT NULL,
        UnitSelectionId  INT           NULL,
        ProjectId        INT           NULL,
        CompanyId        INT           NULL,
        AgreementDate    DATE          NULL,
        AgreementValue   DECIMAL(18,2) NULL,
        AdvanceAmount    DECIMAL(18,2) NULL,
        BalanceAmount    DECIMAL(18,2) NULL,
        RegistrationDate DATE          NULL,
        Status           NVARCHAR(30)  NOT NULL DEFAULT 'Draft',
        Notes            NVARCHAR(MAX) NULL,
        IsDeleted        BIT           NOT NULL DEFAULT 0,
        CreatedBy        NVARCHAR(100) NULL,
        CreatedAt        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy        NVARCHAR(100) NULL,
        UpdatedAt        DATETIME2     NULL,

        CONSTRAINT FK_FAG_Applicant
            FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplicants(Id),

        CONSTRAINT FK_FAG_UnitSelection
            FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id),

        CONSTRAINT CK_FAG_Status
            CHECK (Status IN ('Draft','Issued','Signed','Cancelled'))
    );
END;
GO

-- ── Indexes ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupApplicants_IsDeleted' AND object_id = OBJECT_ID('dbo.FollowupApplicants'))
    CREATE INDEX IX_FollowupApplicants_IsDeleted ON dbo.FollowupApplicants(IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupUnitSelections_ApplicantId' AND object_id = OBJECT_ID('dbo.FollowupUnitSelections'))
    CREATE INDEX IX_FollowupUnitSelections_ApplicantId ON dbo.FollowupUnitSelections(ApplicantId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupAgreements_ApplicantId' AND object_id = OBJECT_ID('dbo.FollowupAgreements'))
    CREATE INDEX IX_FollowupAgreements_ApplicantId ON dbo.FollowupAgreements(ApplicantId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupAgreements_Status' AND object_id = OBJECT_ID('dbo.FollowupAgreements'))
    CREATE INDEX IX_FollowupAgreements_Status ON dbo.FollowupAgreements(Status, IsDeleted);
GO
