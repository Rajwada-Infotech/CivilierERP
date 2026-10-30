-- 589-seed-kolkata-legal-data.sql
-- Clean up all sample / dummy records from Legal module tables

-- 1. Remove sample transactional and audit records
IF OBJECT_ID('dbo.LegalAuditEvent', 'U') IS NOT NULL
  DELETE FROM dbo.LegalAuditEvent WHERE EntityName IN ('LegalDeedDossier', 'LegalSearchSession', 'LegalDeedRecord', 'LegalRegistrationSearch');

IF OBJECT_ID('dbo.LegalApprovalTask', 'U') IS NOT NULL
  DELETE FROM dbo.LegalApprovalTask;

IF OBJECT_ID('dbo.LegalDossierDocument', 'U') IS NOT NULL
  DELETE FROM dbo.LegalDossierDocument;

IF OBJECT_ID('dbo.LegalDossierParty', 'U') IS NOT NULL
  DELETE FROM dbo.LegalDossierParty;

IF OBJECT_ID('dbo.LegalDeedDossier', 'U') IS NOT NULL
  DELETE FROM dbo.LegalDeedDossier;

IF OBJECT_ID('dbo.LegalSearchCandidate', 'U') IS NOT NULL
  DELETE FROM dbo.LegalSearchCandidate;

IF OBJECT_ID('dbo.LegalSearchSession', 'U') IS NOT NULL
  DELETE FROM dbo.LegalSearchSession;

IF OBJECT_ID('dbo.LegalDeedApprovalLog', 'U') IS NOT NULL
  DELETE FROM dbo.LegalDeedApprovalLog;

IF OBJECT_ID('dbo.LegalDeedDocument', 'U') IS NOT NULL
  DELETE FROM dbo.LegalDeedDocument;

IF OBJECT_ID('dbo.LegalDeedRecord', 'U') IS NOT NULL
  DELETE FROM dbo.LegalDeedRecord;

IF OBJECT_ID('dbo.LegalRegistrationSearch', 'U') IS NOT NULL
  DELETE FROM dbo.LegalRegistrationSearch;

-- 2. Remove sample dummy master records
IF OBJECT_ID('dbo.LegalParty', 'U') IS NOT NULL
  DELETE FROM dbo.LegalParty WHERE LegalName IN ('Bimal Chandra Mondal', 'Satish Chandra Naskar', 'Dilip Kumar Naskar');

IF OBJECT_ID('dbo.LegalRsPlot', 'U') IS NOT NULL
  DELETE FROM dbo.LegalRsPlot WHERE PlotNo IN ('412', '415/782', '108');

IF OBJECT_ID('dbo.LegalRsKhatian', 'U') IS NOT NULL
  DELETE FROM dbo.LegalRsKhatian WHERE KhatianNo IN ('245', '318');

IF OBJECT_ID('dbo.LegalLrRor', 'U') IS NOT NULL
  DELETE FROM dbo.LegalLrRor WHERE LrKhatianNo IN ('520');

IF OBJECT_ID('dbo.LegalMouza', 'U') IS NOT NULL
  DELETE FROM dbo.LegalMouza WHERE MouzaName IN ('Jagaddal', 'Khasmallik', 'Kumorhat', 'Rajarhat Bishnupur', 'Hatisala');

GO
