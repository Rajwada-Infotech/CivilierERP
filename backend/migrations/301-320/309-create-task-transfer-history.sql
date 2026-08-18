-- Migration 309: Task Transfer (Follow-Up module).
--
-- Lets an admin bulk-reassign a user's own Active/Hold TaskMaster rows to a
-- different user in one action (Task Transfer page), instead of editing each
-- task's AssignedTo one at a time. dbo.TaskTransferHistory logs one row per
-- task per transfer (same shape as dbo.SaLeadAudit's field-level audit
-- trail) so every reassignment stays traceable — task, old user, new user,
-- who performed the transfer, and when.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TaskTransferHistory'
)
BEGIN
  CREATE TABLE dbo.TaskTransferHistory (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    TaskId         INT            NOT NULL,
    TaskNo         NVARCHAR(20)   NULL,
    TaskSubject    NVARCHAR(255)  NULL,
    FromUserId     INT            NOT NULL,
    ToUserId       INT            NOT NULL,
    TransferredBy  INT            NULL,
    TransferredAt  DATETIME2      NOT NULL CONSTRAINT DF_TTH_TransferredAt DEFAULT SYSUTCDATETIME(),
    Notes          NVARCHAR(500)  NULL,
    CONSTRAINT FK_TTH_Task FOREIGN KEY (TaskId) REFERENCES dbo.TaskMaster(Id),
    CONSTRAINT FK_TTH_FromUser FOREIGN KEY (FromUserId) REFERENCES dbo.users(id),
    CONSTRAINT FK_TTH_ToUser FOREIGN KEY (ToUserId) REFERENCES dbo.users(id),
    CONSTRAINT FK_TTH_TransferredBy FOREIGN KEY (TransferredBy) REFERENCES dbo.users(id)
  );

  CREATE INDEX IX_TTH_TaskId ON dbo.TaskTransferHistory(TaskId);
  CREATE INDEX IX_TTH_TransferredAt ON dbo.TaskTransferHistory(TransferredAt DESC);

  PRINT 'Created dbo.TaskTransferHistory';
END
ELSE
  PRINT 'dbo.TaskTransferHistory already exists — skipping create';
GO

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('followup-task-transfer', 'Task Transfer', 'Follow-Up', 'Follow-Up', 'view,create', 3, 1, 'migration-309')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey = 'followup-task-transfer';
GO
