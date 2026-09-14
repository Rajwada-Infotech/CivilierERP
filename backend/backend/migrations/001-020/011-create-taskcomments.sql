-- Create missing TaskComments table (safe idempotent version)
-- Matches tasks.js schema expectations exactly

IF OBJECT_ID('dbo.Tasks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Tasks (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(255) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    Status NVARCHAR(50) NOT NULL CONSTRAINT DF_Tasks_Status DEFAULT ('Pending'),
    Priority NVARCHAR(50) NULL,
    DueDate DATE NULL,
    AssignedTo INT NULL,
    CreatedBy INT NULL,
    ReviewedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tasks_CreatedAt DEFAULT (GETDATE()),
    UpdatedAt DATETIME2 NULL,
    CompletedAt DATETIME2 NULL
  );

  IF OBJECT_ID('dbo.users', 'U') IS NOT NULL
  BEGIN
    ALTER TABLE dbo.Tasks
      ADD CONSTRAINT FK_Tasks_AssignedTo FOREIGN KEY (AssignedTo) REFERENCES dbo.users(id);

    ALTER TABLE dbo.Tasks
      ADD CONSTRAINT FK_Tasks_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id);

    ALTER TABLE dbo.Tasks
      ADD CONSTRAINT FK_Tasks_ReviewedBy FOREIGN KEY (ReviewedBy) REFERENCES dbo.users(id);
  END

  PRINT 'Tasks table created/verified successfully';
END

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TaskComments')
CREATE TABLE dbo.TaskComments (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  TaskId INT NOT NULL,
  UserId INT NOT NULL,
  Text NVARCHAR(MAX) NOT NULL,
  CreatedAt DATETIME2 DEFAULT GETUTCDATE(),

  CONSTRAINT FK_TaskComments_Task 
    FOREIGN KEY (TaskId) REFERENCES dbo.Tasks(Id) ON DELETE CASCADE,

  CONSTRAINT FK_TaskComments_User 
    FOREIGN KEY (UserId) REFERENCES dbo.users(id)
);

-- Indexes for performance (tasks.js queries by TaskId, UserId, CreatedAt)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskComments_TaskId')
CREATE INDEX IX_TaskComments_TaskId ON dbo.TaskComments(TaskId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskComments_UserId')
CREATE INDEX IX_TaskComments_UserId ON dbo.TaskComments(UserId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TaskComments_CreatedAt')
CREATE INDEX IX_TaskComments_CreatedAt ON dbo.TaskComments(CreatedAt);

PRINT '✅ TaskComments table created/verified successfully';

