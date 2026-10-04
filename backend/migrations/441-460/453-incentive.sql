-- Migration 453: Incentive (HR and Payroll module) -- tracks discretionary
-- incentive/bonus payments per employee (performance, sales, festival,
-- referral, etc.), same standalone-record pattern as Attendance/Leave/
-- Overtime -- not wired into the Salary Structure formula engine, since
-- these are one-off/discretionary payments rather than a recurring
-- structural salary component.

IF OBJECT_ID('dbo.IncentiveRecord', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.IncentiveRecord (
    IncentiveId    INT            IDENTITY(1,1) PRIMARY KEY,
    EmployeeId     INT            NOT NULL,
    IncentiveType  NVARCHAR(20)   NOT NULL,
    IncentiveDate  DATE           NOT NULL,
    Amount         DECIMAL(18,2)  NOT NULL,
    Remarks        NVARCHAR(500)  NULL,
    Status         NVARCHAR(20)   NOT NULL CONSTRAINT DF_IncentiveRecord_Status DEFAULT N'Pending',
    IsActive       BIT            NOT NULL CONSTRAINT DF_IncentiveRecord_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_IncentiveRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,

    CONSTRAINT CK_IncentiveRecord_Type CHECK (IncentiveType IN (N'Performance', N'Sales', N'Festival', N'Referral', N'Retention', N'Other')),
    CONSTRAINT CK_IncentiveRecord_Status CHECK (Status IN (N'Pending', N'Approved', N'Rejected', N'Paid')),
    CONSTRAINT FK_IncentiveRecord_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT FK_IncentiveRecord_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_IncentiveRecord_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_IncentiveRecord_EmployeeId ON dbo.IncentiveRecord(EmployeeId);
END
GO

-- Setup item under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'incentive')
  UPDATE dbo.PageDefinitions
    SET Label = N'Incentive', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 25, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'incentive';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'incentive', N'Incentive', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete,print,export', 25, 1, N'migration-453', SYSDATETIME());
GO

PRINT '453-incentive applied successfully.';
GO
