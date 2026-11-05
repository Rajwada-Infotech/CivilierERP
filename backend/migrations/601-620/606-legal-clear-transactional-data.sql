-- 606 · Clear all Legal transactional data (sample / test records). Masters are kept.
-- Removed: land enquiries, land properties and everything recorded on them (pipeline steps, parties, RS / LR
--   records, photos, ownership history, documents, legal checks, purchase / sale, deeds, registration, mutation,
--   settlement, register snapshots, holds), the deed-registration dossiers and searches, their audit rows, and
--   uploaded files that nothing kept refers to any more.
-- Kept: every Setup master (locations, types, offices, portal links, checklists, workflows…), the parties
--   (Buyer / Seller / Owner / Customer / Witness, Advocate), the RS / LR registers and the workflow step list.
-- Runs once; later ENQ / LND / DOC / … numbers start again from 00001.
--
-- Safety: it only clears everything when the database holds nothing but sample records. If any real land,
-- enquiry, deed dossier or registration search exists (one without a sample marker), only the sample ones are
-- removed and real data is never touched. Sample markers: lands "(Demo)…" in Remarks, enquiries "(Demo)…" in
-- InitialNotes, dossiers DOS-DEMO-…, searches SRCH-DEMO-….
SET NOCOUNT ON;


GO
-- The same check opens every batch below (each batch may run on its own connection): "real data" means a land,
-- enquiry, deed dossier or registration search without a sample marker.
IF (EXISTS (SELECT 1
            FROM   dbo.LegalLand
            WHERE  ISNULL(Remarks, N'') NOT LIKE N'(Demo)%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalLandEnquiry
               WHERE  ISNULL(InitialNotes, N'') NOT LIKE N'(Demo)%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalDeedDossier
               WHERE  ISNULL(DossierNumber, N'') NOT LIKE N'DOS-DEMO-%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalSearchSession
               WHERE  ISNULL(SessionNumber, N'') NOT LIKE N'SRCH-DEMO-%'))
  PRINT N'606: real Legal data exists — removing only the sample (demo) records.';


GO
IF NOT (EXISTS (SELECT 1
                FROM   dbo.LegalLand
                WHERE  ISNULL(Remarks, N'') NOT LIKE N'(Demo)%')
        OR EXISTS (SELECT 1
                   FROM   dbo.LegalLandEnquiry
                   WHERE  ISNULL(InitialNotes, N'') NOT LIKE N'(Demo)%')
        OR EXISTS (SELECT 1
                   FROM   dbo.LegalDeedDossier
                   WHERE  ISNULL(DossierNumber, N'') NOT LIKE N'DOS-DEMO-%')
        OR EXISTS (SELECT 1
                   FROM   dbo.LegalSearchSession
                   WHERE  ISNULL(SessionNumber, N'') NOT LIKE N'SRCH-DEMO-%'))
  BEGIN
    -- Phase 6
    DELETE dbo.LegalLandRegisterSnapshot;
    DELETE dbo.LegalSettlement;
    DELETE dbo.LegalFinalCheck;
    DELETE dbo.LegalMutationRecord;
    DELETE dbo.LegalMutationHearing;
    DELETE dbo.LegalMutation;
    -- Ownership (records point at transfers; transfers may point at registered deeds)
    DELETE dbo.LegalOwnershipCheck;
    DELETE dbo.LegalOwnershipRecord;
    DELETE dbo.LegalOwnershipEvent;
    DELETE dbo.LegalInheritanceHeir;
    DELETE dbo.LegalInheritance;
    DELETE dbo.LegalPartition;
    -- Phase 5
    DELETE dbo.LegalRegisteredDeed;
    DELETE dbo.LegalRegAttempt;
    DELETE dbo.LegalRegAppointment;
    DELETE dbo.LegalRegPayment;
    DELETE dbo.LegalStampDuty;
    DELETE dbo.LegalDeedDraftCheck;
    DELETE dbo.LegalDeedDraft;
    DELETE dbo.LegalLandDeed;
    -- Phase 4
    DELETE dbo.LegalPartyApproval;
    DELETE dbo.LegalAgreement;
    DELETE dbo.LegalPayment;
    DELETE dbo.LegalExpense;
    DELETE dbo.LegalValuation;
    DELETE dbo.LegalLandTransaction;
    -- Phase 3
    DELETE dbo.LegalClearance;
    DELETE dbo.LegalOpinion;
    DELETE dbo.LegalAdvocateAssignment;
    DELETE dbo.LegalDueDiligence;
    DELETE dbo.LegalVerificationCheck;
    DELETE dbo.LegalCaseHearing;
    DELETE dbo.LegalCase;
    DELETE dbo.LegalMortgage;
    -- Phase 2
    DELETE dbo.LegalLandDocumentNA;
    DELETE dbo.LegalLandDocumentVersion;
    DELETE dbo.LegalLandDocument;
    -- Phase 1
    DELETE dbo.LegalLandPhoto;
    DELETE dbo.LegalLandLrRecord;
    DELETE dbo.LegalLandRsRecord;
    DELETE dbo.LegalLandParty;
    DELETE dbo.LegalHold;
    DELETE dbo.LegalWorkflowStepHistory;
    DELETE dbo.LegalWorkflowStepState;
    DELETE dbo.LegalRecordAudit
    WHERE  LandId IS NOT NULL
           OR EntityType IN (N'Land Enquiry', N'Land Property', N'Land Document');
    UPDATE dbo.LegalLand
    SET    EnquiryId = NULL;
    DELETE dbo.LegalLandEnquiry;
    DELETE dbo.LegalLand;
  END


