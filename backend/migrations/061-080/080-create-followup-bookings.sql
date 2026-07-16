IF OBJECT_ID('dbo.FollowupBookings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupBookings (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    BookingNo         NVARCHAR(50)      NULL,
    ApplicantId       INT               NOT NULL,
    UnitSelectionId   INT               NULL,
    ProjectId         INT               NULL,
    CompanyId         INT               NULL,
    UnitNo            NVARCHAR(100)     NOT NULL,
    BlockName         NVARCHAR(100)     NULL,
    FloorName         NVARCHAR(100)     NULL,
    UnitType          NVARCHAR(100)     NULL,
    AreaSqFt          DECIMAL(18,2)     NULL,
    RatePerSqFt       DECIMAL(18,2)     NULL,
    TotalValue        DECIMAL(18,2)     NULL,
    BookingAmount     DECIMAL(18,2)     NOT NULL,
    BookingDate       DATE              NOT NULL,
    PaymentMode       NVARCHAR(50)      NULL,
    ChequeNo          NVARCHAR(100)     NULL,
    BankName          NVARCHAR(255)     NULL,
    LoanApproved      BIT               NOT NULL CONSTRAINT DF_FollowupBookings_LoanApproved DEFAULT 0,
    LoanBank          NVARCHAR(255)     NULL,
    LoanAmount        DECIMAL(18,2)     NULL,
    AssignedTo        INT               NULL,
    Status            NVARCHAR(30)      NOT NULL CONSTRAINT DF_FollowupBookings_Status       DEFAULT 'Confirmed',
    Notes             NVARCHAR(MAX)     NULL,
    CreatedBy         NVARCHAR(100)     NULL,
    CreatedAt         DATETIME2         NOT NULL CONSTRAINT DF_FollowupBookings_CreatedAt    DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(100)     NULL,
    UpdatedAt         DATETIME2         NULL,
    IsDeleted         BIT               NOT NULL CONSTRAINT DF_FollowupBookings_IsDeleted    DEFAULT 0
  );

  ALTER TABLE dbo.FollowupBookings ADD CONSTRAINT FK_FollowupBookings_Applicant
    FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplications(Id);

  IF OBJECT_ID('dbo.FollowupUnitSelections', 'U') IS NOT NULL
    ALTER TABLE dbo.FollowupBookings ADD CONSTRAINT FK_FollowupBookings_UnitSelection
      FOREIGN KEY (UnitSelectionId) REFERENCES dbo.FollowupUnitSelections(Id);

  IF OBJECT_ID('dbo.ProjectMaster', 'U') IS NOT NULL
    ALTER TABLE dbo.FollowupBookings ADD CONSTRAINT FK_FollowupBookings_Project
      FOREIGN KEY (ProjectId) REFERENCES dbo.ProjectMaster(Id);

  IF OBJECT_ID('dbo.CompanyMaster', 'U') IS NOT NULL
    ALTER TABLE dbo.FollowupBookings ADD CONSTRAINT FK_FollowupBookings_Company
      FOREIGN KEY (CompanyId) REFERENCES dbo.CompanyMaster(Id);

  IF OBJECT_ID('dbo.users', 'U') IS NOT NULL
    ALTER TABLE dbo.FollowupBookings ADD CONSTRAINT FK_FollowupBookings_AssignedTo
      FOREIGN KEY (AssignedTo) REFERENCES dbo.users(id);

  CREATE UNIQUE INDEX UX_FollowupBookings_BookingNo
    ON dbo.FollowupBookings(BookingNo) WHERE BookingNo IS NOT NULL;

  CREATE INDEX IX_FollowupBookings_ApplicantId ON dbo.FollowupBookings(ApplicantId);
  CREATE INDEX IX_FollowupBookings_Status       ON dbo.FollowupBookings(Status);
  CREATE INDEX IX_FollowupBookings_ProjectId    ON dbo.FollowupBookings(ProjectId);
  CREATE INDEX IX_FollowupBookings_BookingDate  ON dbo.FollowupBookings(BookingDate);
END;
