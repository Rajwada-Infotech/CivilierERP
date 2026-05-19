-- Migration 067: Create FollowupHandovers table
--
-- ApplicantId     → dbo.AccountHeadMaster.LHeadId  (LHeadType = 'A')
-- ProjectId       → dbo.enterprise.id              (business_type = 'P')
-- CompanyId       → dbo.enterprise.id              (business_type = 'C')
-- UnitSelectionId → dbo.FollowupUnitSelections.Id  (optional)
-- AgreementId     → dbo.FollowupAgreements.Id      (optional)
-- SalesDeedId     → dbo.FollowupSalesDeeds.Id      (optional)

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupHandovers' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.FollowupHandovers (
        Id                   INT           IDENTITY(1,1) PRIMARY KEY,
        HandoverNo           NVARCHAR(50)  NULL,

        -- Applicant / Buyer: AccountHeadMaster.LHeadId WHERE LHeadType = 'A'
        ApplicantId          INT           NOT NULL,

        -- Linked documents (all optional)
        UnitSelectionId      INT           NULL,
        AgreementId          INT           NULL,
        SalesDeedId          INT           NULL,

        -- Project: enterprise.id WHERE business_type = 'P'
        ProjectId            INT           NULL,

        -- Company (Developer): enterprise.id WHERE business_type = 'C'
        CompanyId            INT           NULL,

        -- Handover details
        HandoverDate         DATE          NULL,   -- Scheduled handover date
        ActualHandoverDate   DATE          NULL,   -- Date possession was actually given
        KeyHandoverDate      DATE          NULL,   -- Date keys were physically handed

        -- Unit condition at handover
        UnitCondition        NVARCHAR(50)  NULL,   -- e.g. Ready, Punch-list Pending, Snagging
        SnagListItems        NVARCHAR(MAX) NULL,   -- Free-text or JSON list of pending snags
        SnagsClearedDate     DATE          NULL,   -- Date all snags were cleared

        -- People involved
        HandedOverBy         NVARCHAR(200) NULL,   -- Company representative
        ReceivedBy           NVARCHAR(200) NULL,   -- Buyer / authorised person
        WitnessNames         NVARCHAR(500) NULL,

        -- Checklist flags
        ElectricMeterHandedOver  BIT       NOT NULL DEFAULT 0,
        WaterConnectionHandedOver BIT      NOT NULL DEFAULT 0,
        ParkingAllotted          BIT       NOT NULL DEFAULT 0,
        WelcomeKitGiven          BIT       NOT NULL DEFAULT 0,

        -- Workflow
        Status               NVARCHAR(30)  NOT NULL DEFAULT 'Scheduled',
        Notes                NVARCHAR(MAX) NULL,

        IsDeleted            BIT           NOT NULL DEFAULT 0,
        CreatedBy            NVARCHAR(100) NULL,
        CreatedAt            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        UpdatedBy            NVARCHAR(100) NULL,
        UpdatedAt            DATETIME2     NULL,

        CONSTRAINT FK_FHO_UnitSelection
            FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id),

        CONSTRAINT FK_FHO_Agreement
            FOREIGN KEY (AgreementId) REFERENCES dbo.FollowupAgreements(Id),

        CONSTRAINT FK_FHO_SalesDeed
            FOREIGN KEY (SalesDeedId) REFERENCES dbo.FollowupSalesDeeds(Id),

        CONSTRAINT CK_FHO_Status
            CHECK (Status IN ('Scheduled','Completed','Delayed','Cancelled')),

        CONSTRAINT CK_FHO_UnitCondition
            CHECK (UnitCondition IS NULL OR UnitCondition IN ('Ready','Punch-list Pending','Snagging','Minor Works'))
    );
END;
GO

-- ── Indexes ───────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupHandovers_ApplicantId' AND object_id = OBJECT_ID('dbo.FollowupHandovers'))
    CREATE INDEX IX_FollowupHandovers_ApplicantId ON dbo.FollowupHandovers(ApplicantId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupHandovers_Status' AND object_id = OBJECT_ID('dbo.FollowupHandovers'))
    CREATE INDEX IX_FollowupHandovers_Status ON dbo.FollowupHandovers(Status, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupHandovers_AgreementId' AND object_id = OBJECT_ID('dbo.FollowupHandovers'))
    CREATE INDEX IX_FollowupHandovers_AgreementId ON dbo.FollowupHandovers(AgreementId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupHandovers_ProjectId' AND object_id = OBJECT_ID('dbo.FollowupHandovers'))
    CREATE INDEX IX_FollowupHandovers_ProjectId ON dbo.FollowupHandovers(ProjectId, IsDeleted);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FollowupHandovers_HandoverDate' AND object_id = OBJECT_ID('dbo.FollowupHandovers'))
    CREATE INDEX IX_FollowupHandovers_HandoverDate ON dbo.FollowupHandovers(HandoverDate, IsDeleted);
GO
