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
