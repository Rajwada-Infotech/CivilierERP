-- Migration 670: Employee Portal.
-- Employees sign in on the login page's "Employee Portal" and see their own salary, payslips, login history, attendance,
-- leave and the holiday list, and apply for leave. HR enables / disables each employee's access (Employee Portal Access).
--
--   Role 'Employee Portal'       the role an employee-portal login holds (the portal API is limited to it). Not 'employee':
--                                that name is an alias of the ordinary staff role (middleware/role.js), which has app access.
--   UserLoginHistory             every sign-in attempt (who, when, from where, which login page, success or not)
--   LeavePolicy                  the company-wide yearly days per leave type (Casual / Sick / Earned; Unpaid has no limit)
--   EmployeeLeaveEntitlement     a per-employee, per-year override of that policy
--   LeaveRecord.HrRemarks        why HR approved / rejected an application (shown to the employee)
--   PageDefinitions              'employee-portal-access' -- the HR screen that manages all of the above

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = N'employee portal')
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
  VALUES (N'Employee Portal', N'EMPP', N'Employee Portal login (own payslips, attendance, leave)', N'migration-670');
GO

IF OBJECT_ID('dbo.UserLoginHistory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.UserLoginHistory (
    LoginHistoryId BIGINT IDENTITY(1,1) PRIMARY KEY,
    UserId         INT            NULL,
    Email          NVARCHAR(150)  NULL,
    Portal         NVARCHAR(20)   NULL,
    Success        BIT            NOT NULL,
    FailureReason  NVARCHAR(200)  NULL,
    IpAddress      NVARCHAR(64)   NULL,
    UserAgent      NVARCHAR(300)  NULL,
    LoginAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_UserLoginHistory_LoginAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_UserLoginHistory_User ON dbo.UserLoginHistory (UserId, LoginAt DESC);
END
GO

IF OBJECT_ID('dbo.LeavePolicy', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LeavePolicy (
    LeaveType   NVARCHAR(20)  NOT NULL PRIMARY KEY,
    DaysPerYear DECIMAL(5,1)  NOT NULL,
    UpdatedBy   INT           NULL,
    UpdatedAt   DATETIME2(0)  NULL,
    CONSTRAINT CK_LeavePolicy_Type CHECK (LeaveType IN (N'Casual', N'Sick', N'Earned')),
    CONSTRAINT CK_LeavePolicy_Days CHECK (DaysPerYear >= 0 AND DaysPerYear <= 366)
  );
  INSERT INTO dbo.LeavePolicy (LeaveType, DaysPerYear) VALUES (N'Casual', 12), (N'Sick', 12), (N'Earned', 15);
END
GO

IF OBJECT_ID('dbo.EmployeeLeaveEntitlement', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.EmployeeLeaveEntitlement (
    EntitlementId INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeId    INT           NOT NULL,
    LeaveYear     INT           NOT NULL,
    LeaveType     NVARCHAR(20)  NOT NULL,
    Days          DECIMAL(5,1)  NOT NULL,
    UpdatedBy     INT           NULL,
    UpdatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_EmployeeLeaveEntitlement_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_EmployeeLeaveEntitlement UNIQUE (EmployeeId, LeaveYear, LeaveType),
    CONSTRAINT CK_EmployeeLeaveEntitlement_Type CHECK (LeaveType IN (N'Casual', N'Sick', N'Earned')),
    CONSTRAINT CK_EmployeeLeaveEntitlement_Days CHECK (Days >= 0 AND Days <= 366),
    CONSTRAINT FK_EmployeeLeaveEntitlement_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId)
  );
END
GO

IF COL_LENGTH('dbo.LeaveRecord', 'HrRemarks') IS NULL
  ALTER TABLE dbo.LeaveRecord ADD HrRemarks NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'employee-portal-access' AND IsActive = 1)
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'employee-portal-access', N'Employee Portal Access', N'HR and Payroll', N'HR and Payroll', N'view,create,edit', 23, 1, N'migration-670', SYSDATETIME());
GO
