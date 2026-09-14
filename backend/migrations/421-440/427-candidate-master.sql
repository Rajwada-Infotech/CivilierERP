-- Migration 427: Candidate Master (HR and Payroll module) — recruitment
-- pipeline record. Resume is stored as a base64 data URI directly on the
-- row (ResumeFileName + ResumeBase64), same approach as EmployeeMaster's
-- PhotoBase64 field, rather than a separate attachment table — a single
-- resume per candidate doesn't need the multi-document sub-resource
-- Employee Master's Documents modal uses.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CandidateMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CandidateMaster (
    CandidateId       INT            IDENTITY(1,1) PRIMARY KEY,
    CandidateCode     NVARCHAR(30)   NOT NULL,
    CandidateName     NVARCHAR(150)  NOT NULL,
    Contact           NVARCHAR(20)   NULL,
    Email             NVARCHAR(150)  NULL,
    Qualification     NVARCHAR(200)  NULL,
    Experience        NVARCHAR(50)   NULL,
    ExpectedSalary    DECIMAL(12,2)  NULL,
    CurrentSalary     DECIMAL(12,2)  NULL,
    NoticePeriod      NVARCHAR(50)   NULL,
    ResumeFileName    NVARCHAR(255)  NULL,
    ResumeBase64      NVARCHAR(MAX)  NULL,
    InterviewStatus   NVARCHAR(30)   NULL,
    Remarks           NVARCHAR(1000) NULL,
    IsActive          BIT            NOT NULL DEFAULT 1,
    CreatedBy         NVARCHAR(150)  NULL,
    CreatedAt         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(150)  NULL,
    UpdatedAt         DATETIME2      NULL,
    CONSTRAINT UQ_CandidateMaster_Code UNIQUE (CandidateCode)
  );
END
GO

-- New Setup item: "Candidate Master" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'candidate-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Candidate Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 40, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'candidate-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'candidate-master', N'Candidate Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 40, 1, N'migration-427', SYSDATETIME());
GO

PRINT '427-candidate-master applied successfully.';
GO
