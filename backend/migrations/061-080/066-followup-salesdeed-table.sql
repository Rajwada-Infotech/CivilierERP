-- Migration 066: Create FollowupSalesDeeds table
--
-- ApplicantId  → dbo.AccountHeadMaster.LHeadId  (LHeadType = 'A')
-- ProjectId    → dbo.enterprise.id              (business_type = 'P')
-- CompanyId    → dbo.enterprise.id              (business_type = 'C')
-- UnitSelectionId → dbo.FollowupUnitSelections.Id  (optional)
-- AgreementId  → dbo.FollowupAgreements.Id         (optional)

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupSalesDeeds' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupSalesDeeds (
        Id                   INT           IDENTITY(1,1) PRIMARY KEY,
        DeedNo               NVARCHAR(50)  NULL,

        -- Applicant / Buyer: AccountHeadMaster.LHeadId WHERE LHeadType = 'A'
        ApplicantId          INT           NOT NULL,

        -- Unit & Agreement links (optional, from Followup module)
        UnitSelectionId      INT           NULL,
        AgreementId          INT           NULL,

        -- Project: enterprise.id WHERE business_type = 'P'
        ProjectId            INT           NULL,

        -- Company (Seller): enterprise.id WHERE business_type = 'C'
        CompanyId            INT           NULL,

        -- Deed financials
        DeedValue            DECIMAL(18,2) NULL,   -- Total sale consideration
        StampDuty            DECIMAL(18,2) NULL,   -- Stamp duty paid
        RegistrationFee      DECIMAL(18,2) NULL,   -- Registration fee paid

        -- Registration details
        SubRegistrarOffice   NVARCHAR(200) NULL,   -- Name / location of SRO
        RegistrationNo       NVARCHAR(100) NULL,   -- Official registration number
        BookNo               NVARCHAR(50)  NULL,   -- Deed book / volume number
        PartNo               NVARCHAR(50)  NULL,   -- Part / serial within book

        -- Key dates
        DeedDate             DATE          NULL,   -- Date of execution
        RegistrationDate     DATE          NULL,   -- Date of registration at SRO
        PossessionDate       DATE          NULL,   -- Possession handed to buyer

        -- Parties
        ExecutedBy           NVARCHAR(200) NULL,   -- Seller signatory / authority
        WitnessNames         NVARCHAR(500) NULL,   -- Witnesses (comma-separated)

        -- Workflow
        Status               NVARCHAR(30)  NOT NULL DEFAULT 'Draft',
        Notes                NVARCHAR(MAX) NULL,

        IsDeleted            BIT           NOT NULL DEFAULT 0,
        CreatedBy            NVARCHAR(100) NULL,
        CreatedAt            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy            NVARCHAR(100) NULL,
        UpdatedAt            DATETIME2     NULL,

        CONSTRAINT FK_FSD_UnitSelection
            FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id),

        CONSTRAINT FK_FSD_Agreement
            FOREIGN KEY (AgreementId) REFERENCES dbo.FollowupAgreements(Id),

        CONSTRAINT CK_FSD_Status
            CHECK (Status IN ('Draft','Executed','Registered','Overdue','Cancelled'))
    );
END;
GO

-- ── Indexes ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupSalesDeeds_ApplicantId' AND object_id = OBJECT_ID('dbo.FollowupSalesDeeds'))
    CREATE INDEX IX_FollowupSalesDeeds_ApplicantId ON dbo.FollowupSalesDeeds(ApplicantId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupSalesDeeds_Status' AND object_id = OBJECT_ID('dbo.FollowupSalesDeeds'))
    CREATE INDEX IX_FollowupSalesDeeds_Status ON dbo.FollowupSalesDeeds(Status, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupSalesDeeds_AgreementId' AND object_id = OBJECT_ID('dbo.FollowupSalesDeeds'))
    CREATE INDEX IX_FollowupSalesDeeds_AgreementId ON dbo.FollowupSalesDeeds(AgreementId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupSalesDeeds_ProjectId' AND object_id = OBJECT_ID('dbo.FollowupSalesDeeds'))
    CREATE INDEX IX_FollowupSalesDeeds_ProjectId ON dbo.FollowupSalesDeeds(ProjectId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupSalesDeeds_RegistrationDate' AND object_id = OBJECT_ID('dbo.FollowupSalesDeeds'))
    CREATE INDEX IX_FollowupSalesDeeds_RegistrationDate ON dbo.FollowupSalesDeeds(RegistrationDate, IsDeleted);
GO
