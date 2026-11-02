-- 614 · Legal module clean start — DEPLOYMENT DATABASES ONLY.
-- Empties every Legal record so the live module starts clean: lands, enquiries, every pipeline record, deed
-- dossiers and searches, documents and uploaded files, parties and advocates, the RS / LR registers, locations
-- below district, registration offices, portal links, task types, approval routes, reminder rules, Approval
-- Control, and the Legal audit trail.
-- Kept — the fixed reference lists the module needs to work: districts, area units, land types, lookup values,
-- document types, deed types, checklist templates and items, status reasons, the 31 workflow steps, and the
-- Menu Rights pages (PageDefinitions are not Legal tables).
--
-- Skipped on the local development database (server CTO / 192.168.29.158): there it is only marked as run.
-- Like every migration it runs once, at the deploy that first carries it; records entered after that are never
-- touched by it again.
SET NOCOUNT ON;
GO

IF @@SERVERNAME = N'CTO' OR CONVERT(NVARCHAR(64), CONNECTIONPROPERTY('local_net_address')) = N'192.168.29.158'
BEGIN
  PRINT N'614: local development database — skipped, nothing deleted.';
END
ELSE
BEGIN
  -- Every Legal table except the reference lists above. Repeated passes let children go before parents.
  DECLARE @keep TABLE (Name SYSNAME PRIMARY KEY);
  INSERT INTO @keep VALUES
    (N'LegalDistrict'), (N'LegalAreaUnit'), (N'LegalLandType'), (N'LegalLookupValue'), (N'LegalDocumentType'),
    (N'LegalDeedType'), (N'LegalChecklistTemplate'), (N'LegalChecklistItem'), (N'LegalStatusReason'),
    (N'LegalWorkflowStep'), (N'LegalMasterFile');
  DECLARE @work TABLE (Name SYSNAME PRIMARY KEY, Done BIT NOT NULL DEFAULT 0);
  INSERT INTO @work (Name)
  SELECT t.name FROM sys.tables t
  WHERE t.schema_id = SCHEMA_ID(N'dbo') AND t.name LIKE N'Legal%' AND t.name NOT IN (SELECT Name FROM @keep);

  -- A land points at its enquiry and an enquiry at its land; break that loop first.
  IF COL_LENGTH(N'dbo.LegalLand', N'EnquiryId') IS NOT NULL EXEC (N'UPDATE dbo.LegalLand SET EnquiryId = NULL');
  IF COL_LENGTH(N'dbo.LegalLandEnquiry', N'LandId') IS NOT NULL EXEC (N'UPDATE dbo.LegalLandEnquiry SET LandId = NULL');

  DECLARE @pass INT = 0, @left INT = 1, @name SYSNAME, @sql NVARCHAR(MAX);
  WHILE @pass < 15 AND @left > 0
  BEGIN
    SET @pass += 1;
    DECLARE w CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @work WHERE Done = 0 ORDER BY Name;
    OPEN w; FETCH NEXT FROM w INTO @name;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      BEGIN TRY
        SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@name);
        EXEC sp_executesql @sql;
        UPDATE @work SET Done = 1 WHERE Name = @name;
      END TRY
      BEGIN CATCH
        -- Another table still points at these rows; it is emptied this pass, so try again next pass.
      END CATCH;
      FETCH NEXT FROM w INTO @name;
    END
    CLOSE w; DEALLOCATE w;
    SET @left = (SELECT COUNT(*) FROM @work WHERE Done = 0);
  END

  -- Uploaded files nothing refers to any more (every column with a foreign key to LegalMasterFile is checked).
  DECLARE @cond NVARCHAR(MAX) = N'';
  SELECT @cond = @cond + N' AND NOT EXISTS (SELECT 1 FROM ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name)
                       + N' x WHERE x.' + QUOTENAME(c.name) + N' = f.FileId)'
  FROM sys.foreign_key_columns fkc
  JOIN sys.tables t ON t.object_id = fkc.parent_object_id
  JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
  WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.LegalMasterFile');
  SET @sql = N'DELETE f FROM dbo.LegalMasterFile f WHERE 1 = 1' + @cond;
  EXEC sp_executesql @sql;

  IF @left > 0
  BEGIN
    DECLARE @stuck NVARCHAR(MAX) = (SELECT STRING_AGG(Name, N', ') FROM @work WHERE Done = 0);
    -- Something outside the Legal module still points at these rows: stop so the deploy shows it.
    RAISERROR (N'614: could not empty %s — a table outside the Legal module refers to them.', 16, 1, @stuck);
  END
  ELSE
    PRINT N'614: Legal module data cleared; reference lists kept.';
END
GO
