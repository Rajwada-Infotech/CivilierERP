-- Undo 717: legal review table and the Deed Process stage columns. Deletes all review versions.
EXEC sp_set_session_context N'legal_reset', 1;
GO
DROP TRIGGER IF EXISTS dbo.TR_LegalVerificationReview_NoChange;
DROP TABLE IF EXISTS dbo.LegalVerificationReview;
IF COL_LENGTH('dbo.LegalLand', 'DeedStage') IS NOT NULL ALTER TABLE dbo.LegalLand DROP COLUMN DeedStage, DeedDrafterId;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerification_Status') ALTER TABLE dbo.LegalVerification DROP CONSTRAINT CK_LegalVerification_Status;
UPDATE dbo.LegalVerification SET Status = N'In Progress' WHERE Status IN (N'Verified', N'Returned', N'Rejected');
ALTER TABLE dbo.LegalVerification ADD CONSTRAINT CK_LegalVerification_Status CHECK (Status IN (N'In Progress', N'Ready for Review', N'On Hold', N'Closed'));
GO
EXEC sp_set_session_context N'legal_reset', 0;
GO
