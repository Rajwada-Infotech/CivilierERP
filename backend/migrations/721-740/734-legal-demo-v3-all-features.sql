-- Legal demo (TEST RESIDENCE): the V3 features filled in on the existing demo records.
--   Enquiries: next action dates and hold / rejection reasons.
--   Verification activities: findings with remarks (Clear, Document Missing, Further Investigation Required), government
--     expected and next action dates.
--   Ownership events (TR/00001): the 2004 inheritance with its two sons as separate transferees (50 % · 1/2 each), the
--     2020 inheritance with wife and daughter, the 1962 sale with its seller (Jogesh Das).
--   Haren Sarkar's case: framework confirmed, approved calculation (sole son), case approved and linked to the
--     1985 event. TR/00002: a Muslim agricultural case (legal-review gate). TR/00003: a Hindu female case ready to
--     calculate, with a will under review.
--   Land approvals with prices and conditions for the lands past approval; deed statuses follow registration.
--   Legal rules for the V3 flags with their legal basis and version.
-- Runs wherever the TEST RESIDENCE demo exists, once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.LegalInheritanceCalc', 'U') IS NULL OR OBJECT_ID('dbo.LegalLandApproval', 'U') IS NULL RETURN;
DECLARE @L1 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00001/2026-27'), @L2 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00002/2026-27'),
        @L3 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00003/2026-27'), @L4 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00004/2026-27');
IF @L1 IS NULL OR @L2 IS NULL OR @L3 IS NULL OR @L4 IS NULL RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalLandApproval WHERE LandId IN (@L2, @L3, @L4)) RETURN;

BEGIN TRAN;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalLand WHERE LandId = @L1);
DECLARE @u2 INT = ISNULL((SELECT TOP 1 id FROM dbo.users WHERE id <> @u ORDER BY id), @u);
DECLARE @f INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'TR-demo-document.pdf');
DECLARE @KATHA INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA');
DECLARE @today DATE = CAST(GETDATE() AS DATE);

-- Enquiries
UPDATE dbo.LegalLandEnquiry SET NextActionDate = DATEADD(day, 3, @today) WHERE EnquiryNo = N'TR-ENQ-0001';
UPDATE dbo.LegalLandEnquiry SET NextActionDate = DATEADD(day, 7, @today) WHERE EnquiryNo IN (N'TR-ENQ-0002', N'TR-ENQ-0003');
UPDATE dbo.LegalLandEnquiry SET NextActionDate = DATEADD(day, 14, @today), StatusReason = N'Seller to bring the 1962 mother deed; resume after it is checked' WHERE EnquiryNo = N'TR-ENQ-0004';
UPDATE dbo.LegalLandEnquiry SET StatusReason = N'Plot inside a recorded waterbody — not buildable' WHERE EnquiryNo = N'TR-ENQ-0005';

-- Verification activities (TR workspaces)
UPDATE a SET Finding = CASE WHEN a.VerifyStatus = N'Verified' THEN ISNULL(a.Finding, N'Clear') ELSE a.Finding END
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
WHERE e.EnquiryNo LIKE N'TR-ENQ-%';
UPDATE a SET Finding = N'Document Missing', Remarks = N'Plot information copy not yet issued by BL&LRO', GovtExpectedDate = DATEADD(day, 10, @today), NextActionDate = DATEADD(day, 4, @today)
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
WHERE e.EnquiryNo = N'TR-ENQ-0001' AND t.ActivityCode = N'PLOT-INFO' AND a.Status <> N'Closed';
UPDATE a SET Finding = N'Further Investigation Required', Remarks = N'RS and LR holder names differ — trace the link deed', NextActionDate = DATEADD(day, 2, @today)
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
WHERE e.EnquiryNo IN (N'TR-ENQ-0001', N'TR-ENQ-0002') AND t.ActivityCode = N'OWNER-MATCH' AND a.Status <> N'Closed';
UPDATE a SET GovtExpectedDate = DATEADD(day, 30, @today), NextActionDate = DATEADD(day, 7, @today), Remarks = ISNULL(a.Remarks, N'LA / ULC applicability decided: ULC applies; documents ready')
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
WHERE e.EnquiryNo LIKE N'TR-ENQ-%' AND t.ActivityCode = N'LA-ULC' AND a.Status <> N'Closed';

