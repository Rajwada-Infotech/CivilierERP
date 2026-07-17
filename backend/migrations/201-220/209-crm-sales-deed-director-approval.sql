-- Third approval gate on the Sales Deed: after the deed is Executed and the
-- customer has approved it, a Director-level sign-off is now required
-- before Handover can proceed — matching the spec's
-- "SALES DEED -> APPROVAL FROM BOTH SIDES -> DIRECTOR APPROVAL ->
-- SALES DEED COMPLETE -> KEY HANDOVER" chain. No dedicated "director" role
-- exists in this system yet, so — same pattern as Senior Approval and the
-- Agreement Date gate — this is hardcoded to super_admin only for now,
-- reassignable later via Approval Setup with zero code change.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DirectorApprovalStatus')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD DirectorApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmSalesDeed_DirectorApprovalStatus DEFAULT 'NotRequired';
  PRINT 'Added CrmSalesDeed.DirectorApprovalStatus';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'DirectorApprovedBy')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD DirectorApprovedBy INT NULL;
  ALTER TABLE dbo.CrmSalesDeed ADD DirectorApprovedAt DATETIME2(3) NULL;
  ALTER TABLE dbo.CrmSalesDeed ADD DirectorApprovalRemarks NVARCHAR(MAX) NULL;
  PRINT 'Added CrmSalesDeed director-approval audit columns';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE '%"crm-sales-deed-director"%')
BEGIN
  INSERT INTO dbo.ApprovalWorkflows
    (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
  VALUES
    (
      N'CRM Sales Deed Director Approval',
      N'CrmSalesDeedDirector',
      1,
      NULL,
      N'Active',
      N'Single-level sign-off gate on CrmSalesDeed.DirectorApprovalStatus, required after the customer approves the executed deed and before Handover can be scheduled. Currently restricted to super_admin only — reconfigure levels/roles anytime via Admin > Approval > Approval Setup.',
      N'migration-184',
      SYSDATETIME(),
      N'sequential',
      N'["crm-sales-deed-director"]',
      1,
      N'[]',
      N'[{"id":1,"label":"Sales Deed Director Approval","roles":["super_admin"]}]'
    );
  PRINT 'Seeded CRM Sales Deed Director Approval workflow';
END
ELSE
BEGIN
  PRINT 'A workflow already targets crm-sales-deed-director — skipped seeding to avoid duplicates';
END
GO
