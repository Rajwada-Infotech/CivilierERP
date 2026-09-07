-- Migration 358: DepartmentId on dbo.users — lets Fixed Asset Record auto-fill
-- the "Department" field from the selected Custodian / Assigned To user.

IF COL_LENGTH('dbo.users', 'DepartmentId') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD DepartmentId INT NULL
    CONSTRAINT FK_users_DepartmentId REFERENCES dbo.DepartmentMaster(Id);
END
GO
