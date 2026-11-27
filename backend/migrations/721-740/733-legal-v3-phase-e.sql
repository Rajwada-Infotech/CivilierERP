-- Legal V3 phase E (3.0 specification):
--  1. Final Legal Review checklist is configurable and versioned: Setup list "final-review-check" (the 12 points as
--     they were); each review stores the checklist version it used.
--  2. Legal rules carry their legal basis and life cycle: framework, provision, property type, jurisdiction, case
--     type, effective / expiry date, version, approval and status (Draft … Active, Superseded, Disabled).
--  3. Document categories for the legal file (mother / link deed, birth / marriage evidence, probate, release deed…).
INSERT INTO dbo.LegalLookupValue (Category, Code, Name, SortOrder, IsActive)
SELECT N'final-review-check', v.c, v.n, v.s, 1 FROM (VALUES
  (N'mandatory', N'All mandatory activities completed and verified', 1), (N'applicable', N'Applicable activities correctly identified', 2),
  (N'na', N'N/A activities have authorised reasons', 3), (N'documents', N'Required documents available and reviewed', 4),
  (N'ownership', N'Ownership mismatches assessed', 5), (N'chain', N'Missing deed links assessed', 6), (N'court', N'Court search findings reviewed', 7),
  (N'clearance', N'LA and ULC clearance positions reviewed', 8), (N'succession', N'Inheritance and succession documents reviewed', 9),
  (N'survey', N'Survey discrepancies assessed', 10), (N'exceptions', N'Dependency overrides and legal exceptions reviewed', 11),
  (N'risks', N'Significant legal remarks and risks recorded', 12)) v(c, n, s)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLookupValue x WHERE x.Category = N'final-review-check');
GO
IF COL_LENGTH('dbo.LegalVerificationReview', 'ChecklistVersion') IS NULL ALTER TABLE dbo.LegalVerificationReview ADD ChecklistVersion NVARCHAR(40) NULL;
GO
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT N'legal-final-review-check-master', N'Final Review Checklist Master', N'Legal', N'Legal Masters - Workflow', N'view,create,edit,delete,print,export', 450, 1, N'migration-733', SYSDATETIME()
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-final-review-check-master');
GO
IF COL_LENGTH('dbo.LegalRuleConfig', 'RuleStatus') IS NULL
  ALTER TABLE dbo.LegalRuleConfig ADD LegalFramework NVARCHAR(150) NULL, LegalProvision NVARCHAR(300) NULL, PropertyType NVARCHAR(100) NULL, Jurisdiction NVARCHAR(150) NULL,
    CaseType NVARCHAR(150) NULL, EffectiveDate DATE NULL, ExpiryDate DATE NULL, RuleVersion NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalRuleConfig_Version DEFAULT N'1',
    ApprovedBy INT NULL, ApprovalDate DATE NULL, RuleStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalRuleConfig_Status DEFAULT N'Active';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalRuleConfig_Status')
  ALTER TABLE dbo.LegalRuleConfig ADD CONSTRAINT CK_LegalRuleConfig_Status CHECK (RuleStatus IN (N'Draft', N'Under Review', N'Approved', N'Active', N'Superseded', N'Disabled'));
GO
INSERT INTO dbo.LegalDocumentType (DocTypeCode, DocTypeName, Category, Sensitivity, RetentionClass, IsActive)
SELECT v.c, v.n, v.cat, v.sens, N'Permanent', 1 FROM (VALUES
  (N'MOTHER-DEED', N'Mother Deed', N'Title', N'Internal'), (N'LINK-DEED', N'Link Deed', N'Title', N'Internal'), (N'PREV-DEED', N'Previous Deed', N'Title', N'Internal'),
  (N'CERT-COPY', N'Certified Copy', N'Title', N'Internal'), (N'CS-REC', N'CS Record', N'Land Record', N'Internal'), (N'RS-REC', N'RS Record', N'Land Record', N'Internal'),
  (N'LR-REC', N'LR Record', N'Land Record', N'Internal'), (N'PLOT-INFO', N'Plot Information', N'Land Record', N'Internal'), (N'MOUZA-MAP', N'Mouza Map', N'Survey', N'Internal'),
  (N'BIRTH-CERT', N'Birth Certificate', N'Identity', N'Personal Data'), (N'MARRIAGE-EV', N'Marriage Evidence', N'Identity', N'Personal Data'),
  (N'PROBATE', N'Probate / Court Order', N'Legal', N'Confidential'), (N'RELEASE-DEED', N'Release / Relinquishment Deed', N'Title', N'Internal'),
  (N'COURT-JUDG', N'Court Judgment', N'Legal', N'Confidential'), (N'CONV-ORDER', N'Conversion Order', N'Revenue', N'Internal'), (N'OTHER-EVID', N'Other Legal Evidence', N'Legal', N'Internal')) v(c, n, cat, sens)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalDocumentType x WHERE x.DocTypeCode = v.c OR x.DocTypeName = v.n);
GO
