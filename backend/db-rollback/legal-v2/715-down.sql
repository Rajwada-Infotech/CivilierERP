-- Undo 715: the whole verification workspace (deletes every workspace, activity and history row).
EXEC sp_set_session_context N'legal_reset', 1;
GO
DROP TRIGGER IF EXISTS dbo.TR_LegalActivityHistory_NoChange;
DROP TABLE IF EXISTS dbo.LegalActivityReminderLog;
DROP TABLE IF EXISTS dbo.LegalActivityDocument;
DROP TABLE IF EXISTS dbo.LegalActivityHistory;
DROP TABLE IF EXISTS dbo.LegalVerificationActivity;
DROP TABLE IF EXISTS dbo.LegalVerification;
DROP TABLE IF EXISTS dbo.LegalActivityReminderRule;
DROP TABLE IF EXISTS dbo.LegalActivityDependency;
DROP TABLE IF EXISTS dbo.LegalActivityTemplate;
DELETE FROM dbo.PageDefinitions WHERE PageKey IN (N'legal-verification-activity-master', N'legal-activity-dependency-master', N'legal-activity-reminder-master');
GO
EXEC sp_set_session_context N'legal_reset', 0;
GO
