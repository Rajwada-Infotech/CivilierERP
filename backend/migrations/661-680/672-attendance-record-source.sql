-- Migration 672: Attendance Records show Employee Portal / staff punches.
-- Attendance Records (dbo.AttendanceRecord) is the day-by-day sheet payroll reads; punches (dbo.EmployeeAttendance) used to live
-- only on Team Attendance, so a punched day never appeared there. Each punch now keeps one Attendance Record in step with it
-- (Present, with that day's In and Out time). Source says who owns the row: 'Punch' rows follow the punch (including HR
-- corrections and deletions made on Team Attendance); 'Manual' rows -- everything entered by hand -- are never touched by a punch.

IF COL_LENGTH('dbo.AttendanceRecord', 'Source') IS NULL
  ALTER TABLE dbo.AttendanceRecord ADD Source NVARCHAR(10) NOT NULL CONSTRAINT DF_AttendanceRecord_Source DEFAULT N'Manual';
GO

-- Days already punched but with no Attendance Record yet.
INSERT INTO dbo.AttendanceRecord (EmployeeId, AttendanceDate, Status, CheckIn, CheckOut, Remarks, IsActive, Source)
SELECT a.EmployeeId, a.AttendanceDate, N'Present',
       FORMAT(DATEADD(MINUTE, 330, a.InTime), 'HH:mm'),
       CASE WHEN a.OutTime IS NULL THEN NULL ELSE FORMAT(DATEADD(MINUTE, 330, a.OutTime), 'HH:mm') END,
       N'Employee punch', 1, N'Punch'
FROM dbo.EmployeeAttendance a
WHERE NOT EXISTS (SELECT 1 FROM dbo.AttendanceRecord r WHERE r.EmployeeId = a.EmployeeId AND r.AttendanceDate = a.AttendanceDate);
GO
