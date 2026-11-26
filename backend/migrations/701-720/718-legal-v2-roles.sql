-- Legal V2 phase 5: two more roles in Approval Control.
--   Legal Admin       manages the verification setup (activities, dependencies, reminder days) and may override
--                     an activity dependency.
--   Search Executive  updates the search activities (Department = Search) and their entries without the edit right
--                     on the whole enquiry page.
-- Management (read-only) needs no role: it is the view right on the Legal pages.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage')
  ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
GO
ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage
  CHECK (Stage IN (N'Verifier', N'Approver', N'L1 Approver', N'L2 Approver', N'Legal Reviewer', N'Amendment Approver', N'Legal Admin', N'Search Executive'));
GO
