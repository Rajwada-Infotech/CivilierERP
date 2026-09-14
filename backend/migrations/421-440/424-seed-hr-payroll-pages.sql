-- Migration 424: Seed PageDefinitions rows for the new HR and Payroll
-- module's dashboard and Employee Master pages, so they show up correctly
-- in the Role/PageDefinitions master UI for granting to non-admin roles.
-- Mirrors migration 420's Partner Master pattern. No RoleRights grant here
-- — there's no existing role that naturally owns HR yet; admin/super_admin/
-- dba already bypass all page-right checks (see usePageRights.ts), and
-- whoever ends up owning this module can be granted access by hand once
-- decided.

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'hr-payroll-dashboard')
  UPDATE dbo.PageDefinitions
    SET Label = N'HR and Payroll Dashboard', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'hr-payroll-dashboard';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'hr-payroll-dashboard', N'HR and Payroll Dashboard', N'HR and Payroll', N'HR and Payroll', N'view', 10, 1, N'migration-424', SYSDATETIME());
GO

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'employee-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Employee Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 20, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'employee-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'employee-master', N'Employee Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 20, 1, N'migration-424', SYSDATETIME());
GO

PRINT '424-seed-hr-payroll-pages applied successfully.';
GO
