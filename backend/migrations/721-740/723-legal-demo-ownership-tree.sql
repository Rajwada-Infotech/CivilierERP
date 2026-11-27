-- Legal demo: a full four-generation Ownership History on land TR/00001/2026-27 (TEST RESIDENCE), so the Records
-- and Tree views show every kind of change: a sale from an earlier owner named only as "previous owner", two
-- inheritances (with heirs), a gift of part of a share, a share kept by the giver, a family partition, owners
-- still waiting for / sent back from verification, and two property restrictions.
--   Jogesh Das ──sale 1962──▶ Haren Sarkar ──died 1985──▶ Nitai Sarkar ──died 2003──▶ Bimal 50% + Kamal 50%
--   Bimal ──gift 2015──▶ Arup Sarkar (son) 10%, Bimal keeps 40%;  Kamal ──died 2019──▶ Rina (wife) 25% + Puja (daughter) 25%
-- Runs wherever the TEST RESIDENCE demo exists (720 on dev, 722 elsewhere) and only once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @land INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00001/2026-27');
IF @land IS NULL RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalOwnershipRecord WHERE LandId = @land AND OwnerName = N'Haren Sarkar') RETURN;

BEGIN TRAN;
EXEC sp_set_session_context N'legal_reset', 1;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalOwnershipRecord WHERE LandId = @land),
        @f INT = (SELECT TOP 1 TransferDocFileId FROM dbo.LegalOwnershipRecord WHERE LandId = @land AND TransferDocFileId IS NOT NULL);
DECLARE @L TABLE (c NVARCHAR(40), nm NVARCHAR(100), id INT);
INSERT INTO @L SELECT Category, Name, LookupId FROM dbo.LegalLookupValue WHERE Category IN (N'ownership-type', N'relationship-type', N'transfer-type');
DECLARE @tInd INT = (SELECT id FROM @L WHERE c = N'ownership-type' AND nm = N'Individual'), @tInh INT = (SELECT id FROM @L WHERE c = N'ownership-type' AND nm = N'Inherited'),
        @tJoint INT = (SELECT id FROM @L WHERE c = N'ownership-type' AND nm = N'Joint'),
        @rSon INT = (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = N'Son'), @rWife INT = (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = N'Wife'),
        @rDau INT = (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = N'Daughter'), @rSelf INT = (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = N'Self');

-- Earlier generations (closed)
INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, ValidTo, TransferDocFileId, VerificationStatus, VerifiedBy, VerifiedAt,
    VerificationRemarks, CreatedBy, OwnerName, OwnerGuardian, PreviousOwnerName)
VALUES (@land, @tInd, NULL, 100, '1962-02-11', '1985-03-14', @f, N'Verified', @u, SYSUTCDATETIME(), N'Sale deed I-0221/1962 matches the RS record', @u, N'Haren Sarkar', N'Late Gopal Sarkar', N'Jogesh Das'),
       (@land, @tInh, @rSon, 100, '1985-03-15', '2003-11-02', @f, N'Verified', @u, SYSUTCDATETIME(), N'Mutated in his name in 1986', @u, N'Nitai Sarkar', N'Late Haren Sarkar', N'Haren Sarkar');
-- Bimal and Kamal (from 2004): close both holdings
UPDATE dbo.LegalOwnershipRecord SET ValidTo = '2015-06-30' WHERE LandId = @land AND OwnerName = N'Bimal Sarkar' AND ValidTo IS NULL;
UPDATE dbo.LegalOwnershipRecord SET ValidTo = '2019-12-31' WHERE LandId = @land AND OwnerName = N'Kamal Sarkar' AND ValidTo IS NULL;
-- Today's owners (100% in all)
INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, TransferDocFileId, VerificationStatus, VerifiedBy, VerifiedAt,
    VerificationRemarks, CreatedBy, OwnerName, OwnerGuardian, PreviousOwnerName)
VALUES (@land, @tJoint, @rSelf, 40, '2015-07-01', @f, N'Verified', @u, SYSUTCDATETIME(), N'Keeps 40% after gifting 10% to his son', @u, N'Bimal Sarkar', N'Late Nitai Sarkar', N'Bimal Sarkar'),
       (@land, @tJoint, @rSon, 10, '2015-07-01', @f, N'Verified', @u, SYSUTCDATETIME(), N'Gift deed I-1187/2015', @u, N'Arup Sarkar', N'Bimal Sarkar', N'Bimal Sarkar'),
       (@land, @tInh, @rWife, 25, '2020-01-01', @f, N'Pending', NULL, NULL, NULL, @u, N'Rina Sarkar', N'Late Kamal Sarkar', N'Kamal Sarkar'),
       (@land, @tInh, @rDau, 25, '2020-01-01', NULL, N'Needs Correction', @u, SYSUTCDATETIME(), N'Upload the legal heir certificate; share to be confirmed', @u, N'Puja Sarkar', N'Late Kamal Sarkar', N'Kamal Sarkar');

