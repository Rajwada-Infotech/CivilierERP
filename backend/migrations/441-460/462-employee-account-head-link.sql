-- Migration 462: every Employee Master record gets a linked Account Head
-- Master row (LHeadType = 'E'), so payroll can post to / pay each employee
-- through the normal ledger machinery.
--
-- EmployeeMaster.AccountHeadId points at the head; the FK means a head that
-- an employee still uses can never be deleted out from under it, and the
-- filtered unique index means one head serves exactly one employee. The
-- application creates/syncs/removes the head together with the employee
-- (services/employeeAccountHead.js).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.EmployeeMaster') AND name = 'AccountHeadId')
  ALTER TABLE dbo.EmployeeMaster ADD AccountHeadId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_EmployeeMaster_AccountHead')
  ALTER TABLE dbo.EmployeeMaster ADD CONSTRAINT FK_EmployeeMaster_AccountHead
    FOREIGN KEY (AccountHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_EmployeeMaster_AccountHeadId' AND object_id = OBJECT_ID('dbo.EmployeeMaster'))
  CREATE UNIQUE INDEX UQ_EmployeeMaster_AccountHeadId ON dbo.EmployeeMaster(AccountHeadId) WHERE AccountHeadId IS NOT NULL;
GO

-- Backfill: employees that pre-date this migration get their head now.
DECLARE @created TABLE (LHeadId INT, LHeadCode NVARCHAR(40));

INSERT INTO dbo.AccountHeadMaster
  (LHeadName, LHeadCode, LHeadType, LHeadAddress, LHeadContactPerson, LHeadPhone, LHeadEmail,
   LHeadStatus, Status, CreatedBy, CreatedAt, ApprovedBy, ApprovedAt)
OUTPUT INSERTED.LHeadId, INSERTED.LHeadCode INTO @created
SELECT e.EmployeeName, N'EMPAH-' + CAST(e.EmployeeId AS NVARCHAR(20)), 'E',
       ISNULL(NULLIF(LTRIM(RTRIM(e.Address)), N''), N'N/A'), N'N/A', e.Mobile, e.Email,
       e.IsActive, N'Approved', N'system', SYSDATETIME(), N'system', SYSDATETIME()
FROM dbo.EmployeeMaster e
WHERE e.AccountHeadId IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster h WHERE h.LHeadCode = N'EMPAH-' + CAST(e.EmployeeId AS NVARCHAR(20)));

UPDATE e SET e.AccountHeadId = c.LHeadId
FROM dbo.EmployeeMaster e
JOIN @created c ON c.LHeadCode = N'EMPAH-' + CAST(e.EmployeeId AS NVARCHAR(20));
GO

PRINT '462-employee-account-head-link applied successfully.';
GO
