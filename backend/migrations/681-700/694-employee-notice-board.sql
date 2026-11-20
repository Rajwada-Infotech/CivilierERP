-- 694: Employee Notice Board. Schema + page right only; safe to re-run.
--  • HR writes a notice for All employees or for chosen departments (Department Master).
--  • Employees see the notices meant for their department in the Employee Portal (web + app), between PublishFrom
--    and ExpiresOn. EmployeeNoticeRead records who has read each notice (HR sees the count).
IF OBJECT_ID('dbo.EmployeeNotice', 'U') IS NULL
CREATE TABLE dbo.EmployeeNotice (
  NoticeId     INT IDENTITY(1,1) CONSTRAINT PK_EmployeeNotice PRIMARY KEY,
  Title        NVARCHAR(200) NOT NULL,
  Body         NVARCHAR(4000) NOT NULL,
  Audience     NVARCHAR(20) NOT NULL CONSTRAINT DF_EmployeeNotice_Audience DEFAULT N'All',
  Priority     NVARCHAR(20) NOT NULL CONSTRAINT DF_EmployeeNotice_Priority DEFAULT N'Normal',
  IsPinned     BIT NOT NULL CONSTRAINT DF_EmployeeNotice_IsPinned DEFAULT 0,
  PublishFrom  DATE NOT NULL,
  ExpiresOn    DATE NULL,
  IsActive     BIT NOT NULL CONSTRAINT DF_EmployeeNotice_IsActive DEFAULT 1,
  CreatedBy    INT NULL CONSTRAINT FK_EmployeeNotice_CreatedBy REFERENCES dbo.users (id),
  CreatedAt    DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeNotice_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy    INT NULL CONSTRAINT FK_EmployeeNotice_UpdatedBy REFERENCES dbo.users (id),
  UpdatedAt    DATETIME2(0) NULL,
  CONSTRAINT CK_EmployeeNotice_Audience CHECK (Audience IN (N'All', N'Departments')),
  CONSTRAINT CK_EmployeeNotice_Priority CHECK (Priority IN (N'Normal', N'Important')),
  CONSTRAINT CK_EmployeeNotice_Dates CHECK (ExpiresOn IS NULL OR ExpiresOn >= PublishFrom)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmployeeNotice_Active')
  CREATE INDEX IX_EmployeeNotice_Active ON dbo.EmployeeNotice (IsActive, PublishFrom, ExpiresOn);
GO
IF OBJECT_ID('dbo.EmployeeNoticeDepartment', 'U') IS NULL
CREATE TABLE dbo.EmployeeNoticeDepartment (
  NoticeId     INT NOT NULL CONSTRAINT FK_EmployeeNoticeDepartment_Notice REFERENCES dbo.EmployeeNotice (NoticeId) ON DELETE CASCADE,
  DepartmentId INT NOT NULL CONSTRAINT FK_EmployeeNoticeDepartment_Department REFERENCES dbo.DepartmentMaster (Id),
  CONSTRAINT PK_EmployeeNoticeDepartment PRIMARY KEY (NoticeId, DepartmentId)
);
GO
IF OBJECT_ID('dbo.EmployeeNoticeRead', 'U') IS NULL
CREATE TABLE dbo.EmployeeNoticeRead (
  NoticeId   INT NOT NULL CONSTRAINT FK_EmployeeNoticeRead_Notice REFERENCES dbo.EmployeeNotice (NoticeId) ON DELETE CASCADE,
  EmployeeId INT NOT NULL CONSTRAINT FK_EmployeeNoticeRead_Employee REFERENCES dbo.EmployeeMaster (EmployeeId) ON DELETE CASCADE,
  ReadAt     DATETIME2(0) NOT NULL CONSTRAINT DF_EmployeeNoticeRead_ReadAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_EmployeeNoticeRead PRIMARY KEY (NoticeId, EmployeeId)
);
GO
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'employee-notice')
  UPDATE dbo.PageDefinitions SET Label = N'Notice Board', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
    Actions = N'view,create,edit,delete', SortOrder = 24, IsActive = 1, UpdatedAt = SYSDATETIME() WHERE PageKey = N'employee-notice';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'employee-notice', N'Notice Board', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete', 24, 1, N'migration-694', SYSDATETIME());
GO
PRINT '694-employee-notice-board applied successfully.';
GO