-- Changes of ownership (Acquisition tab and the transfer chain)
INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, TransferSharePct, TransferValue, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy,
    PreviousOwnerName, PreviousOwnerGuardian, NewOwnerName, NewOwnerGuardian, DocumentNo)
VALUES (@land, (SELECT id FROM @L WHERE c = N'transfer-type' AND nm = N'Inheritance'), '1985-03-15', 100, NULL, @f, N'Verified', @u, SYSUTCDATETIME(), N'Only son inherited', @u,
        N'Haren Sarkar', N'Late Gopal Sarkar', N'Nitai Sarkar', N'Late Haren Sarkar', N'MR/RJH/1986/044'),
       (@land, (SELECT id FROM @L WHERE c = N'transfer-type' AND nm = N'Gift'), '2015-07-01', 10, NULL, @f, N'Verified', @u, SYSUTCDATETIME(), N'Bimal gifted 10% to his son, kept 40%', @u,
        N'Bimal Sarkar', N'Late Nitai Sarkar', N'Arup Sarkar', N'Bimal Sarkar', N'I-1187/2015'),
       (@land, (SELECT id FROM @L WHERE c = N'transfer-type' AND nm = N'Inheritance'), '2020-01-01', 50, NULL, @f, N'Pending', NULL, NULL, N'Kamal''s 50% to his wife and daughter', @u,
        N'Kamal Sarkar', N'Late Nitai Sarkar', N'Rina Sarkar & Puja Sarkar', N'Late Kamal Sarkar', N'SC/BRS/2020/311');

-- Inheritances with heirs
INSERT INTO dbo.LegalInheritance (LandId, DateOfDeath, DeathCertFileId, HeirCertFileId, SupportingType, SupportingFileId, MutationRecordNo, VerificationStatus, VerifiedBy, VerifiedAt,
    Remarks, CreatedBy, DeceasedName, DeceasedGuardian, DisputePending, SuccessionLaw, ShareDecision, ShareDecisionRemarks)
VALUES (@land, '1985-03-14', @f, @f, N'Legal Heir Certificate', @f, N'MR/RJH/1986/044', N'Verified', @u, SYSUTCDATETIME(), N'Only son — sole heir', @u,
        N'Haren Sarkar', N'Late Gopal Sarkar', 0, N'Hindu Succession Act, 1956', N'Whole share to the only son', N'No other Class I heir'),
       (@land, '2019-12-31', @f, NULL, N'Succession Certificate', @f, NULL, N'Pending', NULL, NULL, N'Heir certificate awaited for the daughter', @u,
        N'Kamal Sarkar', N'Late Nitai Sarkar', 1, N'Hindu Succession Act, 1956', N'Equal shares', N'Wife and daughter 25% each; a nephew''s claim is pending');
INSERT INTO dbo.LegalInheritanceHeir (LandId, InheritanceId, RelationshipTypeId, SharePct, Remarks, CreatedBy, HeirName, HeirGuardian, HeirRole, BranchOf, Relinquished)
SELECT @land, i.InheritanceId, v.rel, v.s, v.rem, @u, v.n, v.g, v.role, i.DeceasedName, v.rq
FROM dbo.LegalInheritance i
JOIN (VALUES (N'Haren Sarkar', @rSon, 100, N'Nitai Sarkar', N'Late Haren Sarkar', N'Son', 0, N'Sole heir'),
             (N'Kamal Sarkar', @rWife, 25, N'Rina Sarkar', N'Late Kamal Sarkar', N'Wife', 0, N'Class I heir'),
             (N'Kamal Sarkar', @rDau, 25, N'Puja Sarkar', N'Late Kamal Sarkar', N'Daughter', 0, N'Class I heir'),
             (N'Kamal Sarkar', NULL, 0, N'Tapan Sarkar', N'Late Kamal Sarkar', N'Mother''s side nephew', 1, N'Relinquished by deed; claim disputed')) v(dn, rel, s, n, g, role, rq, rem)
  ON v.dn = i.DeceasedName
WHERE i.LandId = @land;

-- A second restriction
INSERT INTO dbo.LegalPropertyRestriction (LandId, Category, RestrictionType, ApplicableLaw, PermissionRequired, PermissionRef, IssuingAuthority, Status, Remarks, CreatedBy)
VALUES (@land, N'Land use', N'Agricultural land — conversion needed before building', N'WB Land Reforms Act, 1955 s.4C', N'Yes', NULL, N'BL&LRO Rajarhat', N'Permission pending', N'Apply for conversion after mutation', @u);

EXEC sp_set_session_context N'legal_reset', 0;
COMMIT;
