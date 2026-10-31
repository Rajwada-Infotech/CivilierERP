-- 604 · One party master for the Legal module.
-- LegalPerson (Buyer / Seller / Owner / Customer / Witness, plus "Other") becomes the only party table.
-- Every LegalParty row is copied into it with the role the deed dossiers use it in (Seller / Buyer; "Other"
-- when unused), reusing an existing person of that role with the same PAN or name. Dossier parties are
-- re-pointed to LegalPerson. LegalParty is kept, unused, and its Setup page is retired. Nothing is deleted.
SET NOCOUNT ON;
GO

-- 1. "Other" role for parties that are neither buyer nor seller.
IF OBJECT_ID('dbo.CK_LegalPerson_PersonRole', 'C') IS NOT NULL ALTER TABLE dbo.LegalPerson DROP CONSTRAINT CK_LegalPerson_PersonRole;
ALTER TABLE dbo.LegalPerson ADD CONSTRAINT CK_LegalPerson_PersonRole
  CHECK (PersonRole IN (N'Buyer', N'Seller', N'Owner', N'Customer', N'Witness', N'Other'));
GO

-- 2. Old party id + role → person id.
IF OBJECT_ID('dbo.LegalPartyPersonMap', 'U') IS NULL
  CREATE TABLE dbo.LegalPartyPersonMap (
    PartyId INT NOT NULL,
    PersonRole NVARCHAR(30) NOT NULL,
    PersonId INT NOT NULL,
    CONSTRAINT PK_LegalPartyPersonMap PRIMARY KEY (PartyId, PersonRole)
  );
GO

DECLARE @need TABLE (PartyId INT, PersonRole NVARCHAR(30));
INSERT INTO @need
SELECT DISTINCT dp.PartyId, CASE WHEN dp.PartyRole LIKE N'%Seller%' OR dp.PartyRole LIKE N'%Landowner%' THEN N'Seller'
                                 WHEN dp.PartyRole LIKE N'%Buyer%' OR dp.PartyRole LIKE N'%Purchaser%' THEN N'Buyer' ELSE N'Other' END
FROM dbo.LegalDossierParty dp JOIN dbo.LegalParty p ON p.PartyId = dp.PartyId
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalPartyPersonMap m WHERE m.PartyId = dp.PartyId);
INSERT INTO @need
SELECT p.PartyId, N'Other' FROM dbo.LegalParty p
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalDossierParty dp WHERE dp.PartyId = p.PartyId)
  AND NOT EXISTS (SELECT 1 FROM dbo.LegalPartyPersonMap m WHERE m.PartyId = p.PartyId);

-- Reuse a person of the same role with the same PAN (or, without PAN, the same name).
INSERT INTO dbo.LegalPartyPersonMap (PartyId, PersonRole, PersonId)
SELECT n.PartyId, n.PersonRole, x.PersonId
FROM @need n JOIN dbo.LegalParty p ON p.PartyId = n.PartyId
CROSS APPLY (SELECT TOP 1 lp.PersonId FROM dbo.LegalPerson lp
             WHERE lp.PersonRole = n.PersonRole AND ((p.Pan IS NOT NULL AND lp.Pan = p.Pan) OR (p.Pan IS NULL AND lp.FullName = p.LegalName))
             ORDER BY lp.PersonId) x;

-- Copy the rest.
DECLARE @new TABLE (PersonId INT, PartyId INT, PersonRole NVARCHAR(30));
MERGE dbo.LegalPerson AS t
USING (
  SELECT n.PartyId, n.PersonRole, p.* FROM @need n JOIN dbo.LegalParty p ON p.PartyId = n.PartyId
  WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalPartyPersonMap m WHERE m.PartyId = n.PartyId AND m.PersonRole = n.PersonRole)
) AS s (PartyId, PersonRole, PartyId2, PartyType, LegalName, GuardianName, Pan, Phone, Email, Address, VerificationStatus, PrivacyClass, IsActive, NormalizedName, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
ON 1 = 0
WHEN NOT MATCHED THEN
  INSERT (PersonRole, PartyType, FullName, GuardianName, Pan, Phone, Email, Address, Remarks, IsActive, CreatedBy, CreatedAt)
  VALUES (s.PersonRole,
          CASE WHEN s.PartyType = N'Individual' THEN N'Individual' WHEN s.PartyType IN (N'Company', N'LLP') THEN N'Company' ELSE N'Organization' END,
          s.LegalName, s.GuardianName, s.Pan, LEFT(s.Phone, 15), s.Email, s.Address,
          N'From the former Party master (verification: ' + s.VerificationStatus + N')', s.IsActive, s.CreatedBy, s.CreatedAt)
OUTPUT INSERTED.PersonId, s.PartyId, s.PersonRole INTO @new;
INSERT INTO dbo.LegalPartyPersonMap (PartyId, PersonRole, PersonId) SELECT PartyId, PersonRole, PersonId FROM @new;
GO

-- 3. Dossier parties point at LegalPerson.
DECLARE @fk SYSNAME = (SELECT TOP 1 name FROM sys.foreign_keys
                      WHERE parent_object_id = OBJECT_ID('dbo.LegalDossierParty') AND referenced_object_id = OBJECT_ID('dbo.LegalParty'));
IF @fk IS NOT NULL EXEC (N'ALTER TABLE dbo.LegalDossierParty DROP CONSTRAINT ' + @fk);
GO

-- Only once: after the new foreign key exists, PartyId already holds person ids.
IF OBJECT_ID('dbo.FK_LegalDossierParty_Person', 'F') IS NULL
UPDATE dp SET PartyId = m.PersonId
FROM dbo.LegalDossierParty dp
JOIN dbo.LegalPartyPersonMap m ON m.PartyId = dp.PartyId
  AND m.PersonRole = CASE WHEN dp.PartyRole LIKE N'%Seller%' OR dp.PartyRole LIKE N'%Landowner%' THEN N'Seller'
                          WHEN dp.PartyRole LIKE N'%Buyer%' OR dp.PartyRole LIKE N'%Purchaser%' THEN N'Buyer' ELSE N'Other' END
;
GO

IF OBJECT_ID('dbo.FK_LegalDossierParty_Person', 'F') IS NULL
  ALTER TABLE dbo.LegalDossierParty ADD CONSTRAINT FK_LegalDossierParty_Person FOREIGN KEY (PartyId) REFERENCES dbo.LegalPerson(PersonId);
GO

-- 4. Retire the old Setup page.
UPDATE dbo.PageDefinitions SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE PageKey = N'legal-party-master';
GO

PRINT '604-legal-merge-party-masters applied successfully.';
GO
