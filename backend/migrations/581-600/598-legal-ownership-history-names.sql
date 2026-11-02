-- 598 · Ownership history without the Party masters.
-- Earlier owners (1962 purchasers, deceased holders, heirs) are back-dated history, not parties the company deals
-- with, so they are typed in by name on the record itself. Linking a Party master entry stays possible but optional.
--   LegalOwnershipEvent:   PreviousOwnerName / PreviousOwnerGuardian, NewOwnerName / NewOwnerGuardian,
--                          DocTypeId (what the transfer document is) and DocumentNo; NewOwnerId becomes optional.
--   LegalOwnershipRecord:  OwnerName / OwnerGuardian, PreviousOwnerName; PersonId becomes optional.
--   LegalInheritance:      DeceasedName / DeceasedGuardian; DeceasedPersonId becomes optional.
--   LegalInheritanceHeir:  HeirName / HeirGuardian; PersonId becomes optional.
-- Existing rows get their names from the linked party. Nothing is dropped.
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.LegalOwnershipEvent', 'NewOwnerName') IS NULL
  ALTER TABLE dbo.LegalOwnershipEvent ADD
    PreviousOwnerName NVARCHAR(200) NULL, PreviousOwnerGuardian NVARCHAR(200) NULL,
    NewOwnerName NVARCHAR(200) NULL, NewOwnerGuardian NVARCHAR(200) NULL,
    DocTypeId INT NULL, DocumentNo NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.LegalOwnershipRecord', 'OwnerName') IS NULL
  ALTER TABLE dbo.LegalOwnershipRecord ADD OwnerName NVARCHAR(200) NULL, OwnerGuardian NVARCHAR(200) NULL, PreviousOwnerName NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.LegalInheritance', 'DeceasedName') IS NULL
  ALTER TABLE dbo.LegalInheritance ADD DeceasedName NVARCHAR(200) NULL, DeceasedGuardian NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.LegalInheritanceHeir', 'HeirName') IS NULL
  ALTER TABLE dbo.LegalInheritanceHeir ADD HeirName NVARCHAR(200) NULL, HeirGuardian NVARCHAR(200) NULL;
GO

-- An heir is unique by linked party (when linked) and by name; several unlinked heirs are fine.
IF OBJECT_ID('dbo.UQ_LegalInheritanceHeir', 'UQ') IS NOT NULL ALTER TABLE dbo.LegalInheritanceHeir DROP CONSTRAINT UQ_LegalInheritanceHeir;
GO

IF COLUMNPROPERTY(OBJECT_ID('dbo.LegalOwnershipEvent'), 'NewOwnerId', 'AllowsNull') = 0 ALTER TABLE dbo.LegalOwnershipEvent ALTER COLUMN NewOwnerId INT NULL;
IF COLUMNPROPERTY(OBJECT_ID('dbo.LegalOwnershipRecord'), 'PersonId', 'AllowsNull') = 0 ALTER TABLE dbo.LegalOwnershipRecord ALTER COLUMN PersonId INT NULL;
IF COLUMNPROPERTY(OBJECT_ID('dbo.LegalInheritance'), 'DeceasedPersonId', 'AllowsNull') = 0 ALTER TABLE dbo.LegalInheritance ALTER COLUMN DeceasedPersonId INT NULL;
IF COLUMNPROPERTY(OBJECT_ID('dbo.LegalInheritanceHeir'), 'PersonId', 'AllowsNull') = 0 ALTER TABLE dbo.LegalInheritanceHeir ALTER COLUMN PersonId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LegalInheritanceHeir_Person')
  CREATE UNIQUE INDEX UX_LegalInheritanceHeir_Person ON dbo.LegalInheritanceHeir (InheritanceId, PersonId) WHERE PersonId IS NOT NULL;
GO

IF OBJECT_ID('dbo.FK_LegalOwnershipEvent_DocTypeId', 'F') IS NULL
  ALTER TABLE dbo.LegalOwnershipEvent ADD CONSTRAINT FK_LegalOwnershipEvent_DocTypeId FOREIGN KEY (DocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId);
GO

-- Names (and father / husband names) of existing rows, from their linked party.
UPDATE e SET
  NewOwnerName = ISNULL(e.NewOwnerName, n.FullName), NewOwnerGuardian = ISNULL(e.NewOwnerGuardian, n.GuardianName),
  PreviousOwnerName = ISNULL(e.PreviousOwnerName, p.FullName), PreviousOwnerGuardian = ISNULL(e.PreviousOwnerGuardian, p.GuardianName)
FROM dbo.LegalOwnershipEvent e
LEFT JOIN dbo.LegalPerson n ON n.PersonId = e.NewOwnerId
LEFT JOIN dbo.LegalPerson p ON p.PersonId = e.PreviousOwnerId;

UPDATE r SET OwnerName = ISNULL(r.OwnerName, o.FullName), OwnerGuardian = ISNULL(r.OwnerGuardian, o.GuardianName), PreviousOwnerName = ISNULL(r.PreviousOwnerName, p.FullName)
FROM dbo.LegalOwnershipRecord r
LEFT JOIN dbo.LegalPerson o ON o.PersonId = r.PersonId
LEFT JOIN dbo.LegalPerson p ON p.PersonId = r.PreviousPersonId;

UPDATE i SET DeceasedName = ISNULL(i.DeceasedName, d.FullName), DeceasedGuardian = ISNULL(i.DeceasedGuardian, d.GuardianName)
FROM dbo.LegalInheritance i LEFT JOIN dbo.LegalPerson d ON d.PersonId = i.DeceasedPersonId;

UPDATE h SET HeirName = ISNULL(h.HeirName, p.FullName), HeirGuardian = ISNULL(h.HeirGuardian, p.GuardianName)
FROM dbo.LegalInheritanceHeir h LEFT JOIN dbo.LegalPerson p ON p.PersonId = h.PersonId;

-- The sample transfers carry their document type and number too.
UPDATE e SET DocTypeId = t.DocTypeId, DocumentNo = ISNULL(e.DocumentNo, e.DeedNo)
FROM dbo.LegalOwnershipEvent e
JOIN dbo.LegalDocumentType t ON t.DocTypeCode = CASE WHEN e.DeedNo IS NOT NULL THEN N'PARENT-DEED' ELSE N'MUTATION' END
WHERE e.DocTypeId IS NULL AND e.Remarks LIKE N'(Demo)%';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LegalInheritanceHeir_Name')
  CREATE UNIQUE INDEX UX_LegalInheritanceHeir_Name ON dbo.LegalInheritanceHeir (InheritanceId, HeirName) WHERE HeirName IS NOT NULL;
GO

PRINT '598-legal-ownership-history-names applied successfully.';
GO
