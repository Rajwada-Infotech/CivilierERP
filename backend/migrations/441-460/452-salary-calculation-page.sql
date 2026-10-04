-- Migration 452: "Salary Calculation" page registration (HR and Payroll
-- module) -- a standalone version of Employee Master's "View Salary
-- Breakup" action, letting a user calculate any employee's salary
-- breakup without opening their row first. Read-only in practice, but
-- registered with the full action set like every other page here.

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'salary-calculation')
  UPDATE dbo.PageDefinitions
    SET Label = N'Salary Calculation', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 15, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'salary-calculation';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'salary-calculation', N'Salary Calculation', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete,print,export', 15, 1, N'migration-452', SYSDATETIME());
GO

PRINT '452-salary-calculation-page applied successfully.';
GO