GO
IF NOT (EXISTS (SELECT 1
                FROM   dbo.LegalLand
                WHERE  ISNULL(Remarks, N'') NOT LIKE N'(Demo)%')
        OR EXISTS (SELECT 1
                   FROM   dbo.LegalLandEnquiry
                   WHERE  ISNULL(InitialNotes, N'') NOT LIKE N'(Demo)%')
        OR EXISTS (SELECT 1
                   FROM   dbo.LegalDeedDossier
                   WHERE  ISNULL(DossierNumber, N'') NOT LIKE N'DOS-DEMO-%')
        OR EXISTS (SELECT 1
                   FROM   dbo.LegalSearchSession
                   WHERE  ISNULL(SessionNumber, N'') NOT LIKE N'SRCH-DEMO-%'))
  BEGIN
    -- Deed-registration dossiers and searches
    DELETE dbo.LegalApprovalTask;
    DELETE dbo.LegalDossierDocument;
    DELETE dbo.LegalDossierParty;
    DELETE dbo.LegalDeedDossier;
    DELETE dbo.LegalSearchCandidate;
    DELETE dbo.LegalSearchSession;
    DELETE dbo.LegalAuditEvent;
  END


GO
-- Real data exists: remove only the sample lands / enquiries / dossiers / searches and what hangs off them.
-- Every table with a LandId (or DossierId / SessionId) is cleared for the sample ids; repeated passes let
-- children go before parents, and anything still referenced is left with a message instead of failing.
IF (EXISTS (SELECT 1
            FROM   dbo.LegalLand
            WHERE  ISNULL(Remarks, N'') NOT LIKE N'(Demo)%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalLandEnquiry
               WHERE  ISNULL(InitialNotes, N'') NOT LIKE N'(Demo)%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalDeedDossier
               WHERE  ISNULL(DossierNumber, N'') NOT LIKE N'DOS-DEMO-%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalSearchSession
               WHERE  ISNULL(SessionNumber, N'') NOT LIKE N'SRCH-DEMO-%'))
  BEGIN
    DECLARE @lands TABLE (
      Id INT PRIMARY KEY);
    INSERT INTO @lands
    SELECT LandId
    FROM   dbo.LegalLand
    WHERE  Remarks LIKE N'(Demo)%';
    DECLARE @dossiers TABLE (
      Id INT PRIMARY KEY);
    INSERT INTO @dossiers
    SELECT DossierId
    FROM   dbo.LegalDeedDossier
    WHERE  DossierNumber LIKE N'DOS-DEMO-%';
    DECLARE @sessions TABLE (
      Id INT PRIMARY KEY);
    INSERT INTO @sessions
    SELECT SessionId
    FROM   dbo.LegalSearchSession
    WHERE  SessionNumber LIKE N'SRCH-DEMO-%';
    DECLARE @landList AS NVARCHAR (MAX) = (SELECT STRING_AGG(CAST (Id AS NVARCHAR (12)), N',')
                                           FROM   @lands);
    DECLARE @dosList AS NVARCHAR (MAX) = (SELECT STRING_AGG(CAST (Id AS NVARCHAR (12)), N',')
                                          FROM   @dossiers);
    DECLARE @sesList AS NVARCHAR (MAX) = (SELECT STRING_AGG(CAST (Id AS NVARCHAR (12)), N',')
                                          FROM   @sessions);
    DECLARE @work TABLE (
      Seq  INT            IDENTITY (1, 1),
      Stmt NVARCHAR (MAX),
      Done BIT            DEFAULT 0);
    IF @landList IS NOT NULL
      INSERT INTO @work (
        Stmt
      )
      SELECT N'DELETE FROM dbo.' + QUOTENAME(t.name) + N' WHERE LandId IN (' + @landList + N')'
      FROM   sys.tables AS t
             INNER JOIN
             sys.columns AS c
             ON c.object_id = t.object_id
                AND c.name = N'LandId'
      WHERE  t.name LIKE N'Legal%'
             AND t.name NOT IN (N'LegalLand', N'LegalLandEnquiry');
    IF @dosList IS NOT NULL
      INSERT INTO @work (
        Stmt
      )
      SELECT N'DELETE FROM dbo.' + QUOTENAME(t.name) + N' WHERE DossierId IN (' + @dosList + N')'
      FROM   sys.tables AS t
             INNER JOIN
             sys.columns AS c
             ON c.object_id = t.object_id
                AND c.name = N'DossierId'
      WHERE  t.name LIKE N'Legal%'
             AND t.name <> N'LegalDeedDossier';
    IF @sesList IS NOT NULL
      INSERT INTO @work (
        Stmt
      )
      SELECT N'DELETE FROM dbo.' + QUOTENAME(t.name) + N' WHERE SessionId IN (' + @sesList + N')'
      FROM   sys.tables AS t
             INNER JOIN
             sys.columns AS c
             ON c.object_id = t.object_id
                AND c.name = N'SessionId'
      WHERE  t.name LIKE N'Legal%'
             AND t.name NOT IN (N'LegalSearchSession', N'LegalDeedDossier');
    IF @dosList IS NOT NULL
      INSERT  INTO @work (
        Stmt
      )
      VALUES             (N'DELETE FROM dbo.LegalDeedDossier WHERE DossierId IN (' + @dosList + N')');
    IF @sesList IS NOT NULL
      INSERT  INTO @work (
        Stmt
      )
      VALUES             (N'DELETE FROM dbo.LegalSearchSession WHERE SessionId IN (' + @sesList + N')');
    IF @landList IS NOT NULL
      INSERT  INTO @work (
        Stmt
      )
      VALUES             (N'UPDATE dbo.LegalLand SET EnquiryId = NULL WHERE LandId IN (' + @landList + N')'),
                         (N'DELETE FROM dbo.LegalLand WHERE LandId IN (' + @landList + N')');
    INSERT  INTO @work (
      Stmt
    )
    VALUES             (N'DELETE FROM dbo.LegalLandEnquiry WHERE InitialNotes LIKE N''(Demo)%'' AND NOT EXISTS (SELECT 1 FROM dbo.LegalLand l WHERE l.EnquiryId = LegalLandEnquiry.EnquiryId)');
    DECLARE @pass AS INT = 0, @left AS INT = 1, @seq AS INT, @stmt AS NVARCHAR (MAX);
    WHILE @pass < 8
          AND @left > 0
      BEGIN
        SET @pass += 1;
        DECLARE w CURSOR LOCAL FAST_FORWARD
          FOR SELECT   Seq,
                       Stmt
              FROM     @work
              WHERE    Done = 0
              ORDER BY Seq;
        OPEN w;
        FETCH NEXT FROM w INTO @seq, @stmt;
        WHILE @@FETCH_STATUS = 0
          BEGIN
            BEGIN TRY
              EXECUTE sp_executesql @stmt;
              UPDATE @work
              SET    Done = 1
              WHERE  Seq = @seq;
            END TRY
            BEGIN CATCH
            END CATCH -- Something still points at these rows; try again after the next pass.
            FETCH NEXT FROM w INTO @seq, @stmt;
          END
        CLOSE w;
        DEALLOCATE w;
        SET @left = (SELECT COUNT(*)
                     FROM   @work
                     WHERE  Done = 0);
      END
    IF @left > 0
      PRINT N'606: ' + CAST (@left AS NVARCHAR (10)) + N' sample clean-up step(s) left in place because real records use them.';
  END


