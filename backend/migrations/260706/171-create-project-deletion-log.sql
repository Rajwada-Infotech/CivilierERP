-- Forensic record for the new super-admin-only "delete project + everything
-- under it" feature. The deletion itself is irreversible (no down script for
-- the underlying data), so this table is the only trace left of what a
-- project contained and who removed it.
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ProjectDeletionLog'
)
BEGIN
  CREATE TABLE dbo.ProjectDeletionLog (
    LogId       INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT NOT NULL,
    ProjectName NVARCHAR(255) NOT NULL,
    CompanyId   INT NULL,
    DeletedBy   NVARCHAR(255) NOT NULL,
    DeletedAt   DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    SummaryJson NVARCHAR(MAX) NULL
  );
  PRINT 'Created dbo.ProjectDeletionLog.';
END
ELSE
BEGIN
  PRINT 'dbo.ProjectDeletionLog already exists.';
END
