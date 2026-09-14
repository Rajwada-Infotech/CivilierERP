-- Migration 422: Employee Master (HR and Payroll module) — the core
-- employee record. ReportingManagerId is a self-referencing FK (an
-- employee's manager is another employee); CostCenterId reuses the
-- existing Finance Cost Centre master (dbo.CostCenter) rather than
-- inventing a parallel one. Both use the default NO ACTION on delete —
-- SQL Server rejects ON DELETE CASCADE on a self-referencing FK outright,
-- and a Cost Centre shouldn't be deletable while employees still point at
-- it either.
--
-- Department / Designation / Branch-Location / Grade-Level are plain
-- free-text fields for now, not their own master tables — matches the
-- "shell first, build out masters as needed" approach the HR and Payroll
-- module started with (see AppSidebar/ModuleStrip's hr-payroll entry).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EmployeeMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.EmployeeMaster (
    EmployeeId              INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeCode             NVARCHAR(30)   NOT NULL,
    EmployeeName             NVARCHAR(150)  NOT NULL,
    PhotoBase64               NVARCHAR(MAX)  NULL,
    DateOfBirth              DATE           NULL,
    Gender                   NVARCHAR(20)   NULL,
    Mobile                   NVARCHAR(20)   NULL,
    Email                    NVARCHAR(150)  NULL,
    Address                  NVARCHAR(500)  NULL,
    EmergencyContactName     NVARCHAR(150)  NULL,
    EmergencyContactPhone    NVARCHAR(20)   NULL,
    JoiningDate              DATE           NULL,
    ConfirmationDate         DATE           NULL,
    Department               NVARCHAR(100)  NULL,
    Designation              NVARCHAR(100)  NULL,
    BranchLocation           NVARCHAR(150)  NULL,
    ReportingManagerId       INT            NULL,
    EmploymentType           NVARCHAR(30)   NULL,
    GradeLevel               NVARCHAR(50)   NULL,
    CostCenterId             INT            NULL,
    BankName                 NVARCHAR(150)  NULL,
    BankAccountNumber        NVARCHAR(40)   NULL,
    BankIFSC                 NVARCHAR(20)   NULL,
    PAN                      NVARCHAR(20)   NULL,
    Aadhaar                  NVARCHAR(20)   NULL,
    UAN                      NVARCHAR(20)   NULL,
    ESICNumber               NVARCHAR(30)   NULL,
    PFNumber                 NVARCHAR(30)   NULL,
    NomineeName              NVARCHAR(150)  NULL,
    NomineeRelationship      NVARCHAR(50)   NULL,
    NomineeContact           NVARCHAR(20)   NULL,
    IsActive                 BIT            NOT NULL DEFAULT 1,
    CreatedBy                NVARCHAR(150)  NULL,
    CreatedAt                DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy                NVARCHAR(150)  NULL,
    UpdatedAt                DATETIME2      NULL,
    CONSTRAINT UQ_EmployeeMaster_Code UNIQUE (EmployeeCode),
    CONSTRAINT FK_EmployeeMaster_ReportingManager FOREIGN KEY (ReportingManagerId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT FK_EmployeeMaster_CostCenter FOREIGN KEY (CostCenterId) REFERENCES dbo.CostCenter(CostCenterId)
  );
  CREATE INDEX IX_EmployeeMaster_ReportingManagerId ON dbo.EmployeeMaster(ReportingManagerId);
  CREATE INDEX IX_EmployeeMaster_CostCenterId ON dbo.EmployeeMaster(CostCenterId);
END
GO