GO
-- Uploaded files nothing refers to any more (every column with a foreign key to LegalMasterFile is checked).
DECLARE @cond AS NVARCHAR (MAX) = N'';

SELECT @cond = @cond + N' AND NOT EXISTS (SELECT 1 FROM ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' x WHERE x.' + QUOTENAME(c.name) + N' = f.FileId)'
FROM   sys.foreign_key_columns AS fkc
       INNER JOIN
       sys.tables AS t
       ON t.object_id = fkc.parent_object_id
       INNER JOIN
       sys.columns AS c
       ON c.object_id = fkc.parent_object_id
          AND c.column_id = fkc.parent_column_id
WHERE  fkc.referenced_object_id = OBJECT_ID('dbo.LegalMasterFile');

IF (EXISTS (SELECT 1
            FROM   dbo.LegalLand
            WHERE  ISNULL(Remarks, N'') NOT LIKE N'(Demo)%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalLandEnquiry
               WHERE  ISNULL(InitialNotes, N'') NOT LIKE N'(Demo)%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalDeedDossier
               WHERE  ISNULL(DossierNumber, N'') NOT LIKE N'DOS-DEMO-%')
    OR EXISTS (SELECT 1
               FROM   dbo.LegalSearchSession
               WHERE  ISNULL(SessionNumber, N'') NOT LIKE N'SRCH-DEMO-%'))
  SET @cond = @cond + N' AND f.FileName LIKE N''SAMPLE-%''';

DECLARE @sql AS NVARCHAR (MAX) = N'DELETE f FROM dbo.LegalMasterFile f WHERE 1 = 1' + @cond;

EXECUTE sp_executesql @sql;


GO
PRINT '606-legal-clear-transactional-data applied successfully.';