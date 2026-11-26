-- Undo 716: activity entries (deletes every detail entry).
EXEC sp_set_session_context N'legal_reset', 1;
GO
IF OBJECT_ID('dbo.LegalVerificationDocumentLink', 'U') IS NOT NULL DELETE FROM dbo.LegalVerificationDocumentLink WHERE EntryId IS NOT NULL;
DROP TABLE IF EXISTS dbo.LegalActivityEntry;
IF COL_LENGTH('dbo.LegalActivityHistory', 'EntryId') IS NOT NULL ALTER TABLE dbo.LegalActivityHistory DROP COLUMN EntryId, OldDataJson;
GO
EXEC sp_set_session_context N'legal_reset', 0;
GO
