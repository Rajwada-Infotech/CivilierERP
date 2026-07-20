IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ApprovalWorkflows' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ApprovalWorkflows (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Module NVARCHAR(100) NOT NULL,
    Levels INT NOT NULL DEFAULT 1,
    Approvers NVARCHAR(500) NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'Active',
    Description NVARCHAR(500) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2 NULL
  );

  CREATE INDEX IX_ApprovalWorkflows_ModuleStatus
    ON dbo.ApprovalWorkflows(Module, Status);
END
