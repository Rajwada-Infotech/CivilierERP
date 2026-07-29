-- Migration 265: Follow-Up drawer support for Task Master —
-- assignee, a 4th terminal "Closed" status (distinct from "Cancel", which
-- stays audit-only/never-completed per the original workflow spec), and
-- three new child tables: a follow-up timeline (note + next reminder +
-- attachments), a chat thread, and shared file storage for both.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'AssignedTo'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD AssignedTo INT NULL;
  ALTER TABLE dbo.TaskMaster
    ADD CONSTRAINT FK_TaskMaster_AssignedTo FOREIGN KEY (AssignedTo) REFERENCES dbo.users(id);
  CREATE INDEX IX_TaskMaster_AssignedTo ON dbo.TaskMaster(AssignedTo);
END
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TaskMaster_Status')
BEGIN
  ALTER TABLE dbo.TaskMaster DROP CONSTRAINT CK_TaskMaster_Status;
END
ALTER TABLE dbo.TaskMaster
  ADD CONSTRAINT CK_TaskMaster_Status CHECK (Status IN ('Active','Hold','Cancel','Closed'));
GO

IF OBJECT_ID('dbo.TaskFollowUps', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TaskFollowUps (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    TaskId          INT            NOT NULL,
    Note            NVARCHAR(MAX)  NOT NULL,
    NextReminderAt  DATETIME2      NULL,
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2      NOT NULL CONSTRAINT DF_TaskFollowUps_CreatedAt DEFAULT SYSDATETIME(),

    CONSTRAINT FK_TaskFollowUps_Task FOREIGN KEY (TaskId) REFERENCES dbo.TaskMaster(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskFollowUps_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_TaskFollowUps_TaskId ON dbo.TaskFollowUps(TaskId, CreatedAt);
END
GO

IF OBJECT_ID('dbo.TaskAttachments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TaskAttachments (
    Id          INT             IDENTITY(1,1) PRIMARY KEY,
    TaskId      INT             NOT NULL,
    FollowUpId  INT             NULL,
    FileName    NVARCHAR(255)   NOT NULL,
    MimeType    NVARCHAR(100)   NULL,
    FileSize    INT             NULL,
    FileData    VARBINARY(MAX)  NOT NULL,
    UploadedBy  INT             NULL,
    UploadedAt  DATETIME2       NOT NULL CONSTRAINT DF_TaskAttachments_UploadedAt DEFAULT SYSDATETIME(),

    CONSTRAINT FK_TaskAttachments_Task FOREIGN KEY (TaskId) REFERENCES dbo.TaskMaster(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskAttachments_FollowUp FOREIGN KEY (FollowUpId) REFERENCES dbo.TaskFollowUps(Id),
    CONSTRAINT FK_TaskAttachments_UploadedBy FOREIGN KEY (UploadedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_TaskAttachments_TaskId ON dbo.TaskAttachments(TaskId);
  CREATE INDEX IX_TaskAttachments_FollowUpId ON dbo.TaskAttachments(FollowUpId);
END
GO

IF OBJECT_ID('dbo.TaskChatMessages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TaskChatMessages (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    TaskId     INT            NOT NULL,
    SenderId   INT            NULL,
    Message    NVARCHAR(MAX)  NOT NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_TaskChatMessages_CreatedAt DEFAULT SYSDATETIME(),

    CONSTRAINT FK_TaskChatMessages_Task FOREIGN KEY (TaskId) REFERENCES dbo.TaskMaster(Id) ON DELETE CASCADE,
    CONSTRAINT FK_TaskChatMessages_Sender FOREIGN KEY (SenderId) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_TaskChatMessages_TaskId ON dbo.TaskChatMessages(TaskId, CreatedAt);
END
GO
