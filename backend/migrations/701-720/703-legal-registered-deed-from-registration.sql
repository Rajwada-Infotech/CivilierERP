-- Deed Registration now records the registered deed in LegalRegisteredDeed (it fed only LegalLand before), so the
-- Mutation form's "Registered deed" list has it. DeedId (the old deed-draft record) becomes optional; lands already
-- registered get their row from their registration details.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LegalRegisteredDeed') AND name = 'DeedId' AND is_nullable = 0)
BEGIN
  DECLARE @fk NVARCHAR(200) = (SELECT TOP 1 fk.name FROM sys.foreign_keys fk JOIN sys.foreign_key_columns c ON c.constraint_object_id = fk.object_id
    WHERE fk.parent_object_id = OBJECT_ID('dbo.LegalRegisteredDeed') AND COL_NAME(c.parent_object_id, c.parent_column_id) = 'DeedId');
  DECLARE @ix TABLE (name SYSNAME);
  INSERT @ix SELECT DISTINCT i.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    WHERE i.object_id = OBJECT_ID('dbo.LegalRegisteredDeed') AND COL_NAME(ic.object_id, ic.column_id) = 'DeedId' AND i.is_primary_key = 0;
  DECLARE @n SYSNAME;
  WHILE EXISTS (SELECT 1 FROM @ix) BEGIN SELECT TOP 1 @n = name FROM @ix; EXEC(N'DROP INDEX [' + @n + N'] ON dbo.LegalRegisteredDeed'); DELETE @ix WHERE name = @n; END
  ALTER TABLE dbo.LegalRegisteredDeed ALTER COLUMN DeedId INT NULL;
END
GO
INSERT INTO dbo.LegalRegisteredDeed (LandId, DeedId, RegisteredDeedNo, RegistrationDate, RegistrationOfficeId, DeedFileId, CertifiedCopyStatus, ApprovalStatus, ApprovedAt, IsActive, CreatedBy)
SELECT l.LandId, NULL, l.RegDeedNo, CAST(ISNULL(l.RegFinalDate, l.RegCompletedAt) AS DATE), l.RegOfficeId, l.RegDeedFileId, N'Not Applied', N'Approved', l.RegCompletedAt, 1, l.RegCompletedBy
FROM dbo.LegalLand l
WHERE l.WorkflowStatus = N'Registered' AND l.RegDeedNo IS NOT NULL AND l.RegDeedFileId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.LegalRegisteredDeed d WHERE d.LandId = l.LandId AND d.RegisteredDeedNo = l.RegDeedNo);
GO
