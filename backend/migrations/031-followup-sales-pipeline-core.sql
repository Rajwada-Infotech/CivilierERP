IF OBJECT_ID('dbo.FollowupApplicants', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupApplicants (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    ApplicantNo       NVARCHAR(50) NULL,
    ApplicantName     NVARCHAR(255) NOT NULL,
    PrimaryMobile     NVARCHAR(20) NULL,
    Email             NVARCHAR(255) NULL,
    City              NVARCHAR(100) NULL,
    Source            NVARCHAR(100) NULL,
    ProjectId         INT NULL,
    CompanyId         INT NULL,
    PreferredUnitType NVARCHAR(100) NULL,
    BudgetAmount      DECIMAL(18, 2) NULL,
    Status            NVARCHAR(30) NOT NULL CONSTRAINT DF_FollowupApplicants_Status DEFAULT 'New',
    AssignedTo        INT NULL,
    Notes             NVARCHAR(MAX) NULL,
    CreatedBy         NVARCHAR(100) NULL,
    CreatedAt         DATETIME2 NOT NULL CONSTRAINT DF_FollowupApplicants_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(100) NULL,
    UpdatedAt         DATETIME2 NULL,
    IsDeleted         BIT NOT NULL CONSTRAINT DF_FollowupApplicants_IsDeleted DEFAULT 0
  );

  ALTER TABLE dbo.FollowupApplicants
    ADD CONSTRAINT FK_FollowupApplicants_ProjectMaster
      FOREIGN KEY (ProjectId) REFERENCES dbo.ProjectMaster(Id);

  ALTER TABLE dbo.FollowupApplicants
    ADD CONSTRAINT FK_FollowupApplicants_CompanyMaster
      FOREIGN KEY (CompanyId) REFERENCES dbo.CompanyMaster(Id);

  ALTER TABLE dbo.FollowupApplicants
    ADD CONSTRAINT FK_FollowupApplicants_AssignedToUsers
      FOREIGN KEY (AssignedTo) REFERENCES dbo.users(id);

  CREATE UNIQUE INDEX UX_FollowupApplicants_ApplicantNo
    ON dbo.FollowupApplicants(ApplicantNo)
    WHERE ApplicantNo IS NOT NULL;

  CREATE INDEX IX_FollowupApplicants_Status ON dbo.FollowupApplicants(Status);
  CREATE INDEX IX_FollowupApplicants_ProjectId ON dbo.FollowupApplicants(ProjectId);
  CREATE INDEX IX_FollowupApplicants_CompanyId ON dbo.FollowupApplicants(CompanyId);
  CREATE INDEX IX_FollowupApplicants_AssignedTo ON dbo.FollowupApplicants(AssignedTo);
END;

IF OBJECT_ID('dbo.FollowupUnitSelections', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupUnitSelections (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    SelectionNo    NVARCHAR(50) NULL,
    ApplicantId    INT NOT NULL,
    ProjectId      INT NULL,
    CompanyId      INT NULL,
    UnitNo         NVARCHAR(100) NOT NULL,
    BlockName      NVARCHAR(100) NULL,
    FloorName      NVARCHAR(100) NULL,
    UnitType       NVARCHAR(100) NULL,
    AreaSqFt       DECIMAL(18, 2) NULL,
    RatePerSqFt    DECIMAL(18, 2) NULL,
    TotalValue     DECIMAL(18, 2) NULL,
    BookingAmount  DECIMAL(18, 2) NULL,
    SelectionDate  DATE NULL,
    Status         NVARCHAR(30) NOT NULL CONSTRAINT DF_FollowupUnitSelections_Status DEFAULT 'Reserved',
    Notes          NVARCHAR(MAX) NULL,
    CreatedBy      NVARCHAR(100) NULL,
    CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_FollowupUnitSelections_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy      NVARCHAR(100) NULL,
    UpdatedAt      DATETIME2 NULL,
    IsDeleted      BIT NOT NULL CONSTRAINT DF_FollowupUnitSelections_IsDeleted DEFAULT 0
  );

  ALTER TABLE dbo.FollowupUnitSelections
    ADD CONSTRAINT FK_FollowupUnitSelections_Applicant
      FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplicants(Id);

  ALTER TABLE dbo.FollowupUnitSelections
    ADD CONSTRAINT FK_FollowupUnitSelections_ProjectMaster
      FOREIGN KEY (ProjectId) REFERENCES dbo.ProjectMaster(Id);

  ALTER TABLE dbo.FollowupUnitSelections
    ADD CONSTRAINT FK_FollowupUnitSelections_CompanyMaster
      FOREIGN KEY (CompanyId) REFERENCES dbo.CompanyMaster(Id);

  CREATE UNIQUE INDEX UX_FollowupUnitSelections_SelectionNo
    ON dbo.FollowupUnitSelections(SelectionNo)
    WHERE SelectionNo IS NOT NULL;

  CREATE INDEX IX_FollowupUnitSelections_ApplicantId
    ON dbo.FollowupUnitSelections(ApplicantId);
  CREATE INDEX IX_FollowupUnitSelections_Status
    ON dbo.FollowupUnitSelections(Status);
  CREATE INDEX IX_FollowupUnitSelections_ProjectId
    ON dbo.FollowupUnitSelections(ProjectId);
END;

IF OBJECT_ID('dbo.FollowupAgreements', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupAgreements (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    AgreementNo     NVARCHAR(50) NULL,
    ApplicantId     INT NOT NULL,
    UnitSelectionId INT NULL,
    ProjectId       INT NULL,
    CompanyId       INT NULL,
    AgreementDate   DATE NULL,
    AgreementValue  DECIMAL(18, 2) NULL,
    AdvanceAmount   DECIMAL(18, 2) NULL,
    BalanceAmount   DECIMAL(18, 2) NULL,
    RegistrationDate DATE NULL,
    Status          NVARCHAR(30) NOT NULL CONSTRAINT DF_FollowupAgreements_Status DEFAULT 'Draft',
    Notes           NVARCHAR(MAX) NULL,
    CreatedBy       NVARCHAR(100) NULL,
    CreatedAt       DATETIME2 NOT NULL CONSTRAINT DF_FollowupAgreements_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy       NVARCHAR(100) NULL,
    UpdatedAt       DATETIME2 NULL,
    IsDeleted       BIT NOT NULL CONSTRAINT DF_FollowupAgreements_IsDeleted DEFAULT 0
  );

  ALTER TABLE dbo.FollowupAgreements
    ADD CONSTRAINT FK_FollowupAgreements_Applicant
      FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplicants(Id);

  ALTER TABLE dbo.FollowupAgreements
    ADD CONSTRAINT FK_FollowupAgreements_UnitSelection
      FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id);

  ALTER TABLE dbo.FollowupAgreements
    ADD CONSTRAINT FK_FollowupAgreements_ProjectMaster
      FOREIGN KEY (ProjectId) REFERENCES dbo.ProjectMaster(Id);

  ALTER TABLE dbo.FollowupAgreements
    ADD CONSTRAINT FK_FollowupAgreements_CompanyMaster
      FOREIGN KEY (CompanyId) REFERENCES dbo.CompanyMaster(Id);

  CREATE UNIQUE INDEX UX_FollowupAgreements_AgreementNo
    ON dbo.FollowupAgreements(AgreementNo)
    WHERE AgreementNo IS NOT NULL;

  CREATE INDEX IX_FollowupAgreements_ApplicantId
    ON dbo.FollowupAgreements(ApplicantId);
  CREATE INDEX IX_FollowupAgreements_UnitSelectionId
    ON dbo.FollowupAgreements(UnitSelectionId);
  CREATE INDEX IX_FollowupAgreements_Status
    ON dbo.FollowupAgreements(Status);
  CREATE INDEX IX_FollowupAgreements_ProjectId
    ON dbo.FollowupAgreements(ProjectId);
END;