-- Ownership event parties (TR/00001)
DECLARE @E1962 INT = (SELECT TOP 1 e.EventId FROM dbo.LegalOwnershipEvent e JOIN dbo.LegalLookupValue t ON t.LookupId = e.TransferTypeId WHERE e.LandId = @L1 AND t.Name = N'Sale' AND e.EventDate = '1962-02-11');
DECLARE @E2004 INT = (SELECT TOP 1 EventId FROM dbo.LegalOwnershipEvent WHERE LandId = @L1 AND EventDate = '2004-05-10');
DECLARE @E1985 INT = (SELECT TOP 1 EventId FROM dbo.LegalOwnershipEvent WHERE LandId = @L1 AND EventDate = '1985-03-15');
DECLARE @E2020 INT = (SELECT TOP 1 EventId FROM dbo.LegalOwnershipEvent WHERE LandId = @L1 AND EventDate = '2020-01-01');
DECLARE @E2015 INT = (SELECT TOP 1 EventId FROM dbo.LegalOwnershipEvent WHERE LandId = @L1 AND EventDate = '2015-07-01');
DECLARE @P1 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L1 ORDER BY ParcelId);
DECLARE @son INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'relationship-type' AND Name = N'Son'),
        @wife INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'relationship-type' AND Name = N'Wife'),
        @dau INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'relationship-type' AND Name = N'Daughter');
UPDATE dbo.LegalOwnershipEvent SET ParcelId = @P1 WHERE LandId = @L1 AND ParcelId IS NULL;
-- 1962 sale: Jogesh Das sold to Haren Sarkar (the name on the old row is corrected through its parties)
DELETE FROM dbo.LegalOwnershipEventParty WHERE EventId = @E1962;
INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, OwnerKind, SharePct, ShareFraction, CreatedBy)
VALUES (@E1962, @L1, N'Transferor', N'Jogesh Das', N'Individual', 100, N'1/1', @u), (@E1962, @L1, N'Transferee', N'Haren Sarkar', N'Individual', 100, N'1/1', @u),
       (@E1962, @L1, N'Witness', N'Madhab Pal', N'Individual', NULL, NULL, @u);
-- 2004: Nitai's estate to his two sons
DELETE FROM dbo.LegalOwnershipEventParty WHERE EventId = @E2004;
INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, OwnerKind, RelationshipTypeId, SharePct, ShareFraction, CreatedBy)
VALUES (@E2004, @L1, N'Transferor', N'Nitai Sarkar', N'Individual', NULL, 100, N'1/1', @u),
       (@E2004, @L1, N'Transferee', N'Bimal Sarkar', N'Legal Heir / Successor', @son, 50, N'1/2', @u),
       (@E2004, @L1, N'Transferee', N'Kamal Sarkar', N'Legal Heir / Successor', @son, 50, N'1/2', @u);
-- 2015 gift: Bimal gives 1/10 to Arup (Bimal keeps 4/10)
DELETE FROM dbo.LegalOwnershipEventParty WHERE EventId = @E2015;
INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, OwnerKind, RelationshipTypeId, SharePct, ShareFraction, CreatedBy)
VALUES (@E2015, @L1, N'Transferor', N'Bimal Sarkar', N'Individual', NULL, 10, N'1/10', @u), (@E2015, @L1, N'Transferee', N'Arup Sarkar', N'Individual', @son, 10, N'1/10', @u);
-- 2020: Kamal's half to wife and daughter (pending — the nephew's dispute is open)
DELETE FROM dbo.LegalOwnershipEventParty WHERE EventId = @E2020;
INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, OwnerKind, RelationshipTypeId, SharePct, ShareFraction, CreatedBy)
VALUES (@E2020, @L1, N'Transferor', N'Kamal Sarkar', N'Individual', NULL, 50, N'1/2', @u),
       (@E2020, @L1, N'Transferee', N'Rina Sarkar', N'Legal Heir / Successor', @wife, 25, N'1/4', @u),
       (@E2020, @L1, N'Transferee', N'Puja Sarkar', N'Legal Heir / Successor', @dau, 25, N'1/4', @u);
UPDATE dbo.LegalOwnershipRecord SET ShareFraction = CASE CAST(SharePct AS INT) WHEN 100 THEN N'1/1' WHEN 50 THEN N'1/2' WHEN 40 THEN N'2/5' WHEN 25 THEN N'1/4' WHEN 10 THEN N'1/10' END,
  OwnerKind = CASE WHEN PreviousOwnerName IS NULL OR OwnerName = PreviousOwnerName THEN N'Individual' ELSE N'Co-owner' END, ParcelId = ISNULL(ParcelId, @P1)
WHERE LandId = @L1 AND ShareFraction IS NULL;

