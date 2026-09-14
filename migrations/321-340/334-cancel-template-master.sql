-- Migration 334: Cancel Template Master + cancellation audit fields on
-- TaskMaster. "Cancel" already existed as a Status value (see 265's
-- CK_TaskMaster_Status), but nothing captured WHY a task was cancelled,
-- who cancelled it, or when — this fills that in without touching the
-- status vocabulary itself.

IF OBJECT_ID('dbo.CancelTemplateMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CancelTemplateMaster (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    Reason     NVARCHAR(255)  NOT NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_CancelTemplateMaster_IsActive DEFAULT 1,
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_CancelTemplateMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT            NULL,
    UpdatedAt  DATETIME2      NULL,

    CONSTRAINT UQ_CancelTemplateMaster_Reason UNIQUE (Reason),
    CONSTRAINT FK_CancelTemplateMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_CancelTemplateMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  PRINT 'Created dbo.CancelTemplateMaster';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'CancelReasonId')
BEGIN
  ALTER TABLE dbo.TaskMaster ADD CancelReasonId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskMaster_CancelReason')
BEGIN
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_CancelReason FOREIGN KEY (CancelReasonId) REFERENCES dbo.CancelTemplateMaster(Id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'CancelledBy')
BEGIN
  ALTER TABLE dbo.TaskMaster ADD CancelledBy INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskMaster_CancelledBy')
BEGIN
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_CancelledBy FOREIGN KEY (CancelledBy) REFERENCES dbo.users(id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'CancelledAt')
BEGIN
  ALTER TABLE dbo.TaskMaster ADD CancelledAt DATETIME2 NULL;
END
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'followup-cancel-template-master', 'Cancel Template', 'Follow-Up', 'Follow-Up Setup', 'view,create,edit,delete', 7, 1, 'migration-334', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'followup-cancel-template-master' AND pd.IsActive = 1
);
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'followup-cancelled-tasks', 'Cancelled Tasks', 'Follow-Up', 'Follow-Up', 'view', 5, 1, 'migration-334', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'followup-cancelled-tasks' AND pd.IsActive = 1
);
GO
