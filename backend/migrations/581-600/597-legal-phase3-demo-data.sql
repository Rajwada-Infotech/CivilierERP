-- 597 · Legal module Phase 3 sample data: court cases with hearings, mortgages, legal verification checks,
-- the 12-point due diligence list, advocate assignments and legal opinions on the two demo lands.
--   Rajarhat: old boundary suit (resolved), SBI loan closed with NOC, encumbrance nil, one search failed,
--             due diligence mostly clear, approved opinion "Clear with Conditions".
--   Sonarpur: ownership suit open, private loan outstanding, draft opinion "Further Verification Required".
-- Sample PDFs are stamped "SAMPLE - FOR TESTING ONLY". Added only if not there yet; safe to run again.
SET NOCOUNT ON;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Court-Order-TS-214-2016.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Court-Order-TS-214-2016.pdf', N'application/pdf', 1045, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzc0IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSXWuDMBiF7/srzmULa5aIte6yH65suFra7GKwm2xJS4YfI4mF/ftFq+1gSIhIPD7neHwpiRgoYaG/BAzmBIqYBpg9zBBSGIXjaMlx/xiAReBHsHZ5nX8asxm4xHilzzrXyiT7HaZI1UnkKCpZ52oC/oWEjyiJZ41Du/3LPZI1SE+ax7QlHRYvuzTBOlu9viRb7mmP2R48OfCn7QbZNn3zR9uMY4E02SzSq/JqhGb9cYh7h7DLWtXGoTJSGY+yovi+pfyXil1SrYTtNRcu6zQBu4k4ORB/EN4HlEVDxCiObykGkVdV0yuea3lSeB8/G4K1PpP3yR2Wwggr3KBNFLWArPnMYZtOdai1g9S20NYqCXF0vpuvSpcOtjZn9TNoE4YtYC3ccD+9iEVTyqa+nHmP81PRDMVl97+M4aGjh5deN6pUxhv4YBZSFRWkcALHyuDP3BEs8hylKJSFKCXKuvhQxt83E6w/nXa6qi3prH8B1eTC7AplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDY5NyAwMDAwMCBuIAowMDAwMDAwNzY3IDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODQyCiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Bank-NOC-SBI.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Bank-NOC-SBI.pdf', N'application/pdf', 1053, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzgyIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSX0+DMBTF3/0U51ETh+3CkMWn/cFlCQMz6oOPde2ECa1pQb++ZcBmYkhTQtrD79x7OcQLKIhHffeYUpgPEIRkitl8Bp/ASBxvlgwPz1PQAOwIel5O525DOgMTuF0V30VZSBPtXzBBLD94iUqLppR3YCdE7IZ44ax1OG/38YCkLdKRHkNyJmWL3UscYZ2uXndRwhztOd2DRRnbJhukSfzmjpKUYYE42izii/JihHb9cQgHB7+rNdZc4VBq27jeknTleJZXX9dS/5VGu9KWXH32mg5Oe82UXkVZzWuJVgp9xFaJgt9jz0/c5LwecwjCsHPQxugfaUZdBmHWvOfc5tjk2uaj1CC4NswPB92oepzci9fRLp1ky+2EkPl8lOz7l2YbO87sZSs3bCmeUBd1KSGkFNblqm6MkmKwcAFp89Ht4e9RzHtHv5vuRipp3IAFuHWgSkPwmuOoDf5E0MOiLKF4JS24ElBN9S6Ne2/DXBxcGYVurNdb/wIILsnbCmVuZHN0cmVhbSBlbmRvYmoKNSAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4gZW5kb2JqCjYgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgPj4gZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI1MSAwMDAwMCBuIAowMDAwMDAwNzA1IDAwMDAwIG4gCjAwMDAwMDA3NzUgMDAwMDAgbiAKdHJhaWxlciA8PCAvU2l6ZSA3IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo4NTAKJSVFT0YK', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Encumbrance-Search-Rajarhat.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Encumbrance-Search-Rajarhat.pdf', N'application/pdf', 1044, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzczIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSS2+CQBSF9/6Ks9RFcYYAhSVVNG0QDE4XTdxMYVQMDzNAF/31HV5q0pDJkAmc+50zl0s0i4Jo1FAPnUKeQWATHaZjwiCQAqfZG8Nyo4NaYCfQbimd+mpTEyzBfJX+pFkqpBft8QJfnHmGvEyaTCzArvDYjGi22Tp0WxWPSNoiFenVJh3p4O72vod1uPrceQFTtE0YgXkH9h5sEQb+l3oVhAwufG/r+nfl3QjtenKwRwejz+oVcZN/S17EApXgMr6oS95KWStwxfPbI/O/jLTPuCubXz6Iehs6iHT6UEX8yuWF1zjOPzRfAyXmcTGFtmy7K1rz8yR41EQHUJ2YWMKP1PVe6STUsrqCvZBpmUxzBxl1HEv1QCe6NUk0jD6CqJqsniYOsqCEeOr2qWyKMcZMTUQ7EP0efxeFMzgZfRO3ohCS1yIBr5CIvETCa65IEk8zp8HNMhQ8FxV4kaBQlkKqczu9aVyndVo2lTZY/wGLWMCECmVuZHN0cmVhbSBlbmRvYmoKNSAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4gZW5kb2JqCjYgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgPj4gZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI1MSAwMDAwMCBuIAowMDAwMDAwNjk2IDAwMDAwIG4gCjAwMDAwMDA3NjYgMDAwMDAgbiAKdHJhaWxlciA8PCAvU2l6ZSA3IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo4NDEKJSVFT0YK', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Legal-Opinion-Rajarhat.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Legal-Opinion-Rajarhat.pdf', N'application/pdf', 1070, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzk5IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSzW6jMBSF932Ks5xZDIMjQqlmxaQ0qkRDlbqLWd7CTXEEdsY47evX/CSNpoOMLQTnfufYvmEQC4SBiPyyELCvCJGECyxvlohCWMbu6rfEz7sFRAy5gxiG1/m/iVhCVvi2Um+qUWyz7SN+IOdXatCa6tjwd8g9MnkVBsmydximLz4hRY/0pOskHEhP6cNjnuG2WD0/ZBvpaXfFFjJ7kvebNYpN/sd/2hQSKfJsneZn5dkI/bhwSE4O0Zh1TGcOSiuj4R+nXMOe2lF7+Az8JaAYA+akq0kzWohJsxCfoi3tydbksKrNe0uuJhwa4+bYcZIMZWn1ZkpyPMu/EAa45Zc9aeU9yDm2e57NHsfxUFaMm57HT7pVw2TxrlyN0uhKOV/UzcKjaCz6V/kf/iRNfd7OcYWalUXJ1qmd6jf+C1o1oPLvUXUDy/ffwdjzwfk26rtonKc7FriZokTj6a9Zs6WeTx0qbg0qcoSdsbho1ABp00BTyx38nUIf2xe2/r1veVW63v/YBZP1B8rM22IKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA3MjIgMDAwMDAgbiAKMDAwMDAwMDc5MiAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjg2NwolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @raj INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Converted%');
DECLARE @son INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Entered%');
DECLARE @f TABLE (n NVARCHAR(200), id INT);
INSERT INTO @f SELECT FileName, FileId FROM dbo.LegalMasterFile WHERE FileName LIKE N'SAMPLE-%';
DECLARE @lk TABLE (c NVARCHAR(40), n NVARCHAR(150), id INT);
INSERT INTO @lk SELECT Category, Name, LookupId FROM dbo.LegalLookupValue;
DECLARE @deb INT = (SELECT AdvocateId FROM dbo.LegalAdvocate WHERE EnrolmentNo = N'WB/1123/2008');
DECLARE @san INT = (SELECT AdvocateId FROM dbo.LegalAdvocate WHERE EnrolmentNo = N'WB/2241/2012');