-- Haren Sarkar's case: approved (sole son Nitai), linked to the 1985 event
DECLARE @H INT = (SELECT TOP 1 InheritanceId FROM dbo.LegalInheritance WHERE LandId = @L1 AND DeceasedName = N'Haren Sarkar');
IF @H IS NOT NULL
BEGIN
  INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, IsDeceasedOwner, IsAlive, DateOfDeath, RelationshipStatus, EvidenceFileId, CreatedBy)
  VALUES (@L1, @H, N'Haren Sarkar', N'Male', N'Deceased owner', 1, 0, '1985-03-14', N'Verified', @f, @u);
  INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, DateOfDeath, RelationshipStatus, CreatedBy)
  VALUES (@L1, @H, N'Nitai Sarkar', N'Male', N'Son', SCOPE_IDENTITY(), N'Son of', 0, '2003-11-02', N'Verified', @u);
  UPDATE dbo.LegalInheritance SET FrameworkConfirmedBy = @u2, FrameworkConfirmedAt = SYSUTCDATETIME(), LegalOfficerId = @u2, ReviewStatus = N'Approved',
    ReviewRemarks = N'Only son; Class I — whole share', PrevEventId = @E1962 WHERE InheritanceId = @H;
  INSERT INTO dbo.LegalInheritanceCalc (InheritanceId, LandId, VersionNo, Framework, RuleVersion, Outcome, InputsJson, ResultJson, Explanation, CalcStatus, CreatedBy, ReviewedBy, ReviewedAt, ReviewRemarks)
  VALUES (@H, @L1, 1, N'Hindu Succession Act, 1956', N'LEGAL-V3-INH-1.0 (27 Nov 2026)', N'Calculated', N'{"case":{"framework":"Hindu Succession Act, 1956","gender":"Male"}}',
    N'{"lines":[{"memberId":0,"name":"Nitai Sarkar","relation":"Son","head":"Son","fractionOfEstate":"1","pctOfEstate":100,"fractionOfParcel":"1","pctOfParcel":100,"minor":false}],"total":"1","reasons":[]}',
    N'Hindu Succession Act 1956 s.8 (Class I): the only son takes the whole estate.', N'Approved', @u, @u2, SYSUTCDATETIME(), N'Checked against the 1986 mutation');
  UPDATE dbo.LegalOwnershipEvent SET InheritanceId = @H WHERE EventId = @E1985;
END

-- TR/00002: Muslim, agricultural — legal review gate
DECLARE @P2 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L2 ORDER BY ParcelId);
INSERT INTO dbo.LegalInheritance (LandId, DeceasedName, DateOfDeath, SupportingType, VerificationStatus, CreatedBy, DeceasedGender, ParcelId, AvailableSharePct, AvailableShareFraction,
  SuccessionType, PropertyType, NatureOfOwnership, PersonalLaw, ApplicableFramework, SchoolOfLaw, ReviewStatus, SpecialCircumstances, DisputePending)
VALUES (@L2, N'Abdul Karim', '2021-06-12', N'None', N'Pending', @u, N'Male', @P2, 100, N'1/1', N'Intestate – No Will', N'Agricultural', N'Self-Acquired / Separate Property',
  N'Muslim', N'Muslim Personal Law (Shariat)', N'Sunni (Hanafi)', N'Draft', N'Agricultural holding — Shariat Act 1937 s.2 exception to be reviewed', N'No');
DECLARE @A INT = SCOPE_IDENTITY();
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, IsDeceasedOwner, IsAlive, DateOfDeath, RelationshipStatus, CreatedBy)
VALUES (@L2, @A, N'Abdul Karim', N'Male', N'Deceased owner', 1, 0, '2021-06-12', N'Verified', @u);
DECLARE @ak INT = SCOPE_IDENTITY();
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, RelationshipStatus, CreatedBy)
VALUES (@L2, @A, N'Amina Bibi', N'Female', N'Wife', @ak, N'Wife of', 1, N'Verified', @u), (@L2, @A, N'Rafiq Karim', N'Male', N'Son', @ak, N'Son of', 1, N'Verified', @u),
       (@L2, @A, N'Salma Khatun', N'Female', N'Daughter', @ak, N'Daughter of', 1, N'Verified', @u), (@L2, @A, N'Jamila Begum', N'Female', N'Mother', @ak, N'Mother of', 1, N'Claimed', @u);

-- TR/00003: Hindu female case, framework confirmed, ready to calculate; a will under review
DECLARE @P3 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L3 ORDER BY ParcelId);
INSERT INTO dbo.LegalInheritance (LandId, DeceasedName, DateOfDeath, SupportingType, VerificationStatus, CreatedBy, DeceasedGender, ParcelId, AvailableSharePct, AvailableShareFraction,
  SuccessionType, PropertyType, NatureOfOwnership, PersonalLaw, ApplicableFramework, ReviewStatus, FrameworkConfirmedBy, FrameworkConfirmedAt, LegalOfficerId, DisputePending)
