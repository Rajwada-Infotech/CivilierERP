-- Migration 564: history of an ownership change (migration 562) — who did
-- what and when: entered, details changed, deed copy attached, the new
-- owner's application opened (co-owners are added there), sent for
-- approval, sent back, approved, cancelled.
IF OBJECT_ID('dbo.CrmOwnershipChangeLog', 'U') IS NULL
CREATE TABLE dbo.CrmOwnershipChangeLog (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  ChangeId INT NOT NULL,
  Action NVARCHAR(100) NOT NULL,
  Remarks NVARCHAR(1000) NULL,
  UserId INT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CrmOwnershipChangeLog_Created DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmOwnershipChangeLog_Change' AND object_id = OBJECT_ID('dbo.CrmOwnershipChangeLog'))
  CREATE INDEX IX_CrmOwnershipChangeLog_Change ON dbo.CrmOwnershipChangeLog (ChangeId, CreatedAt);
GO
