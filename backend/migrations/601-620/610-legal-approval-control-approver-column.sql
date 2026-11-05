-- 610 · Approval Control could not save: its "UserId" column clashed with the masters engine's own @UserId
-- (the logged-in user). The approver column is ApproverId.
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.LegalApprovalAuthority', N'UserId') IS NOT NULL AND COL_LENGTH(N'dbo.LegalApprovalAuthority', N'ApproverId') IS NULL
  EXEC sp_rename N'dbo.LegalApprovalAuthority.UserId', N'ApproverId', N'COLUMN';
GO
