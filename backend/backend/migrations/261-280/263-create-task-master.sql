-- Migration 263: Task Master — org-wide task creation with optional
-- Case Details linkage (Company -> Project -> Financial Year, plus a
-- manually-entered Document Number/Case Number).
--
-- Company/Project both live in dbo.enterprise (business_type = 'C'/'P'
-- respectively — see backend/routes/companyMaster.js, projectMaster.js).
-- There is no unified cross-module "document registry" table in this
-- codebase, so CaseDocumentNumber stays a plain manual/free-text field
-- rather than a foreign key.

IF OBJECT_ID('dbo.TaskMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TaskMaster (
    Id                 INT            IDENTITY(1,1) PRIMARY KEY,
    TaskNo             NVARCHAR(20)   NULL,
    Subject            NVARCHAR(255)  NOT NULL,
    Details            NVARCHAR(MAX)  NULL,
    Department         NVARCHAR(100)  NULL,
    DueDate            DATE           NULL,
    CaseNumber         NVARCHAR(100)  NULL,
    Priority           NVARCHAR(20)   NOT NULL CONSTRAINT DF_TaskMaster_Priority DEFAULT 'Normal',
    Status             NVARCHAR(20)   NOT NULL CONSTRAINT DF_TaskMaster_Status DEFAULT 'Active',
    CaseCompanyId      INT            NULL,
    CaseProjectId      INT            NULL,
    CaseFinYearId      INT            NULL,
    CaseDocumentNumber NVARCHAR(100)  NULL,
    CreatedBy          INT            NULL,
    CreatedAt          DATETIME2      NOT NULL CONSTRAINT DF_TaskMaster_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy          INT            NULL,
    UpdatedAt          DATETIME2      NULL,
    IsDeleted          BIT            NOT NULL CONSTRAINT DF_TaskMaster_IsDeleted DEFAULT 0,

    CONSTRAINT CK_TaskMaster_Priority CHECK (Priority IN ('VVIP','LI','Normal')),
    CONSTRAINT CK_TaskMaster_Status CHECK (Status IN ('Active','Hold','Cancel')),

    CONSTRAINT FK_TaskMaster_CaseCompany FOREIGN KEY (CaseCompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_TaskMaster_CaseProject FOREIGN KEY (CaseProjectId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_TaskMaster_CaseFinYear FOREIGN KEY (CaseFinYearId) REFERENCES dbo.FinYear(FId),
    CONSTRAINT FK_TaskMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_TaskMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );

  -- TaskNo (e.g. TSK000001) is filled in after insert, from the identity
  -- value — same trigger-based pattern as trg_FollowupApplicants_ApplicantNo
  -- used to (see migrations/061-080/064b-followup-agreements-tables.sql).
  CREATE UNIQUE INDEX UX_TaskMaster_TaskNo
    ON dbo.TaskMaster(TaskNo)
    WHERE TaskNo IS NOT NULL;

  CREATE INDEX IX_TaskMaster_Status ON dbo.TaskMaster(Status, IsDeleted);
  CREATE INDEX IX_TaskMaster_Priority ON dbo.TaskMaster(Priority, IsDeleted);
  CREATE INDEX IX_TaskMaster_DueDate ON dbo.TaskMaster(DueDate);
  CREATE INDEX IX_TaskMaster_CaseProjectId ON dbo.TaskMaster(CaseProjectId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_TaskMaster_TaskNo')
BEGIN
  EXEC('
    CREATE TRIGGER dbo.trg_TaskMaster_TaskNo
    ON dbo.TaskMaster
    AFTER INSERT
    AS
    BEGIN
      SET NOCOUNT ON;
      UPDATE tm
      SET TaskNo = ''TSK'' + RIGHT(''000000'' + CAST(i.Id AS NVARCHAR(10)), 6)
      FROM dbo.TaskMaster tm
      INNER JOIN inserted i ON tm.Id = i.Id
      WHERE tm.TaskNo IS NULL;
    END;
  ');
END
GO

-- New Setup item: "Task Master" (backend/routes/taskMaster.js /
-- src/pages/admin/masters/TaskMaster.tsx), reachable from CRM Setup.
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'task-master', 'Task Master', 'CRM', 'CRM Setup', 'view,create,edit,delete', 170, 1, 'migration-263', SYSDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'task-master' AND pd.IsActive = 1
);
GO
