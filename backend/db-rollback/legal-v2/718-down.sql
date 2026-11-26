-- Undo 718: drop the Legal Admin / Search Executive roles from Approval Control.
DELETE FROM dbo.LegalApprovalAuthority WHERE Stage IN (N'Legal Admin', N'Search Executive');
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage') ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage CHECK (Stage IN (N'Verifier', N'Approver', N'Legal Reviewer', N'Amendment Approver'));
GO
