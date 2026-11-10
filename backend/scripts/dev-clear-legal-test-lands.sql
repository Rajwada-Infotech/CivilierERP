-- 606 · Clear all Legal transactional data (sample / test records). Masters are kept.
-- Removed: land enquiries, land properties and everything recorded on them (pipeline steps, parties, RS / LR
--   records, photos, ownership history, documents, legal checks, purchase / sale, deeds, registration, mutation,
--   settlement, register snapshots, holds), the deed-registration dossiers and searches, their audit rows, and
--   uploaded files that nothing kept refers to any more.
-- Kept: every Setup master (locations, types, offices, portal links, checklists, workflows…), the parties
--   (Buyer / Seller / Owner / Customer / Witness, Advocate), the RS / LR registers and the workflow step list.
-- Runs once; later ENQ / LND / DOC / … numbers start again from 00001.
SET NOCOUNT ON;
GO

-- Phase 6
DELETE FROM dbo.LegalLandRegisterSnapshot;
DELETE FROM dbo.LegalSettlement;
DELETE FROM dbo.LegalFinalCheck;
DELETE FROM dbo.LegalMutationRecord;
DELETE FROM dbo.LegalMutationHearing;
DELETE FROM dbo.LegalMutation;
-- Ownership (records point at transfers; transfers may point at registered deeds)
DELETE FROM dbo.LegalOwnershipCheck;
DELETE FROM dbo.LegalOwnershipRecord;
DELETE FROM dbo.LegalOwnershipEvent;
DELETE FROM dbo.LegalInheritanceHeir;
DELETE FROM dbo.LegalInheritance;
DELETE FROM dbo.LegalPartition;
-- Phase 5
DELETE FROM dbo.LegalRegisteredDeed;
DELETE FROM dbo.LegalRegAttempt;
DELETE FROM dbo.LegalRegAppointment;
DELETE FROM dbo.LegalRegPayment;
DELETE FROM dbo.LegalStampDuty;
DELETE FROM dbo.LegalDeedDraftCheck;
DELETE FROM dbo.LegalDeedDraft;
DELETE FROM dbo.LegalLandDeed;
-- Phase 4
DELETE FROM dbo.LegalPartyApproval;
DELETE FROM dbo.LegalAgreement;
DELETE FROM dbo.LegalPayment;
DELETE FROM dbo.LegalExpense;
DELETE FROM dbo.LegalValuation;
DELETE FROM dbo.LegalLandTransaction;
-- Phase 3
DELETE FROM dbo.LegalClearance;
DELETE FROM dbo.LegalOpinion;
DELETE FROM dbo.LegalAdvocateAssignment;
DELETE FROM dbo.LegalDueDiligence;
DELETE FROM dbo.LegalVerificationCheck;
DELETE FROM dbo.LegalCaseHearing;
DELETE FROM dbo.LegalCase;
DELETE FROM dbo.LegalMortgage;
-- Phase 2
DELETE FROM dbo.LegalLandDocumentNA;
DELETE FROM dbo.LegalLandDocumentVersion;
DELETE FROM dbo.LegalLandDocument;
-- Phase 1
DELETE FROM dbo.LegalLandPhoto;
DELETE FROM dbo.LegalLandLrRecord;
DELETE FROM dbo.LegalLandRsRecord;
DELETE FROM dbo.LegalLandParty;
DELETE FROM dbo.LegalHold;
DELETE FROM dbo.LegalWorkflowStepHistory;
DELETE FROM dbo.LegalWorkflowStepState;
DELETE FROM dbo.LegalRecordAudit WHERE LandId IS NOT NULL OR EntityType IN (N'Land Enquiry', N'Land Property', N'Land Document');
UPDATE dbo.LegalLand SET EnquiryId = NULL;
DELETE FROM dbo.LegalLandEnquiry;
DELETE FROM dbo.LegalLand;
GO

-- Deed-registration dossiers and searches
DELETE FROM dbo.LegalApprovalTask;
DELETE FROM dbo.LegalDossierDocument;
DELETE FROM dbo.LegalDossierParty;
DELETE FROM dbo.LegalDeedDossier;
DELETE FROM dbo.LegalSearchCandidate;
DELETE FROM dbo.LegalSearchSession;
DELETE FROM dbo.LegalAuditEvent;
GO

-- Uploaded files nothing refers to any more (every column with a foreign key to LegalMasterFile is checked).
DECLARE @cond NVARCHAR(MAX) = N'';
SELECT @cond = @cond + N' AND NOT EXISTS (SELECT 1 FROM ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name)
                     + N' x WHERE x.' + QUOTENAME(c.name) + N' = f.FileId)'
FROM sys.foreign_key_columns fkc
JOIN sys.tables t ON t.object_id = fkc.parent_object_id
JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
WHERE fkc.referenced_object_id = OBJECT_ID('dbo.LegalMasterFile');
DECLARE @sql NVARCHAR(MAX) = N'DELETE f FROM dbo.LegalMasterFile f WHERE 1 = 1' + @cond;
EXEC sp_executesql @sql;
GO

PRINT '606-legal-clear-transactional-data applied successfully.';
GO
-- 613 · Finish removing the Legal sample (demo) master data.
-- Migration 611 kept a sample row Inactive when real data used it. Inactive rows still show in the Setup tables
-- while the dashboard counted only active ones, so the numbers did not match. Now every sample row nothing uses
-- is deleted; a sample row that real data does use is no longer a sample — its "(Demo)" remark and demo e-mail
-- are removed and it is an ordinary active record. The same sample list as 611 (by marker, code or name).
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
      PRINT N'613: skipped ' + @tbl + N' — ' + ERROR_MESSAGE();
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
        -- Real data uses this row, so it is real now: drop its sample marking and keep it as a normal record.
        SET @sql = N'UPDATE dbo.' + QUOTENAME(@tbl) + N' SET '
          + CASE WHEN COL_LENGTH(N'dbo.' + @tbl, N'Remarks') IS NOT NULL THEN N'Remarks = NULLIF(LTRIM(REPLACE(Remarks, N''(Demo)'', N'''')), N''''), ' ELSE N'' END
          + CASE WHEN COL_LENGTH(N'dbo.' + @tbl, N'Email') IS NOT NULL THEN N'Email = CASE WHEN Email LIKE N''%.demo@example.com'' THEN NULL ELSE Email END, ' ELSE N'' END
          + N'IsActive = 1 WHERE ' + QUOTENAME(@pk) + N' = @id';
        EXEC sp_executesql @sql, N'@id INT', @id = @id;
        SET @hidden += 1;
      END CATCH;
      FETCH NEXT FROM c INTO @id;
    END
    CLOSE c; DEALLOCATE c;
    PRINT N'613: ' + @tbl + N' — removed ' + CAST(@removed AS NVARCHAR(10)) + N', kept as a normal record (in use) ' + CAST(@hidden AS NVARCHAR(10));
  END
  SET @seq += 1;
END
GO