IF @raj IS NOT NULL AND @son IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalCase WHERE LandId IN (@raj, @son))
BEGIN
  -- Court cases: an old boundary suit on Rajarhat (resolved), a live dispute on Sonarpur.
  INSERT INTO dbo.LegalCase (LandId, CaseNumber, CaseTypeId, CourtName, FilingDate, Plaintiff, Defendant, CaseSubject, AdvocateId, LegalStatusId, NextHearingDate, CaseResult, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES
    (@raj, N'T.S. 214/2016', (SELECT id FROM @lk WHERE c = N'case-type' AND n = N'Boundary Dispute'), N'Civil Judge (Junior Division), Barasat', '2016-04-11',
     N'Bimal Das', N'Anirban Ghosh, Suman Ghosh', N'(Demo) Western boundary wall alleged to encroach 2 ft on Dag 1872', @deb,
     (SELECT id FROM @lk WHERE c = N'legal-status' AND n = N'Resolved'), NULL, N'(Demo) Suit dismissed after joint survey; boundary confirmed',
     (SELECT id FROM @f WHERE n = N'SAMPLE-Court-Order-TS-214-2016.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u),
    (@son, N'T.S. 77/2025', (SELECT id FROM @lk WHERE c = N'case-type' AND n = N'Ownership Dispute'), N'Civil Judge (Senior Division), Baruipur', '2025-08-02',
     N'Haripada Naskar', N'Kalipada Naskar', N'(Demo) Cousin claims 1/4 share in Dag 640 through common ancestor', @san,
     (SELECT id FROM @lk WHERE c = N'legal-status' AND n = N'Open'), '2026-11-21', NULL, NULL, N'Pending', NULL, NULL, N'(Demo)', @u);

  INSERT INTO dbo.LegalCaseHearing (LandId, CaseId, HearingDate, Purpose, Outcome, NextDate, Remarks, CreatedBy)
  SELECT c.LandId, c.CaseId, v.d, v.p, v.o, v.nd, N'(Demo)', @u
  FROM dbo.LegalCase c JOIN (VALUES
    (N'T.S. 214/2016', CAST('2016-09-05' AS DATE), N'Joint survey order', N'Survey commissioner appointed', CAST('2017-01-16' AS DATE)),
    (N'T.S. 214/2016', CAST('2017-01-16' AS DATE), N'Survey report', N'Report accepted; suit dismissed', NULL),
    (N'T.S. 77/2025', CAST('2026-09-19' AS DATE), N'Written statement', N'Defendant filed written statement', CAST('2026-11-21' AS DATE))
  ) v (cn, d, p, o, nd) ON v.cn = c.CaseNumber AND c.LandId IN (@raj, @son);

  -- Mortgages: a closed and released bank loan on Rajarhat, a live private loan on Sonarpur.
  INSERT INTO dbo.LegalMortgage (LandId, LenderName, BorrowerName, MortgageTypeId, LoanAccountRef, LoanAmount, OutstandingAmount, LoanStartDate, LoanEndDate, RegistrationDetails, ReleaseDocFileId, ClearanceDate, MortgageStatus, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES
    (@raj, N'State Bank of India, Rajarhat branch', N'Subhash Ghosh', (SELECT id FROM @lk WHERE c = N'mortgage-type' AND n = N'Bank Loan'), N'DEMO-SBI-0099', 300000, 0, '2008-05-01', '2013-04-30',
     N'Memorandum of deposit of title deeds, 2008', (SELECT id FROM @f WHERE n = N'SAMPLE-Bank-NOC-SBI.pdf'), '2013-06-12', N'Release Verified', N'Verified', @u, SYSUTCDATETIME(), N'(Demo) NOC on file', @u),
    (@son, N'Sk. Rahim (private lender)', N'Kalipada Naskar', (SELECT id FROM @lk WHERE c = N'mortgage-type' AND n = N'Private Loan'), NULL, 400000, 400000, '2024-01-10', NULL,
     N'Unregistered agreement (copy only)', NULL, NULL, N'Loan Outstanding', N'Pending', NULL, NULL, N'(Demo) Seller says it will be repaid from sale proceeds', @u);

  -- Legal verification checks.
  INSERT INTO dbo.LegalVerificationCheck (LandId, CheckType, SearchDate, PeriodFrom, PeriodTo, SearchSource, Result, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  SELECT v.l, v.t, v.d, v.pf, v.pt, v.src, v.r, (SELECT id FROM @f WHERE n = v.doc), v.vs, CASE WHEN v.vs = N'Verified' THEN @u END, CASE WHEN v.vs = N'Verified' THEN SYSUTCDATETIME() END, v.rem, @u
  FROM (VALUES
    (@raj, N'Encumbrance Search', CAST('2026-10-08' AS DATE), CAST('1996-01-01' AS DATE), CAST('2026-10-01' AS DATE), N'A.D.S.R. Bidhannagar + WB Registration portal', N'Not Found', N'SAMPLE-Encumbrance-Search-Rajarhat.pdf', N'Verified', N'(Demo) No charge registered in 30 years'),
    (@raj, N'Court Case Verification', CAST('2026-10-09' AS DATE), NULL, NULL, N'e-Courts, Barasat & Bidhannagar courts', N'Found - Clear', NULL, N'Verified', N'(Demo) Only T.S. 214/2016, dismissed'),
    (@raj, N'Government Acquisition Check', CAST('2026-10-10' AS DATE), NULL, NULL, N'BL&LRO Rajarhat, HIDCO notifications', N'Search Failed', NULL, N'Pending', N'(Demo) Office server down - repeat search'),
    (@son, N'Encumbrance Search', CAST('2026-10-20' AS DATE), CAST('1996-01-01' AS DATE), CAST('2026-10-15' AS DATE), N'A.D.S.R. Sonarpur', N'Not Found', NULL, N'Pending', N'(Demo) Private loan is unregistered, so not in the registry'),
    (@son, N'Court Case Verification', CAST('2026-10-21' AS DATE), NULL, NULL, N'e-Courts, Baruipur', N'Found - Issue', NULL, N'Verified', N'(Demo) T.S. 77/2025 pending')
  ) v (l, t, d, pf, pt, src, r, doc, vs, rem);

  -- Due diligence (Rajarhat): all twelve; ten clear, one issue, one pending.
  INSERT INTO dbo.LegalDueDiligence (LandId, CheckItem, Result, ReviewedBy, ReviewedAt, Findings, CreatedBy)
  SELECT @raj, v.k, v.r, CASE WHEN v.r <> N'Pending' THEN @u END, CASE WHEN v.r <> N'Pending' THEN SYSUTCDATETIME() END, v.f, @u
  FROM (VALUES
    (N'Title Search', N'Clear', N'(Demo) Chain from 1962 deed is complete'),
    (N'Ownership Chain', N'Clear', N'(Demo) Inheritance by two sons, 60 / 40'),
    (N'Previous Deed Verification', N'Clear', N'(Demo) I-0412/1962 matches registry'),
    (N'Current Owner Verification', N'Issue Found', N'(Demo) Suman''s heir certificate copy is not attested'),
    (N'Encumbrance Search', N'Clear', N'(Demo) Nil encumbrance 1996–2026'),
    (N'Court Case Verification', N'Clear', N'(Demo) Boundary suit dismissed in 2017'),
    (N'Mortgage Verification', N'Clear', N'(Demo) SBI loan closed, NOC on file'),
    (N'Government Acquisition Check', N'Pending', NULL),
    (N'Land Classification Verification', N'Clear', N'(Demo) Bastu as per LR RoR'),
    (N'Boundary Verification', N'Clear', N'(Demo) Matches joint survey of 2017'),
    (N'Co-owner Consent', N'Clear', N'(Demo) Both co-owners willing to sell'),
    (N'RS/LR Record Mapping', N'Clear', N'(Demo) RS Dag 1205 → LR Dag 1871')
  ) v (k, r, f);

  -- Advocate assignments.
  INSERT INTO dbo.LegalAdvocateAssignment (LandId, AdvocateId, Purpose, AssignedDate, DueDate, AssignmentStatus, Remarks, CreatedBy)
  VALUES (@raj, @deb, N'Legal Opinion', '2026-10-05', '2026-10-25', N'Completed', N'(Demo)', @u),
         (@son, @san, N'Court Case', '2026-09-01', NULL, N'In Progress', N'(Demo) Defend T.S. 77/2025', @u);

  -- Legal opinions: approved for Rajarhat (clear with conditions), draft for Sonarpur.
  DECLARE @yr NVARCHAR(4) = CAST(YEAR(SYSDATETIME()) AS NVARCHAR(4));
  DECLARE @ob INT = ISNULL((SELECT MAX(TRY_CAST(RIGHT(OpinionNo, 5) AS INT)) FROM dbo.LegalOpinion WHERE OpinionNo LIKE N'OPN-' + @yr + N'-%'), 0);
  INSERT INTO dbo.LegalOpinion (OpinionNo, LandId, AdvocateId, OpinionDate, ReviewedFrom, ReviewedTo, Findings, IdentifiedRisks, MissingDocuments, Recommendations, Conditions, FinalOpinion, DocFileId, SignatureRef, OpinionStatus, ApprovedBy, ApprovedAt, CreatedBy)
  VALUES
    (N'OPN-' + @yr + N'-' + RIGHT('00000' + CAST(@ob + 1 AS VARCHAR(5)), 5), @raj, @deb, '2026-10-24', '1962-01-01', '2026-10-15',
     N'(Demo) Title traced from sale deed I-0412/1962 to Subhash Ghosh and by inheritance to his two sons. No subsisting charge; the only suit was dismissed.',
     N'(Demo) Heir certificate copy for Suman Ghosh is unattested. Government acquisition search could not be completed.',
     N'(Demo) Attested legal heir certificate', N'(Demo) Obtain attested copy; repeat acquisition search before agreement.',
     N'(Demo) 1. Attested heir certificate. 2. Nil acquisition report.', N'Clear with Conditions',
     (SELECT id FROM @f WHERE n = N'SAMPLE-Legal-Opinion-Rajarhat.pdf'), N'DC/2026/114', N'Approved', @u, SYSUTCDATETIME(), @u),
    (N'OPN-' + @yr + N'-' + RIGHT('00000' + CAST(@ob + 2 AS VARCHAR(5)), 5), @son, @san, '2026-10-28', NULL, NULL,
     N'(Demo) Title of Kalipada Naskar is under challenge in T.S. 77/2025; an unregistered private loan is outstanding.',
     N'(Demo) Pending ownership suit; outstanding private loan.', NULL, N'(Demo) Do not proceed until the suit is decided.', NULL, N'Further Verification Required',
     NULL, NULL, N'Draft', NULL, NULL, @u);

  -- Step 7 done and step 9 in progress for Rajarhat; Sonarpur's step 7 under way.
  INSERT INTO dbo.LegalWorkflowStepState (LandId, StepCode, Status, ResponsibleUserId, Remarks, UpdatedBy)
  SELECT v.l, v.c, v.s, @u, v.r, @u FROM (VALUES
    (@raj, N'DUE_DILIGENCE', N'In Progress', N'(Demo) Acquisition search to be repeated'),
    (@son, N'CASE_MORTGAGE', N'In Progress', N'(Demo) Ownership suit pending')
  ) v (l, c, s, r)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalWorkflowStepState x WHERE x.LandId = v.l AND x.StepCode = v.c);
  INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
  SELECT LandId, StepCode, NULL, Status, N'(Demo) sample data', @u FROM dbo.LegalWorkflowStepState
  WHERE (LandId = @raj AND StepCode = N'DUE_DILIGENCE') OR (LandId = @son AND StepCode = N'CASE_MORTGAGE');
END;
GO

PRINT '597-legal-phase3-demo-data applied successfully.';
GO
