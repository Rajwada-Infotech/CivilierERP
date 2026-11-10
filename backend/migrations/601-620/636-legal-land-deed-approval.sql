-- 636: Deed Process approval columns. (Approval is done on the Deed Process page — L1 / L2 with Approve, Reject, Hold;
-- the land's L1Status / L2Status hold the levels.) DeedApprovalNote keeps the last reject / hold reason. Schema only.
IF COL_LENGTH('dbo.LegalLand', 'DeedApprovalStatus') IS NULL
  ALTER TABLE dbo.LegalLand ADD DeedApprovalStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalLand_DeedApprovalStatus DEFAULT N'Draft';
IF COL_LENGTH('dbo.LegalLand', 'DeedApprovalNote') IS NULL
  ALTER TABLE dbo.LegalLand ADD DeedApprovalNote NVARCHAR(1000) NULL;
