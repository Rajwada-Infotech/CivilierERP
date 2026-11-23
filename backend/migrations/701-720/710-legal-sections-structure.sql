-- Legal land sections:
-- 1. A document can belong to several sections: LegalLandDocumentSection (one row per document per section). The
--    document's own RelatedSection stays its main section and is copied in here.
-- 2. Edit rights per section: a page right for each of the 12 land sections (Role Rights). When a role / user has a
--    right set for a section it decides that section's New / Edit / Delete; otherwise the land's own right applies.
IF OBJECT_ID('dbo.LegalLandDocumentSection', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalLandDocumentSection (
    DocumentId INT NOT NULL CONSTRAINT FK_LegalLandDocumentSection_Doc REFERENCES dbo.LegalLandDocument (DocumentId) ON DELETE CASCADE,
    Section    NVARCHAR(30) NOT NULL,
    CONSTRAINT PK_LegalLandDocumentSection PRIMARY KEY (DocumentId, Section)
  );
END
GO
INSERT INTO dbo.LegalLandDocumentSection (DocumentId, Section)
SELECT d.DocumentId, d.RelatedSection FROM dbo.LegalLandDocument d
WHERE d.RelatedSection IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDocumentSection x WHERE x.DocumentId = d.DocumentId AND x.Section = d.RelatedSection);
GO
DECLARE @p TABLE (k NVARCHAR(80), l NVARCHAR(120), s INT);
INSERT @p VALUES
  (N'legal-land-sec-basic', N'Land section · Basic Information', 111), (N'legal-land-sec-ownership', N'Land section · Ownership History', 112),
  (N'legal-land-sec-acquisition', N'Land section · Acquisition & Purchase', 113), (N'legal-land-sec-records', N'Land section · Land Records (RS / LR)', 114),
  (N'legal-land-sec-legal', N'Land section · Legal Disputes', 115), (N'legal-land-sec-loans', N'Land section · Loan & Mortgage', 116),
  (N'legal-land-sec-mutation', N'Land section · Mutation', 117), (N'legal-land-sec-payments', N'Land section · Payments', 118),
  (N'legal-land-sec-tax', N'Land section · Land Tax', 119), (N'legal-land-sec-survey', N'Land section · Survey & Valuation', 120),
  (N'legal-land-sec-documents', N'Land section · Documents', 121), (N'legal-land-sec-photos', N'Land section · Notes & Photos', 122);
UPDATE d SET Label = p.l, Module = N'Legal', GroupName = N'Legal - Land sections', Actions = N'view,create,edit,delete', SortOrder = p.s, IsActive = 1
FROM dbo.PageDefinitions d JOIN @p p ON p.k = d.PageKey;
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.k, p.l, N'Legal', N'Legal - Land sections', N'view,create,edit,delete', p.s, 1, N'migration-710', SYSDATETIME() FROM @p p
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions d WHERE d.PageKey = p.k);
GO
