-- Migration 474: Audit Trail for Account Group Master (the ledger group
-- tree — Assets/Expenses/Liabilities/Revenue) — a generic dbo.AuditTrail
-- table (EntityType/EntityId so it can be reused by other masters later)
-- recording who created, edited, or deleted a group, with what changed and
-- when. Wired into backend/routes/accountGroup.js's create/update/delete
-- handlers via backend/services/auditTrail.js; read by
-- backend/routes/auditTrail.js and src/pages/masters/AccountGroupAuditTrail.tsx.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AuditTrail' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.AuditTrail (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    EntityType NVARCHAR(50) NOT NULL,
    EntityId INT NOT NULL,
    EntityName NVARCHAR(200) NULL,
    Action NVARCHAR(10) NOT NULL,
    UserId INT NOT NULL,
    UserName NVARCHAR(200) NULL,
    Details NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AuditTrail_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_AuditTrail_Entity ON dbo.AuditTrail(EntityType, EntityId);
  CREATE INDEX IX_AuditTrail_CreatedAt ON dbo.AuditTrail(CreatedAt DESC);
  PRINT 'Created dbo.AuditTrail';
END
ELSE
  PRINT 'dbo.AuditTrail already exists — skipping create';
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'account-group-audit-trail', 'Audit Trail', 'Finance', 'Finance', 'view', 95, 1, 'migration-474', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'account-group-audit-trail' AND pd.IsActive = 1
);
GO

PRINT '474-account-group-audit-trail applied successfully.';
GO
