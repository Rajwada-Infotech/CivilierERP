-- Migration 431: Interview (HR and Payroll module) — the recruitment
-- interview transaction. Links a Candidate (dbo.CandidateMaster) to a
-- Company/Project (both dbo.enterprise, same pattern EmployeeMaster.CompanyId
-- already uses) with its own DocNo, InterviewDate and Remarks, plus a
-- Status the interviewer sets afterwards (Selected/Rejected/Hold) from the
-- records list. DocNo is a simple self-contained "INT-00001" sequence
-- scoped to this table (not the shared TypeOfDoc/DocNumberSequence system,
-- which requires an Entry_Type row that has no natural HR-recruitment
-- equivalent) — uniqueness enforced at the DB level, server retries on
-- collision.

IF OBJECT_ID('dbo.Interview', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Interview (
    InterviewId    INT            IDENTITY(1,1) PRIMARY KEY,
    DocNo          NVARCHAR(30)   NOT NULL,
    CandidateId    INT            NOT NULL,
    CompanyId      INT            NULL,
    ProjectId      INT            NULL,
    InterviewDate  DATE           NOT NULL,
    Remarks        NVARCHAR(1000) NULL,
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT DF_Interview_Status DEFAULT 'PENDING',
    IsActive       BIT            NOT NULL CONSTRAINT DF_Interview_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_Interview_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,

    CONSTRAINT UQ_Interview_DocNo UNIQUE (DocNo),
    CONSTRAINT CK_Interview_Status CHECK (Status IN ('PENDING','SELECTED','REJECTED','HOLD')),
    CONSTRAINT FK_Interview_Candidate FOREIGN KEY (CandidateId) REFERENCES dbo.CandidateMaster(CandidateId),
    CONSTRAINT FK_Interview_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_Interview_Project FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_Interview_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_Interview_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_Interview_CandidateId ON dbo.Interview(CandidateId);
  CREATE INDEX IX_Interview_CompanyId ON dbo.Interview(CompanyId);
  CREATE INDEX IX_Interview_ProjectId ON dbo.Interview(ProjectId);
END
GO

-- New page: "Interview" — a main HR transaction page (not a Setup master),
-- reachable from the HR and Payroll sidebar's HR section.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'interview')
  UPDATE dbo.PageDefinitions
    SET Label = N'Interview', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 15, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'interview';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'interview', N'Interview', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete,print,export', 15, 1, N'migration-431', SYSDATETIME());
GO

PRINT '431-interview applied successfully.';
GO
