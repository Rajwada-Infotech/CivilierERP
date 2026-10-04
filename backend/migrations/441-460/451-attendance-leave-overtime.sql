-- Migration 451: Attendance / Leave / Overtime (HR and Payroll module) --
-- three simple per-employee transaction masters feeding the Payroll Run
-- (attendance-based proration is a deferred follow-up per the Salary
-- Structure work's scope note -- these tables lay the groundwork for it).

IF OBJECT_ID('dbo.AttendanceRecord', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AttendanceRecord (
    AttendanceId   INT            IDENTITY(1,1) PRIMARY KEY,
    EmployeeId     INT            NOT NULL,
    AttendanceDate DATE           NOT NULL,
    Status         NVARCHAR(20)   NOT NULL,
    CheckIn        NVARCHAR(10)   NULL,
    CheckOut       NVARCHAR(10)   NULL,
    Remarks        NVARCHAR(500)  NULL,
    IsActive       BIT            NOT NULL CONSTRAINT DF_AttendanceRecord_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_AttendanceRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,

    CONSTRAINT CK_AttendanceRecord_Status CHECK (Status IN (N'Present', N'Absent', N'Half Day', N'On Leave', N'Holiday', N'Week Off')),
    CONSTRAINT UQ_AttendanceRecord_EmployeeDate UNIQUE (EmployeeId, AttendanceDate),
    CONSTRAINT FK_AttendanceRecord_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT FK_AttendanceRecord_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_AttendanceRecord_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_AttendanceRecord_EmployeeId ON dbo.AttendanceRecord(EmployeeId);
END
GO

IF OBJECT_ID('dbo.LeaveRecord', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LeaveRecord (
    LeaveId     INT            IDENTITY(1,1) PRIMARY KEY,
    EmployeeId  INT            NOT NULL,
    LeaveType   NVARCHAR(20)   NOT NULL,
    FromDate    DATE           NOT NULL,
    ToDate      DATE           NOT NULL,
    TotalDays   INT            NOT NULL,
    Reason      NVARCHAR(500)  NULL,
    Status      NVARCHAR(20)   NOT NULL CONSTRAINT DF_LeaveRecord_Status DEFAULT N'Pending',
    IsActive    BIT            NOT NULL CONSTRAINT DF_LeaveRecord_IsActive DEFAULT 1,
    CreatedBy   INT            NULL,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_LeaveRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy   INT            NULL,
    UpdatedAt   DATETIME2      NULL,

    CONSTRAINT CK_LeaveRecord_Type CHECK (LeaveType IN (N'Casual', N'Sick', N'Earned', N'Unpaid')),
    CONSTRAINT CK_LeaveRecord_Status CHECK (Status IN (N'Pending', N'Approved', N'Rejected')),
    CONSTRAINT CK_LeaveRecord_DateOrder CHECK (ToDate >= FromDate),
    CONSTRAINT FK_LeaveRecord_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT FK_LeaveRecord_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LeaveRecord_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_LeaveRecord_EmployeeId ON dbo.LeaveRecord(EmployeeId);
END
GO

IF OBJECT_ID('dbo.OvertimeRecord', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OvertimeRecord (
    OvertimeId     INT            IDENTITY(1,1) PRIMARY KEY,
    EmployeeId     INT            NOT NULL,
    OvertimeDate   DATE           NOT NULL,
    Hours          DECIMAL(5,2)   NOT NULL,
    RateMultiplier DECIMAL(4,2)   NOT NULL CONSTRAINT DF_OvertimeRecord_Rate DEFAULT 1.5,
    Remarks        NVARCHAR(500)  NULL,
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT DF_OvertimeRecord_Status DEFAULT N'Pending',
    IsActive       BIT            NOT NULL CONSTRAINT DF_OvertimeRecord_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_OvertimeRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,

    CONSTRAINT CK_OvertimeRecord_Status CHECK (Status IN (N'Pending', N'Approved', N'Rejected')),
    CONSTRAINT FK_OvertimeRecord_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT FK_OvertimeRecord_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_OvertimeRecord_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_OvertimeRecord_EmployeeId ON dbo.OvertimeRecord(EmployeeId);
END
GO

-- Setup item under the HR and Payroll module (single page, three tabs).
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'attendance-leave-overtime')
  UPDATE dbo.PageDefinitions
    SET Label = N'Attendance / Leave / Overtime', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'attendance-leave-overtime';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'attendance-leave-overtime', N'Attendance / Leave / Overtime', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete,print,export', 20, 1, N'migration-451', SYSDATETIME());
GO

PRINT '451-attendance-leave-overtime applied successfully.';
GO
