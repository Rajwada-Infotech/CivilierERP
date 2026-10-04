-- Migration 532: Civil Work DPR > Work Transfer — move activities from one
-- engineer to another, one at a time or in bulk. Registers the page for RBAC
-- and adds an audit log of every transfer (who, from whom, to whom, when).
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'civilworkdpr-work-transfer', 'Work Transfer', 'Civil Work DPR', 'Civil Work DPR', 'view,edit', 14, 1, 'migration-532', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'civilworkdpr-work-transfer' AND pd.IsActive = 1
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityTransferLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityTransferLog (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentId   INT NOT NULL,
    FromEngineerId INT NOT NULL,
    ToEngineerId   INT NOT NULL,
    Remarks        NVARCHAR(500) NULL,
    TransferredBy  NVARCHAR(200) NULL,
    TransferredAt  DATETIME2(3) NOT NULL CONSTRAINT DF_DependencyActivityTransferLog_At DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_DependencyActivityTransferLog_Assignment
      FOREIGN KEY (AssignmentId) REFERENCES dbo.DependencyActivityAssignment(Id) ON DELETE CASCADE
  );
  CREATE INDEX IX_DependencyActivityTransferLog_Assignment ON dbo.DependencyActivityTransferLog(AssignmentId);
END
GO

PRINT '532-civilworkdpr-work-transfer applied successfully.';
GO
