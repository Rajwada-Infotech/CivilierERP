-- Migration 673: break reasons, allowed time and extra-time tracking on Employee Attendance.
-- An employee can now start a break for a reason -- a Break, a Meeting at another office, or Other (with a note). Each type
-- says whether its time is taken off working time (a meeting at another office is official work, so it is not) and how many
-- minutes are allowed; time beyond that is "extra time". The allowance and the deduct flag are copied onto the break when it
-- starts, so changing a rule later never rewrites past days. Durations are still derived from the timestamps.
--
--   AttendanceBreakType        the rules HR edits (Employee Portal > Break rules)
--   EmployeeAttendanceBreak    + BreakType, BreakNote, AllowedMinutes, DeductFromWork

IF OBJECT_ID('dbo.AttendanceBreakType', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AttendanceBreakType (
    BreakType      NVARCHAR(40)  NOT NULL PRIMARY KEY,
    DeductFromWork BIT           NOT NULL,
    AllowedMinutes INT           NULL,        -- NULL = no limit
    RequiresNote   BIT           NOT NULL,
    IsActive       BIT           NOT NULL CONSTRAINT DF_AttendanceBreakType_IsActive DEFAULT 1,
    SortOrder      INT           NOT NULL,
    UpdatedBy      INT           NULL,
    UpdatedAt      DATETIME2(0)  NULL,
    CONSTRAINT CK_AttendanceBreakType_Minutes CHECK (AllowedMinutes IS NULL OR (AllowedMinutes >= 0 AND AllowedMinutes <= 1440))
  );
  INSERT INTO dbo.AttendanceBreakType (BreakType, DeductFromWork, AllowedMinutes, RequiresNote, SortOrder) VALUES
    (N'Break',                   1, 30,   0, 1),
    (N'Meeting at other office', 0, NULL, 0, 2),
    (N'Other reason',            1, 30,   1, 3);
END
GO

IF COL_LENGTH('dbo.EmployeeAttendanceBreak', 'BreakType') IS NULL
BEGIN
  ALTER TABLE dbo.EmployeeAttendanceBreak ADD
    BreakType      NVARCHAR(40)  NOT NULL CONSTRAINT DF_EmployeeAttendanceBreak_Type DEFAULT N'Break',
    BreakNote      NVARCHAR(300) NULL,
    AllowedMinutes INT           NULL,
    DeductFromWork BIT           NOT NULL CONSTRAINT DF_EmployeeAttendanceBreak_Deduct DEFAULT 1;
END
GO