VALUES (@L3, N'Sabita Ghosh', '2018-09-03', N'Will', N'Pending', @u, N'Female', @P3, 60, N'3/5', N'Intestate – No Will', N'Residential', N'Self-Acquired / Separate Property',
  N'Hindu', N'Hindu Succession Act, 1956', N'Draft', @u2, SYSUTCDATETIME(), @u2, N'No');
DECLARE @S INT = SCOPE_IDENTITY();
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, IsDeceasedOwner, IsAlive, DateOfDeath, RelationshipStatus, CreatedBy)
VALUES (@L3, @S, N'Sabita Ghosh', N'Female', N'Deceased owner', 1, 0, '2018-09-03', N'Verified', @u);
DECLARE @sg INT = SCOPE_IDENTITY();
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, DateOfDeath, IsMinor, RelationshipStatus, CreatedBy)
VALUES (@L3, @S, N'Prabir Ghosh', N'Male', N'Husband', @sg, N'Husband of', 1, NULL, 0, N'Verified', @u),
       (@L3, @S, N'Sourav Ghosh', N'Male', N'Son', @sg, N'Son of', 1, NULL, 0, N'Verified', @u),
       (@L3, @S, N'Rimi Ghosh', N'Female', N'Daughter', @sg, N'Daughter of', 0, '2015-02-20', 0, N'Verified', @u);
DECLARE @rimi INT = SCOPE_IDENTITY();
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, IsMinor, RelationshipStatus, CreatedBy)
VALUES (@L3, @S, N'Tania Basu', N'Female', N'Daughter''s daughter', @rimi, N'Daughter of', 1, 1, N'Verified', @u);
INSERT INTO dbo.LegalInheritanceWill (LandId, InheritanceId, WillDate, Testator, Beneficiaries, PropertyCovered, Witnesses, ValidityStatus, DocFileId, Remarks, CreatedBy)
VALUES (@L3, @S, '2016-01-10', N'Sabita Ghosh', N'Sourav Ghosh', N'Flat on the 1st floor only — not this plot', N'A. Das, B. Roy', N'Under Review', @f, N'Covers another property; this plot passes intestate', @u);

-- Land approvals (lands past approval) and deed statuses
INSERT INTO dbo.LegalLandApproval (LandId, EnquiryId, Decision, FinalReviewRef, OfferedPrice, NegotiatedPrice, ApprovedPrice, Conditions, OutstandingRisks, RiskAcceptance, Remarks, DecidedBy, DecidedAt)
SELECT l.LandId, l.EnquiryId, N'Approved', N'Approved Final Legal Review', e.ExpectedPrice, e.ExpectedPrice * 0.92, e.ExpectedPrice * 0.9,
  N'Seller to clear the 2023 Khajna dues before registration', N'[{"key":"open_loan","level":"Medium","text":"Loan / mortgage not closed"}]', NULL,
  N'Commercially viable for phase 2', @u2, DATEADD(day, -20, SYSUTCDATETIME())
FROM dbo.LegalLand l JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = l.EnquiryId WHERE l.LandId IN (@L2, @L3, @L4);
UPDATE dbo.LegalLand SET DeedStage = N'Submitted for Registration' WHERE LandId = @L3;
UPDATE dbo.LegalLand SET DeedStage = N'Registered' WHERE LandId = @L4;

-- Legal rules for the V3 flags (with their basis; lawyer validation still pending)
INSERT INTO dbo.LegalRuleConfig (RuleKey, RuleName, RiskLevel, IsBlocking, LawRef, Notes, LawyerValidated, IsActive, LegalFramework, LegalProvision, PropertyType, Jurisdiction, CaseType, EffectiveDate, RuleVersion, RuleStatus)
SELECT v.k, v.n, v.lv, 0, v.law, N'Legal V3 flag', 0, 1, v.fw, v.pr, v.pt, N'West Bengal', v.ct, '2026-11-27', N'1', v.st
FROM (VALUES (N'ownership_dispute', N'Ownership dispute open', N'High', NULL, NULL, NULL, NULL, N'Ownership dispute', N'Active'),
             (N'agri_inheritance_review', N'Agricultural land inherited under Muslim law', N'High', N'Muslim Personal Law (Shariat) Application Act, 1937 s.2', N'Muslim Personal Law (Shariat)', N's.2 — agricultural land excluded', N'Agricultural', N'Inheritance', N'Under Review'),
             (N'ownership_event_unverified', N'Ownership event not verified', N'Medium', NULL, NULL, NULL, NULL, N'Ownership event', N'Active'),
             (N'inheritance_case_open', N'Inheritance case not approved', N'Medium', N'Hindu Succession Act, 1956 / personal law', NULL, NULL, NULL, N'Inheritance', N'Active')) v(k, n, lv, law, fw, pr, pt, ct, st)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalRuleConfig x WHERE x.RuleKey = v.k);
COMMIT;
