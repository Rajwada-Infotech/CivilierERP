-- Migration 543: Employee Attendance (clock In / Out / Break) for the HR and Payroll module.
--
-- An employee records their own attendance with buttons; every timestamp is taken from the
-- database clock (UTC, SYSUTCDATETIME()) — never from the client — so it can't be typed or
-- back-dated. AttendanceDate is the Indian calendar date (UTC+5:30) of the In Time, so a night
-- shift that crosses midnight still belongs to the day it started on.
--
--   EmployeeAttendance       one row per employee per day (unique) — In Time, Out Time, project
--   EmployeeAttendanceBreak  any number of breaks per day; at most ONE open (un-stopped) break
--   EmployeeAttendanceAudit  every action and every HR correction (who, when, old -> new, reason)
--
-- Durations are not stored — they are always derived from the timestamps, so a correction can
-- never leave a stale total behind.

IF OBJECT_ID('dbo.EmployeeAttendance', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeeAttendance (
    AttendanceId   INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeId     INT           NOT NULL,
    AttendanceDate DATE          NOT NULL,
    InTime         DATETIME2(0)  NOT NULL,           -- UTC
    OutTime        DATETIME2(0)  NULL,               -- UTC
    ProjectId      INT           NULL,               -- optional project worked on
    IsHrEdited     BIT           NOT NULL DEFAULT 0,
    CreatedAt      DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt      DATETIME2(0)  NULL,
    CONSTRAINT FK_EmployeeAttendance_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT UQ_EmployeeAttendance_EmployeeDate UNIQUE (EmployeeId, AttendanceDate),
    CONSTRAINT CK_EmployeeAttendance_OutAfterIn CHECK (OutTime IS NULL OR OutTime > InTime)
  );
  CREATE INDEX IX_EmployeeAttendance_Date ON dbo.EmployeeAttendance (AttendanceDate, EmployeeId);
  PRINT 'Migration 543: created EmployeeAttendance.';
END
GO

IF OBJECT_ID('dbo.EmployeeAttendanceBreak', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeeAttendanceBreak (
    BreakId      INT IDENTITY(1,1) PRIMARY KEY,
    AttendanceId INT          NOT NULL,
    BreakStart   DATETIME2(0) NOT NULL,              -- UTC
    BreakEnd     DATETIME2(0) NULL,                  -- UTC; NULL while the break is running
    IsHrEdited   BIT          NOT NULL DEFAULT 0,
    CreatedAt    DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_EmployeeAttendanceBreak_Attendance FOREIGN KEY (AttendanceId) REFERENCES dbo.EmployeeAttendance(AttendanceId) ON DELETE CASCADE,
    CONSTRAINT CK_EmployeeAttendanceBreak_EndAfterStart CHECK (BreakEnd IS NULL OR BreakEnd > BreakStart)
  );
  CREATE INDEX IX_EmployeeAttendanceBreak_Attendance ON dbo.EmployeeAttendanceBreak (AttendanceId, BreakStart);
  -- A new break can't start while the previous one is still running — enforced by the database too.
  CREATE UNIQUE INDEX UX_EmployeeAttendanceBreak_OneOpen ON dbo.EmployeeAttendanceBreak (AttendanceId) WHERE BreakEnd IS NULL;
  PRINT 'Migration 543: created EmployeeAttendanceBreak.';
END
GO

IF OBJECT_ID('dbo.EmployeeAttendanceAudit', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeeAttendanceAudit (
    AuditId      INT IDENTITY(1,1) PRIMARY KEY,
    AttendanceId INT           NULL,                 -- no FK: the trail outlives a deleted record
    EmployeeId   INT           NOT NULL,
    Action       NVARCHAR(30)  NOT NULL,             -- IN | OUT | BREAK_START | BREAK_STOP | HR_EDIT | HR_BREAK_ADD | HR_BREAK_EDIT | HR_BREAK_DELETE
    Detail       NVARCHAR(MAX) NULL,                 -- e.g. "InTime: 09:00 -> 09:10"
    Reason       NVARCHAR(500) NULL,                 -- mandatory for HR corrections
    ChangedBy    NVARCHAR(150) NOT NULL,
    ChangedAt    DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_EmployeeAttendanceAudit_Attendance ON dbo.EmployeeAttendanceAudit (AttendanceId, ChangedAt);
  PRINT 'Migration 543: created EmployeeAttendanceAudit.';
END
GO

-- Menu entries for Menu Rights.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'employee-attendance' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'employee-attendance', N'Attendance', N'HR and Payroll', N'HR and Payroll', N'view,create', 21, 1, N'migration-543', SYSDATETIME());
GO
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'hr-attendance-management' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'hr-attendance-management', N'HR Attendance Management', N'HR and Payroll', N'HR and Payroll', N'view,edit,export', 22, 1, N'migration-543', SYSDATETIME());
GO
