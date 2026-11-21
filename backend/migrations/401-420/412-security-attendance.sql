-- ============================================================
-- Migration 412: Maintenance — Security Attendance.
--
-- Tracks check-in/check-out for security personnel per shift per day,
-- with Present/Late/Absent/Half Day derived from comparing the actual
-- check-in time against the assigned shift's scheduled start (plus a
-- grace window), a separate supervisor verification workflow, and an
-- immutable audit log of every action (same append-only pattern this
-- app already uses for amendments/approvals — rows are never edited or
-- deleted, only appended).
--
-- dbo.SecurityPersonnel / dbo.SecurityShift are the two small masters
-- the spec's field list needs (Security ID + Name, Shift) that its own
-- "Recommended Database Structure" section didn't spell out explicitly
-- (it only detailed the attendance + log tables) — kept minimal
-- on purpose, this module doesn't need Charge-Head-Master-level
-- complexity.
--
-- "Absent" is not itself a row a user creates by hand for every
-- no-show — the dashboard/report derive it live (personnel with no
-- attendance row at all for the day). A supervisor can still
-- explicitly record one via POST /security-attendance/mark-absent for
-- a documented no-show (leave, unexplained absence, etc.), which is
-- why Status allows 'Absent' as a stored value too.
--
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SecurityShift' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SecurityShift (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(100)   NOT NULL,
    StartTime     TIME            NOT NULL,
    EndTime       TIME            NOT NULL,
    -- Minutes after StartTime a check-in is still counted as "Present"
    -- rather than "Late".
    GraceMinutes  INT             NOT NULL DEFAULT 10,
    Status        NVARCHAR(20)    NOT NULL DEFAULT 'Active',
    CreatedBy     NVARCHAR(150)   NULL,
    CreatedAt     DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy     NVARCHAR(150)   NULL,
    UpdatedAt     DATETIME2       NULL
  );
  PRINT 'Created dbo.SecurityShift';
END
ELSE
  PRINT 'dbo.SecurityShift already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SecurityPersonnel' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SecurityPersonnel (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    SecurityCode    NVARCHAR(30)    NOT NULL UNIQUE,
    Name            NVARCHAR(150)   NOT NULL,
    Phone           NVARCHAR(20)    NULL,
    -- Which shift this person is normally rostered on — the Check-In
    -- flow uses this to resolve the scheduled time to compare against,
    -- per spec Section 3 ("System identifies their assigned shift").
    DefaultShiftId  INT             NULL REFERENCES dbo.SecurityShift(Id),
    Status          NVARCHAR(20)    NOT NULL DEFAULT 'Active',
    Remarks         NVARCHAR(500)   NULL,
    CreatedBy       NVARCHAR(150)   NULL,
    CreatedAt       DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       NVARCHAR(150)   NULL,
    UpdatedAt       DATETIME2       NULL
  );
  PRINT 'Created dbo.SecurityPersonnel';
END
ELSE
  PRINT 'dbo.SecurityPersonnel already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SecurityAttendance' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SecurityAttendance (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    SecurityId          INT             NOT NULL REFERENCES dbo.SecurityPersonnel(Id),
    ShiftId             INT             NOT NULL REFERENCES dbo.SecurityShift(Id),
    AttendanceDate      DATE            NOT NULL,
    ScheduledIn         TIME            NOT NULL,
    ScheduledOut        TIME            NOT NULL,
    -- Full timestamp (not just a time) — CheckIn/CheckOut are set once,
    -- at the moment the action happens, and are never editable
    -- afterward (spec Section 3: "should not be able to manually
    -- change the actual check-in timestamp after submission").
    CheckIn             DATETIME2       NULL,
    CheckOut            DATETIME2       NULL,
    Status              NVARCHAR(20)    NOT NULL DEFAULT 'Present',
    VerificationStatus  NVARCHAR(20)    NOT NULL DEFAULT 'Pending',
    VerifiedBy          NVARCHAR(150)   NULL,
    VerifiedAt          DATETIME2       NULL,
    VerificationRemarks NVARCHAR(500)   NULL,
    Remarks             NVARCHAR(500)   NULL,
    IsCancelled         BIT             NOT NULL DEFAULT 0,
    CreatedBy           NVARCHAR(150)   NULL,
    CreatedAt           DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy           NVARCHAR(150)   NULL,
    UpdatedAt           DATETIME2       NULL,
    CONSTRAINT UQ_SecurityAttendance_Person_Shift_Date UNIQUE (SecurityId, ShiftId, AttendanceDate)
  );
  PRINT 'Created dbo.SecurityAttendance';
END
ELSE
  PRINT 'dbo.SecurityAttendance already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SecurityAttendanceLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.SecurityAttendanceLog (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    AttendanceId  INT             NOT NULL REFERENCES dbo.SecurityAttendance(Id),
    SecurityId    INT             NOT NULL REFERENCES dbo.SecurityPersonnel(Id),
    Action        NVARCHAR(30)    NOT NULL,
    OldValue      NVARCHAR(MAX)   NULL,
    NewValue      NVARCHAR(MAX)   NULL,
    PerformedBy   NVARCHAR(150)   NULL,
    PerformedAt   DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
    DeviceInfo    NVARCHAR(300)   NULL,
    IPAddress     NVARCHAR(50)    NULL,
    Remarks       NVARCHAR(500)   NULL
  );
  PRINT 'Created dbo.SecurityAttendanceLog';
END
ELSE
  PRINT 'dbo.SecurityAttendanceLog already exists';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-security-attendance' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-security-attendance', 'Security Attendance', 'Maintenance', 'Maintenance', 'view,create,edit,delete,print,export', 245, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-security-attendance';
END
ELSE
  PRINT 'PageDefinitions maintenance-security-attendance already exists';
GO

-- Seed two common shifts so the page isn't empty on first use — Status
-- and everything else stays fully admin-editable afterward.
IF NOT EXISTS (SELECT 1 FROM dbo.SecurityShift WHERE Name = 'Morning Shift')
BEGIN
  INSERT INTO dbo.SecurityShift (Name, StartTime, EndTime, GraceMinutes, CreatedBy)
  VALUES ('Morning Shift', '08:00:00', '20:00:00', 10, 'migration');
  PRINT 'Seeded SecurityShift: Morning Shift';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.SecurityShift WHERE Name = 'Night Shift')
BEGIN
  INSERT INTO dbo.SecurityShift (Name, StartTime, EndTime, GraceMinutes, CreatedBy)
  VALUES ('Night Shift', '20:00:00', '08:00:00', 10, 'migration');
  PRINT 'Seeded SecurityShift: Night Shift';
END
GO

PRINT '412-security-attendance applied successfully.';
GO
