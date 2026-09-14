-- Migration 331: Tag Master + task-tag association.
-- Tags are a free-form label a user can attach to any TaskMaster row from
-- the Follow-Up task drawer (pick an existing tag or type a new one — the
-- drawer's PUT /api/task-master/:id/tags endpoint auto-creates any name
-- that doesn't already exist in TagMaster). TagMaster itself is managed
-- from Follow-Up Setup (Add/Edit/Delete/Activate-Deactivate), same CRUD
-- shape as DepartmentMaster.

IF OBJECT_ID('dbo.TagMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TagMaster (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    Name       NVARCHAR(60)   NOT NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_TagMaster_IsActive DEFAULT 1,
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_TagMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT            NULL,
    UpdatedAt  DATETIME2      NULL,

    CONSTRAINT UQ_TagMaster_Name UNIQUE (Name),
    CONSTRAINT FK_TagMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_TagMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  PRINT 'Created dbo.TagMaster';
END
GO

IF OBJECT_ID('dbo.TaskTags', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TaskTags (
    Id         INT        IDENTITY(1,1) PRIMARY KEY,
    TaskId     INT        NOT NULL,
    TagId      INT        NOT NULL,
    CreatedBy  INT        NULL,
    CreatedAt  DATETIME2  NOT NULL CONSTRAINT DF_TaskTags_CreatedAt DEFAULT SYSUTCDATETIME(),

    CONSTRAINT UQ_TaskTags_TaskId_TagId UNIQUE (TaskId, TagId),
    CONSTRAINT FK_TaskTags_Task FOREIGN KEY (TaskId) REFERENCES dbo.TaskMaster(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskTags_Tag FOREIGN KEY (TagId) REFERENCES dbo.TagMaster(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskTags_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_TaskTags_TaskId ON dbo.TaskTags(TaskId);
  CREATE INDEX IX_TaskTags_TagId ON dbo.TaskTags(TagId);
  PRINT 'Created dbo.TaskTags';
END
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'followup-tag-master', 'Tag Master', 'Follow-Up', 'Follow-Up Setup', 'view,create,edit,delete', 6, 1, 'migration-331', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'followup-tag-master' AND pd.IsActive = 1
);
GO
