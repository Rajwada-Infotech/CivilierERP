-- Create missing TaskComments table (safe idempotent version)
-- Matches tasks.js schema expectations exactly

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

