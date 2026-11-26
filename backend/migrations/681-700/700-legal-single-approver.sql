-- Legal: one Approver instead of L1 / L2. Approval Control rows for "L1 Approver" and "L2 Approver" become
-- "Approver" (one row per user); lands already L1-approved in Deed Process wait for the one approval again.
IF OBJECT_ID('dbo.LegalApprovalAuthority', 'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage')
    ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
  ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage
    CHECK (Stage IN (N'Verifier', N'Approver', N'L1 Approver', N'L2 Approver', N'Legal Reviewer', N'Amendment Approver'));
END
GO
IF OBJECT_ID('dbo.LegalApprovalAuthority', 'U') IS NOT NULL
BEGIN
  -- Drop an L2 row when the same user also has L1 (or already has Approver), then rename the rest.
  DELETE a FROM dbo.LegalApprovalAuthority a
  WHERE a.Stage IN (N'L1 Approver', N'L2 Approver')
    AND EXISTS (SELECT 1 FROM dbo.LegalApprovalAuthority b WHERE b.ApproverId = a.ApproverId AND b.AuthorityId <> a.AuthorityId
                AND (b.Stage = N'Approver' OR (a.Stage = N'L2 Approver' AND b.Stage = N'L1 Approver')));
  UPDATE dbo.LegalApprovalAuthority SET Stage = N'Approver' WHERE Stage IN (N'L1 Approver', N'L2 Approver');
  ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
  ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage
    CHECK (Stage IN (N'Verifier', N'Approver', N'Legal Reviewer', N'Amendment Approver'));
END
GO
IF COL_LENGTH('dbo.LegalLand', 'L1Status') IS NOT NULL
  UPDATE dbo.LegalLand SET L1Status = N'Pending'
  WHERE IsActive = 1 AND WorkflowStatus = N'Deed Process' AND L1Status = N'Approved' AND ISNULL(L2Status, N'Pending') <> N'Approved';
GO
