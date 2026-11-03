-- 611 · Remove the Legal sample (demo) master data from every database, including live.
-- Migration 606 already cleared the sample land / deed records. This removes the sample rows that migration 592
-- (and 595 / 602) put into the Setup masters and registers, so live pages show only what users enter.
--
-- Only rows that are certainly samples are touched: matched by their "(Demo)" remark, a demo e-mail, or the
-- exact code / name the sample script used. A sample row that real data now uses (a land, deed or another
-- master points at it) is NOT deleted — it is set Inactive, so nothing real breaks and it can be replaced.
-- Kept: the fixed reference lists the module needs (districts, area units, land and document types, deed types,
-- checklists, status reasons, lookup values, workflow steps) and everything users have entered.
SET NOCOUNT ON;
GO

-- Sample rows to remove, children before parents.
DECLARE @t TABLE (Seq INT IDENTITY(1,1), TableName SYSNAME, Pk SYSNAME, Cond NVARCHAR(MAX));
INSERT INTO @t (TableName, Pk, Cond) VALUES
  -- Registers
  (N'LegalLrRor',       N'LrRorId',     N'Remarks = N''(Demo)'''),
  (N'LegalRsPlot',      N'RsPlotId',    N'Remarks = N''(Demo)'''),
  (N'LegalRsKhatian',   N'RsKhatianId', N'Remarks = N''(Demo)'''),
  -- Parties
  (N'LegalPerson',      N'PersonId',    N'Remarks LIKE N''(Demo)%'' OR Email LIKE N''%.demo@example.com'''),
  (N'LegalParty',       N'PartyId',     N'LegalName IN (N''Nirmala Dey'', N''Rajwada Infra Developers Pvt Ltd'', N''Kalipada Naskar'') AND Pan IN (N''LNDPD8812J'', N''AAHCR5521Q'', N''CKNPN1184M'')'),
  (N'LegalAdvocate',    N'AdvocateId',  N'EnrolmentNo IN (N''WB/1123/2008'', N''WB/2241/2012'')'),
  -- Registration & workflow setup
  (N'LegalTaskType',          N'TaskTypeId',  N'TaskTypeCode IN (N''NEW-SALE'', N''NEW-GIFT'')'),
  (N'LegalApprovalWorkflow',  N'WorkflowId',  N'WorkflowName IN (N''Standard sale deed (L1 / L2)'', N''Fast track — gift & POA'')'),
  (N'LegalReminderSla',       N'ReminderId',  N'AppliesTo IN (N''Pending Documents'', N''L1 Pending'', N''Awaiting Registered Deed'')'),
  (N'LegalPortalLink',        N'LinkId',      N'LinkLabel IN (N''WB Registration — deed search'', N''WB Registration — market value'', N''Banglarbhumi — RoR & plot information'')'),
  (N'LegalRegistrationOffice',N'OfficeId',    N'OfficeCode IN (N''ADSR-BDN'', N''ADSR-SNP'', N''DSR-ALP'')'),
  -- Locations
  (N'LegalVillage',      N'VillageId',      N'VillageName IN (N''Jatragachi'', N''Bishnupur'', N''Kamrabad'')'),
  (N'LegalMouza',        N'MouzaId',        N'Remarks = N''(Demo)'''),
  (N'LegalMunicipality', N'MunicipalityId', N'BodyName IN (N''Bidhannagar Municipal Corporation'', N''Rajpur Sonarpur Municipality'', N''Kolkata Municipal Corporation'')'),
  (N'LegalPoliceStation',N'PoliceStationId',N'StationName IN (N''Rajarhat Police Station'', N''New Town Police Station'', N''Sonarpur Police Station'')'),
  (N'LegalBlock',        N'BlockId',        N'BlockName IN (N''Rajarhat'', N''Barasat-I'', N''Sonarpur'')'),
  (N'LegalSubDivision',  N'SubDivisionId',  N'SubDivisionName IN (N''Bidhannagar'', N''Barasat Sadar'', N''Baruipur'')');

