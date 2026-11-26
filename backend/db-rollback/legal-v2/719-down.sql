-- Undo 719 (Legal V2.1). Run after a backup. Verification data of 715–718 is kept.
EXEC sp_set_session_context N'legal_reset', 1;
GO
DROP VIEW IF EXISTS dbo.vw_LegalOwnershipEvent;
DROP TABLE IF EXISTS dbo.LegalApplicationQuery;
DELETE FROM dbo.PageDefinitions WHERE PageKey IN (N'legal-conversion-master', N'legal-application-query-master');
IF OBJECT_ID('dbo.LegalRuleConfig', 'U') IS NOT NULL DELETE FROM dbo.LegalRuleConfig WHERE RuleKey IN (N'conversion_after_mutation', N'final_review_gate');
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalMutation_Kind') DROP INDEX IX_LegalMutation_Kind ON dbo.LegalMutation;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalMutation_Kind') ALTER TABLE dbo.LegalMutation DROP CONSTRAINT CK_LegalMutation_Kind;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_LegalMutation_Kind') ALTER TABLE dbo.LegalMutation DROP CONSTRAINT DF_LegalMutation_Kind;
GO
UPDATE dbo.LegalMutation SET NewOwner = N'-' WHERE NewOwner IS NULL;
ALTER TABLE dbo.LegalMutation ALTER COLUMN NewOwner NVARCHAR(300) NOT NULL;
ALTER TABLE dbo.LegalMutation DROP COLUMN Kind, ApplicantName, AssignedUserId, DueDate, Fee, PaymentRef, PaymentDate, CurrentClass, RequestedClass, InspectionDate, CompletionDate, ReportFileId;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerification_Status') ALTER TABLE dbo.LegalVerification DROP CONSTRAINT CK_LegalVerification_Status;
UPDATE dbo.LegalVerification SET Status = N'Returned' WHERE Status = N'Rejected';
ALTER TABLE dbo.LegalVerification ADD CONSTRAINT CK_LegalVerification_Status CHECK (Status IN (N'In Progress', N'Ready for Review', N'Returned', N'Verified', N'On Hold', N'Closed'));
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationReview_Decision') ALTER TABLE dbo.LegalVerificationReview DROP CONSTRAINT CK_LegalVerificationReview_Decision;
UPDATE dbo.LegalVerificationReview SET Decision = N'Further Investigation Required' WHERE Decision = N'Rejected';
ALTER TABLE dbo.LegalVerificationReview ADD CONSTRAINT CK_LegalVerificationReview_Decision CHECK (Decision IN (N'Verified', N'Returned for Correction', N'Additional Documents Required', N'Further Investigation Required', N'Reopened'));
IF COL_LENGTH('dbo.LegalVerificationReview', 'Risks') IS NOT NULL ALTER TABLE dbo.LegalVerificationReview DROP COLUMN Risks;
GO
DROP TRIGGER IF EXISTS dbo.TR_LegalVerificationException_NoChange;
DROP TABLE IF EXISTS dbo.LegalVerificationException;
DROP TABLE IF EXISTS dbo.LegalActivityComment;
DROP TABLE IF EXISTS dbo.LegalVerificationDocumentLink;
DROP TABLE IF EXISTS dbo.LegalVerificationDocument;
GO
-- Templates: 6B out, 16 back, 6 renamed back.
DELETE d FROM dbo.LegalActivityDependency d JOIN dbo.LegalActivityTemplate t ON t.TemplateId IN (d.TemplateId, d.DependsOnTemplateId) WHERE t.ActivityCode = N'DEED-CHAIN-FINAL';
DELETE h FROM dbo.LegalActivityHistory h JOIN dbo.LegalVerificationActivity a ON a.ActivityId = h.ActivityId JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE t.ActivityCode = N'DEED-CHAIN-FINAL';
DELETE x FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE t.ActivityCode = N'DEED-CHAIN-FINAL';
DELETE a FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE t.ActivityCode = N'DEED-CHAIN-FINAL';
DELETE FROM dbo.LegalActivityTemplate WHERE ActivityCode = N'DEED-CHAIN-FINAL';
UPDATE dbo.LegalActivityTemplate SET IsActive = 1, Stage = N'Post-registration' WHERE ActivityCode = N'MUTATION-CONVERSION';
UPDATE dbo.LegalActivityTemplate SET ActivityName = N'Link deed and mother deed verification' WHERE ActivityCode = N'DEED-CHAIN';
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_LegalActivityTemplate_Escalate') ALTER TABLE dbo.LegalActivityTemplate DROP CONSTRAINT DF_LegalActivityTemplate_Escalate;
ALTER TABLE dbo.LegalActivityTemplate DROP COLUMN DisplayNo, SortOrder, PeriodFromYear, PeriodToYear, PeriodYears, EscalateAfterDays;
GO
-- Activities: work + verification status back to one status.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_Status') ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT CK_LegalVerificationActivity_Status;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_VerifyStatus') ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT CK_LegalVerificationActivity_VerifyStatus;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_Finding') ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT CK_LegalVerificationActivity_Finding;
GO
UPDATE dbo.LegalVerificationActivity SET Status = CASE WHEN VerifyStatus = N'Verified' THEN N'Completed' WHEN VerifyStatus = N'N/A' THEN N'Not Applicable'
  WHEN VerifyStatus IN (N'Returned', N'Rejected') THEN N'Rejected' WHEN Status IN (N'Submitted for Review', N'Closed') THEN N'In Progress' ELSE Status END;
UPDATE dbo.LegalVerificationActivity SET Finding = N'Not Found' WHERE Finding = N'Not Found in Sources Searched';
UPDATE dbo.LegalVerificationActivity SET Finding = N'Unable to Verify' WHERE Finding IN (N'Incomplete', N'Records Not Available', N'Case Found');
ALTER TABLE dbo.LegalVerificationActivity ADD CONSTRAINT CK_LegalVerificationActivity_Status CHECK (Status IN (N'Not Started', N'Pending', N'In Progress', N'Applied', N'Report Pending', N'On Hold', N'Completed', N'Not Applicable', N'Rejected'));
ALTER TABLE dbo.LegalVerificationActivity ADD CONSTRAINT CK_LegalVerificationActivity_Finding CHECK (Finding IS NULL OR Finding IN (N'Found', N'Not Found', N'Matched', N'Mismatched', N'Discrepancy Found', N'Additional Documents Required', N'Unable to Verify'));
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalVerificationActivity_Verifier') DROP INDEX IX_LegalVerificationActivity_Verifier ON dbo.LegalVerificationActivity;
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_LegalVerificationActivity_VerifyStatus') ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT DF_LegalVerificationActivity_VerifyStatus;
ALTER TABLE dbo.LegalVerificationActivity DROP COLUMN VerifyStatus, VerifierUserId, VerifyRemarks, SubmittedBy, SubmittedAt, NaReason, NaRequestedBy, NaRequestedAt, NaApprovedBy, NaApprovedAt,
  GovSubmissionDate, AckDate, QueryDate, QueryResponseDate, HearingDate, ReportReceiptDate, OrderDate, EscalatedOn;
GO
EXEC sp_set_session_context N'legal_reset', 0;
GO