-- The old party → person map has no foreign keys; drop the sample persons' entries first.
IF OBJECT_ID(N'dbo.LegalPartyPersonMap', N'U') IS NOT NULL
  DELETE m FROM dbo.LegalPartyPersonMap m
  JOIN dbo.LegalPerson p ON p.PersonId = m.PersonId
  WHERE p.Remarks LIKE N'(Demo)%' OR p.Email LIKE N'%.demo@example.com';

DECLARE @seq INT = 1, @max INT = (SELECT MAX(Seq) FROM @t), @tbl SYSNAME, @pk SYSNAME, @cond NVARCHAR(MAX), @sql NVARCHAR(MAX);
DECLARE @ids TABLE (Id INT);
DECLARE @id INT, @removed INT, @hidden INT;
WHILE @seq <= @max
BEGIN
  SELECT @tbl = TableName, @pk = Pk, @cond = Cond FROM @t WHERE Seq = @seq;
  SET @removed = 0; SET @hidden = 0;
  IF OBJECT_ID(N'dbo.' + @tbl, N'U') IS NOT NULL AND COL_LENGTH(N'dbo.' + @tbl, @pk) IS NOT NULL
  BEGIN
    DELETE FROM @ids;
    SET @sql = N'SELECT ' + QUOTENAME(@pk) + N' FROM dbo.' + QUOTENAME(@tbl) + N' WHERE ' + @cond;
    BEGIN TRY
      INSERT INTO @ids EXEC sp_executesql @sql;
    END TRY
    BEGIN CATCH
      PRINT N'611: skipped ' + @tbl + N' — ' + ERROR_MESSAGE();
    END CATCH;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM @ids;
    OPEN c; FETCH NEXT FROM c INTO @id;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      BEGIN TRY
        SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@tbl) + N' WHERE ' + QUOTENAME(@pk) + N' = @id';
        EXEC sp_executesql @sql, N'@id INT', @id = @id;
        SET @removed += 1;
      END TRY
      BEGIN CATCH
        -- Real data uses this sample row: keep it, but inactive.
        IF COL_LENGTH(N'dbo.' + @tbl, N'IsActive') IS NOT NULL
        BEGIN
          SET @sql = N'UPDATE dbo.' + QUOTENAME(@tbl) + N' SET IsActive = 0 WHERE ' + QUOTENAME(@pk) + N' = @id';
          EXEC sp_executesql @sql, N'@id INT', @id = @id;
          SET @hidden += 1;
        END
      END CATCH;
      FETCH NEXT FROM c INTO @id;
    END
    CLOSE c; DEALLOCATE c;
    PRINT N'611: ' + @tbl + N' — removed ' + CAST(@removed AS NVARCHAR(10)) + N', set inactive (in use) ' + CAST(@hidden AS NVARCHAR(10));
  END
  SET @seq += 1;
END
GO

-- Sample PDFs nothing refers to any more (the referenced ones went with migration 606's clean-up).
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql = @sql + N'INSERT INTO #r SELECT ' + QUOTENAME(COL_NAME(fkc.parent_object_id, fkc.parent_column_id)) +
              N' FROM ' + QUOTENAME(OBJECT_SCHEMA_NAME(fkc.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(fkc.parent_object_id)) +
              N' WHERE ' + QUOTENAME(COL_NAME(fkc.parent_object_id, fkc.parent_column_id)) + N' IS NOT NULL; '
FROM sys.foreign_key_columns fkc
WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.LegalMasterFile');
CREATE TABLE #r (FileId INT);
IF LEN(@sql) > 0 EXEC sp_executesql @sql;
DELETE f FROM dbo.LegalMasterFile f
WHERE f.FileName LIKE N'SAMPLE-%' AND NOT EXISTS (SELECT 1 FROM #r r WHERE r.FileId = f.FileId);
DROP TABLE #r;
GO
