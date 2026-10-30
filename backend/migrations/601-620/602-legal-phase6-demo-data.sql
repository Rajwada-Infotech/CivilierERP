-- 602 · Legal module Phase 6 sample data: a third demo land, "Jadavpur 8B lane plot", taken through all 31 steps —
-- bought from Nirmala Dey (2001 owner) by Rajwada Infra, registered (I-160203311/2026), ownership transferred,
-- mutated (new LR Khatian 5120), final checks confirmed, settlement approved and the land register updated.
-- Every step's own rule is met by real records, so it shows what a closed land looks like.
-- Amounts and numbers are sample values. Sample PDFs are stamped "SAMPLE - FOR TESTING ONLY". Safe to run again.
SET NOCOUNT ON;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Registered-Deed-Jadavpur.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Registered-Deed-Jadavpur.pdf', N'application/pdf', 1088, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggNDE3IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nH2TS2+jMACE7/kVc9yVGmo7hNJjttAoKwoRoZV69MYmdZdHZCBV//3aPNpKKyrLyMKfZwYYiONREIe65sIo9AkEPmFY367hEmiJfPErw/U9A/WQ5aD9MJzZ9ekamcCPO3VRhZI6TPdYIpInXqCsRVfIn8heEWYL4vhr69BPc3iSpFbSKN34pFc6bB72UYgguXt8COPMqN0nKbLwkO3iLZI4eja34iTDBlG43UQf5IcR7Pji4E8O7pA1lSfVtFJLgYYXEkKa1dKsy/Nn3P/i0SFeYOGqdkZuMKEjx+gnuFtSjzCyWlF6zQjz5oQ93+/5JM/VUc7KTljgHJzUwaZQ51rPpvU8r6efZCVqPS86YrHSJS84Avk+q+i6Pbrv9PGFN/Ib0ZFM+esbFxy7KtdW+iKL+ix1g/2lRdSKWSfG+vMRr8S8yQit8Je3L/wK6QEBP4GZzSv8Nr6XczdlXJjy2e4Nc2oGxe3o6A5fbCsrqXlrvi9vTCnKGoK3HHmt8aXe9t0XqHgpG5iEqLryj30qbn8UdWxVq+qumfrxDz3K3csKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA3NDAgMDAwMDAgbiAKMDAwMDAwMDgxMCAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjg4NQolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-Mutation-Order-Jadavpur.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-Mutation-Order-Jadavpur.pdf', N'application/pdf', 1045, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzc0IC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSX2+CMBTF3/0U53F7gLUEWX10isaEP0a7hz12azUYoKagy779ShFdspCmfaDn/s7h9hI/oiA+De0RUJgjCBgJMJ1NERIYhcPkjeNlFYBG4AdQt6zO3jI6BZd4WhTXoiyUiXdbeEjUUZSotLyU6hn8hJhPiM+mnYPbtnhA0g5pSa+MONJ+nm6TGMt88Z7GGbe0Vb4Dj/d8k62RZ8mH/ZTlHHMk8Xqe3JV3I3TrjwMbHMI+a3ppRVvoGtpIZSytEdX5EfRfMNoHW4hm0PRoetME9CFaxmnupe/cC0gQeWFIyRg2YsxV5C5Erf1R9qB07Hy39BibQYpWSQTMI8x5jdpEkSteGV2NO9xEWWEqUQos1c8oLwydlOtx2k2yE6dvIQU29cF0zKsq9VmZBttri6SVg4UdjW4y+j28G8Xs5hj2nV2rWhn306KBVJXuWiBw0AZ/hs/HvCxRi0o1ELVEfak+O0vRjXHx1Rb24S/N0OtfTMnDSAplbmRzdHJlYW0gZW5kb2JqCjUgMCBvYmogPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+IGVuZG9iago2IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkID4+IGVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTEgMDAwMDAgbiAKMDAwMDAwMDY5NyAwMDAwMCBuIAowMDAwMDAwNzY3IDAwMDAwIG4gCnRyYWlsZXIgPDwgL1NpemUgNyAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKODQyCiUlRU9GCg==', (SELECT MIN(id) FROM dbo.users));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.LegalMasterFile WHERE FileName = N'SAMPLE-New-RoR-Jadavpur.pdf')
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy)
  VALUES (N'SAMPLE-New-RoR-Jadavpur.pdf', N'application/pdf', 1061, N'JVBERi0xLjQKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4gZW5kb2JqCjMgMCBvYmogPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiAvRjIgNiAwIFIgPj4gPj4gL0NvbnRlbnRzIDQgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9MZW5ndGggMzkwIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+IHN0cmVhbQp4nHWSS2+jMBSF9/0VZzNSuxjGRsDQZaahmbbkIeouKnVzpzYpFeDImFTqr695JZVGyDKS4fg7h3sv8yIO5vHAPXwOswdDzHyE1yECBqOQX/wR+HXrg0cQOXi/nM59jXkIIXF5UxyLslAmyXb4iVTtqUSlZVuqK4h3JOKCeXHYOfTbXZ6QvEM60u+Y9aTHxXqXJlhub57WyUY42u02g0gexd1mhe0mfXavNluBBdJktUhPypMRuvXNIZ4cgiFrpl61kdA5smL/ZhtQbpVB1Vqyha4dvqHqcE7+X1I+JF3r9pNG0WDGR5HPz6p7knQ8tAYvl/de6oEz/nI1h47iuL+UZnh4c2monuVP0pD7bBYXRRNuSft51Cjz3WEWFQS95q8upTLzqFGW0fuH+3Hc1bkhLNVRlfqgTIPd0SK10lWDM/bjXAk3H914DHtqHsf1aB8MxVypWhmySoIaSFVpSLKEXBt8m0APi7JETZVyva0l6rb613lTN8vFqy1cm9vGG62/AHg6xhEKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNiAwIG9iaiA8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EtQm9sZCA+PiBlbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDA3MTMgMDAwMDAgbiAKMDAwMDAwMDc4MyAwMDAwMCBuIAp0cmFpbGVyIDw8IC9TaXplIDcgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjg1OAolJUVPRgo=', (SELECT MIN(id) FROM dbo.users));
GO
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @yr NVARCHAR(4) = CAST(YEAR(SYSDATETIME()) AS NVARCHAR(4));
DECLARE @f TABLE (n NVARCHAR(200), id INT);
INSERT INTO @f SELECT FileName, FileId FROM dbo.LegalMasterFile WHERE FileName LIKE N'SAMPLE-%';
DECLARE @lk TABLE (c NVARCHAR(40), n NVARCHAR(150), id INT);
INSERT INTO @lk SELECT Category, Name, LookupId FROM dbo.LegalLookupValue;
DECLARE @enq INT = (SELECT TOP 1 EnquiryId FROM dbo.LegalLandEnquiry WHERE InitialNotes LIKE N'(Demo) Small%' AND LandId IS NULL);
DECLARE @mz INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Jadavpur');
DECLARE @kat INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA');
DECLARE @alp INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'DSR-ALP');
DECLARE @san INT = (SELECT AdvocateId FROM dbo.LegalAdvocate WHERE EnrolmentNo = N'WB/2241/2012');
DECLARE @buyerP INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Buyer' AND FullName = N'Rajwada Infra Developers Pvt Ltd');
DECLARE @deedFile INT = (SELECT id FROM @f WHERE n = N'SAMPLE-Registered-Deed-Jadavpur.pdf');

IF @u IS NOT NULL AND @enq IS NOT NULL AND @mz IS NOT NULL AND @alp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Completed%')
BEGIN
  -- Owner / seller parties.
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND FullName = N'Nirmala Dey')
    INSERT INTO dbo.LegalPerson (PersonRole, PartyType, FullName, GuardianName, Pan, Address, Remarks, CreatedBy) VALUES (N'Owner', N'Individual', N'Nirmala Dey', N'Ashok Dey', N'LNDPD8812J', N'Jadavpur, Kolkata 700032', N'(Demo)', @u);
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalPerson WHERE PersonRole = N'Seller' AND FullName = N'Nirmala Dey')
    INSERT INTO dbo.LegalPerson (PersonRole, PartyType, FullName, GuardianName, Pan, Address, Remarks, CreatedBy) VALUES (N'Seller', N'Individual', N'Nirmala Dey', N'Ashok Dey', N'LNDPD8812J', N'Jadavpur, Kolkata 700032', N'(Demo)', @u);
  DECLARE @ownerP INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Owner' AND FullName = N'Nirmala Dey');
  DECLARE @sellerP INT = (SELECT PersonId FROM dbo.LegalPerson WHERE PersonRole = N'Seller' AND FullName = N'Nirmala Dey');

  -- Steps 1–2: the land, converted from the Jadavpur enquiry.
  DECLARE @code NVARCHAR(30) = N'LND-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(LandCode, 5) AS INT)) FROM dbo.LegalLand WHERE LandCode LIKE N'LND-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandTypeId, LocationAddress, NorthBoundary, SouthBoundary, EastBoundary, WestBoundary,
    EnquiryId, ChecklistTemplateId, LandStatus, IsOnHold, Remarks, CreatedBy)
  SELECT @code, N'Jadavpur 8B lane plot', m.DistrictId, @mz, 3, @kat, (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'BASTU'),
    N'8B bus stand lane, Jadavpur, Kolkata 700032', N'12 ft lane', N'House of R. Basu', N'House of S. Pal', N'Vacant land of KMC',
    @enq, (SELECT TOP 1 TemplateId FROM dbo.LegalChecklistTemplate WHERE IsActive = 1 ORDER BY TemplateId), N'Mutated', 0, N'(Demo) Completed example — every step done', @u
  FROM dbo.LegalMouza m WHERE m.MouzaId = @mz;
  DECLARE @l INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = @code);
  UPDATE dbo.LegalLandEnquiry SET EnquiryStatus = N'Converted to Land Record', LandId = @l WHERE EnquiryId = @enq;

  -- Steps 3–4.
  INSERT INTO dbo.LegalLandParty (LandId, PersonId, LandRole, SharePct, Remarks, CreatedBy) VALUES (@l, @ownerP, N'Owner', 100, N'(Demo)', @u), (@l, @sellerP, N'Seller', NULL, N'(Demo)', @u);
  INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, Share, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@l, @mz, N'J-301', N'2210', N'Nirmala Dey', 3, @kat, N'1/1', N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u);

  -- Step 5: chain — bought by Nirmala in 2001; (step 23 below adds the sale to Rajwada Infra).
  INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, NewOwnerName, NewOwnerGuardian, DocTypeId, DocumentNo, DeedNo, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@l, (SELECT id FROM @lk WHERE c = N'transfer-type' AND n = N'Sale'), '2001-07-14', N'Bimala Sen', N'Nirmala Dey', N'Ashok Dey',
    (SELECT DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeCode = N'PARENT-DEED'), N'I-2215/2001', N'I-2215/2001', (SELECT id FROM @f WHERE n = N'SAMPLE-Seller-Nirmala-I-1606-2001.pdf'), N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u);
  INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, PersonId, OwnershipTypeId, SharePct, ValidFrom, EventId, PreviousOwnerName, VerificationStatus, VerifiedBy, VerifiedAt, CreatedBy)
  SELECT @l, N'Nirmala Dey', N'Ashok Dey', @ownerP, (SELECT id FROM @lk WHERE c = N'ownership-type' AND n = N'Individual'), 100, '2001-07-14', e.EventId, N'Bimala Sen', N'Verified', @u, SYSUTCDATETIME(), @u
  FROM dbo.LegalOwnershipEvent e WHERE e.LandId = @l;

  -- Step 6: one verified document for every required document type.
  INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, CurrentVersionNo, Remarks, CreatedBy)
  SELECT N'DOC-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(DocumentCode, 5) AS INT)) FROM dbo.LegalLandDocument WHERE DocumentCode LIKE N'DOC-' + @yr + N'-%'), 0)
         + ROW_NUMBER() OVER (ORDER BY i.SortOrder) AS VARCHAR(5)), 5),
         @l, i.DocTypeId, N'Property', t.DocTypeName + N' - Jadavpur', 1, N'(Demo)', @u
  FROM dbo.LegalChecklistItem i JOIN dbo.LegalDocumentType t ON t.DocTypeId = i.DocTypeId
  WHERE i.TemplateId = (SELECT ChecklistTemplateId FROM dbo.LegalLand WHERE LandId = @l) AND i.IsActive = 1 AND i.Requirement = N'Required';
  INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus, ReviewedBy, ReviewedAt)
  SELECT d.DocumentId, 1, ISNULL(@deedFile, (SELECT MIN(id) FROM @f)), @u, N'Verified', @u, SYSUTCDATETIME() FROM dbo.LegalLandDocument d WHERE d.LandId = @l;

  -- Steps 7, 9, 10.
  INSERT INTO dbo.LegalVerificationCheck (LandId, CheckType, SearchDate, SearchSource, Result, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@l, N'Encumbrance Search', '2026-06-02', N'D.S.R. Alipore', N'Not Found', N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u),
         (@l, N'Court Case Verification', '2026-06-02', N'e-Courts, Alipore', N'Not Found', N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u);
  INSERT INTO dbo.LegalDueDiligence (LandId, CheckItem, Result, ReviewedBy, ReviewedAt, Findings, CreatedBy)
  SELECT @l, j.value, N'Clear', @u, SYSUTCDATETIME(), N'(Demo)', @u FROM OPENJSON(N'["Title Search","Ownership Chain","Previous Deed Verification","Current Owner Verification","Encumbrance Search","Court Case Verification","Mortgage Verification","Government Acquisition Check","Land Classification Verification","Boundary Verification","Co-owner Consent","RS/LR Record Mapping"]') j;
  DECLARE @opn NVARCHAR(30) = N'OPN-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(OpinionNo, 5) AS INT)) FROM dbo.LegalOpinion WHERE OpinionNo LIKE N'OPN-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalOpinion (OpinionNo, LandId, AdvocateId, OpinionDate, Findings, FinalOpinion, OpinionStatus, ApprovedBy, ApprovedAt, CreatedBy)
  VALUES (@opn, @l, @san, '2026-06-10', N'(Demo) Clean title since 2001 purchase.', N'Title Clear', N'Approved', @u, SYSUTCDATETIME(), @u);
  DECLARE @clr NVARCHAR(30) = N'CLR-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(ClearanceNo, 5) AS INT)) FROM dbo.LegalClearance WHERE ClearanceNo LIKE N'CLR-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalClearance (ClearanceNo, LandId, OpinionId, Decision, DecidedBy, DecidedAt, Remarks, CreatedBy)
  SELECT @clr, @l, OpinionId, N'Cleared', @u, SYSUTCDATETIME(), N'(Demo)', @u FROM dbo.LegalOpinion WHERE OpinionNo = @opn;

  -- Steps 8, 11–14.
  DECLARE @txnNo NVARCHAR(30) = N'TXN-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(TransactionNo, 5) AS INT)) FROM dbo.LegalLandTransaction WHERE TransactionNo LIKE N'TXN-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalLandTransaction (TransactionNo, LandId, TxnType, BuyerName, BuyerId, SellerNames, TxnArea, AreaUnitId, RatePerUnit, TotalValue, AdvanceAmount, AgreementDate, TxnStatus, Remarks, CreatedBy)
  VALUES (@txnNo, @l, N'Purchase', N'Rajwada Infra Developers Pvt Ltd', @buyerP, N'Nirmala Dey', 3, @kat, 2400000, 7200000, 700000, '2026-06-15', N'Completed', N'(Demo)', @u);
  DECLARE @txn INT = (SELECT TransactionId FROM dbo.LegalLandTransaction WHERE TransactionNo = @txnNo);
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, VerificationStatus, VerifiedBy, VerifiedAt, CreatedBy)
  VALUES (@l, '2026-06-08', 3, @kat, 2450000, 7350000, 7000000, N'WB Registration portal (sample figure)', N'Verified', @u, SYSUTCDATETIME(), @u);
  DECLARE @agrNo NVARCHAR(30) = N'AGR-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(AgreementNo, 5) AS INT)) FROM dbo.LegalAgreement WHERE AgreementNo LIKE N'AGR-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalAgreement (AgreementNo, LandId, TransactionId, AgreementType, TotalValue, AdvanceAmount, AgreementDate, BuyerSignature, SellerSignature, AgreementStatus, ApprovedBy, ApprovedAt, CreatedBy)
  VALUES (@agrNo, @l, @txn, N'Agreement for Sale', 7200000, 700000, '2026-06-15', N'Signed', N'Signed', N'Signed', @u, SYSUTCDATETIME(), @u);
  INSERT INTO dbo.LegalPartyApproval (LandId, AgreementId, PartyName, PartyRole, ConsentStatus, RecordedBy, RecordedAt, IdVerification, CreatedBy)
  SELECT @l, a.AgreementId, v.n, v.r, N'Approved', @u, SYSUTCDATETIME(), N'Verified', @u FROM dbo.LegalAgreement a
  CROSS JOIN (VALUES (N'Rajwada Infra Developers Pvt Ltd', N'Buyer'), (N'Nirmala Dey', N'Seller')) v (n, r) WHERE a.AgreementNo = @agrNo;
  INSERT INTO dbo.LegalPayment (LandId, TransactionId, PaymentDate, TxnTypeId, Amount, PaymentModeId, TransactionRef, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@l, @txn, '2026-06-15', (SELECT id FROM @lk WHERE c = N'txn-type' AND n = N'Advance'), 700000, (SELECT id FROM @lk WHERE c = N'payment-mode' AND n = N'Bank Transfer'), N'DEMO-NEFT-1', N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u),
         (@l, @txn, '2026-07-20', (SELECT id FROM @lk WHERE c = N'txn-type' AND n = N'Purchase Payment'), 6500000, (SELECT id FROM @lk WHERE c = N'payment-mode' AND n = N'Bank Transfer'), N'DEMO-RTGS-2', N'Verified', @u, SYSUTCDATETIME(), N'(Demo) Balance at registration', @u);

  -- Steps 15–22.
  DECLARE @dc NVARCHAR(30) = N'DEED-' + @yr + N'-' + RIGHT('00000' + CAST(ISNULL((SELECT MAX(TRY_CAST(RIGHT(DeedCode, 5) AS INT)) FROM dbo.LegalLandDeed WHERE DeedCode LIKE N'DEED-' + @yr + N'-%'), 0) + 1 AS VARCHAR(5)), 5);
  INSERT INTO dbo.LegalLandDeed (DeedCode, LandId, TransactionId, DeedTypeId, ConsiderationAmount, DeedWriter, AdvocateId, RegistrationOfficeId, RegisteredDeedNo, RegistrationStatus, CreatedBy)
  VALUES (@dc, @l, @txn, (SELECT DeedTypeId FROM dbo.LegalDeedType WHERE DeedTypeCode = N'SALE'), 7200000, N'Pradip Saha', @san, @alp, N'I-160203311/2026', N'Completed', @u);
  DECLARE @deed INT = (SELECT DeedId FROM dbo.LegalLandDeed WHERE DeedCode = @dc);
  INSERT INTO dbo.LegalDeedDraft (LandId, DeedId, VersionNo, DraftDate, DraftFileId, ReviewStatus, ReviewedBy, ReviewedAt, CreatedBy)
  VALUES (@l, @deed, 1, '2026-07-05', ISNULL((SELECT id FROM @f WHERE n = N'SAMPLE-Deed-Draft-v2.pdf'), (SELECT MIN(id) FROM @f)), N'Approved', @u, SYSUTCDATETIME(), @u);
  INSERT INTO dbo.LegalDeedDraftCheck (LandId, DraftId, CheckItem, Result, CheckedBy, CheckedAt, CreatedBy)
  SELECT @l, d.DraftId, j.value, CASE WHEN j.value LIKE N'Ownership shares%' THEN N'Not Applicable' ELSE N'Correct' END, @u, SYSUTCDATETIME(), @u
  FROM dbo.LegalDeedDraft d CROSS JOIN OPENJSON(N'["Buyer details correct","Seller details correct","Ownership shares correct","Land area correct","Mouza and JL Number correct","RS Khatian and Dag correct","LR Khatian and Dag correct","Boundary details correct","Consideration amount correct","Deed type correct","Registration office correct","Required attachments available"]') j
  WHERE d.DeedId = @deed;
  INSERT INTO dbo.LegalStampDuty (LandId, DeedId, GovtMarketValue, ConsiderationValue, StampDuty, RegistrationFee, TotalPayable, CalculationDate, CalculationSource, VerificationStatus, VerifiedBy, VerifiedAt, CreatedBy)
  VALUES (@l, @deed, 7000000, 7200000, 432000, 72000, 504000, '2026-07-10', N'e-assessment (sample figures)', N'Verified', @u, SYSUTCDATETIME(), @u);
  INSERT INTO dbo.LegalRegPayment (LandId, DeedId, FeeTypeId, Amount, PaymentDate, PaymentRef, VerificationStatus, VerifiedBy, VerifiedAt, CreatedBy)
  VALUES (@l, @deed, (SELECT id FROM @lk WHERE c = N'fee-type' AND n = N'Stamp Duty'), 432000, '2026-07-12', N'GRN DEMO-3001', N'Verified', @u, SYSUTCDATETIME(), @u),
         (@l, @deed, (SELECT id FROM @lk WHERE c = N'fee-type' AND n = N'Registration Fee'), 72000, '2026-07-12', N'GRN DEMO-3002', N'Verified', @u, SYSUTCDATETIME(), @u);
  INSERT INTO dbo.LegalRegAppointment (LandId, DeedId, RegistrationOfficeId, AppointmentDate, AppointmentTime, TokenNo, BuyerAttendance, SellerAttendance, AppointmentStatus, CreatedBy)
  VALUES (@l, @deed, @alp, '2026-07-20', N'12:00', N'DEMO-TKN-9001', N'Present', N'Present', N'Completed', @u);
  INSERT INTO dbo.LegalRegAttempt (LandId, DeedId, AttemptDate, Result, RegisteredDeedNo, Remarks, CreatedBy)
  VALUES (@l, @deed, '2026-07-20', N'Successful', N'I-160203311/2026', N'(Demo)', @u);
  INSERT INTO dbo.LegalRegisteredDeed (LandId, DeedId, RegisteredDeedNo, RegistrationDate, RegistrationOfficeId, DeedFileId, CertifiedCopyStatus, ApprovalStatus, ApprovedBy, ApprovedAt, CreatedBy)
  VALUES (@l, @deed, N'I-160203311/2026', '2026-07-20', @alp, ISNULL(@deedFile, (SELECT MIN(id) FROM @f)), N'Received', N'Approved', @u, SYSUTCDATETIME(), @u);
  DECLARE @reg INT = (SELECT RegisteredId FROM dbo.LegalRegisteredDeed WHERE DeedId = @deed);

  -- Step 23: ownership transfer — Nirmala's record ends; Rajwada Infra owns 100%.
  UPDATE dbo.LegalOwnershipRecord SET ValidTo = '2026-07-19' WHERE LandId = @l AND OwnerName = N'Nirmala Dey';
  INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, NewOwnerName, DocTypeId, DocumentNo, DeedNo, RegistrationOfficeId, RegistrationDate, TransferSharePct, TransferValue, DocFileId, RegisteredDeedId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
  VALUES (@l, (SELECT id FROM @lk WHERE c = N'transfer-type' AND n = N'Sale'), '2026-07-20', N'Nirmala Dey', N'Rajwada Infra Developers Pvt Ltd', (SELECT DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeCode = N'REG-DEED'),
    N'I-160203311/2026', N'I-160203311/2026', @alp, '2026-07-20', 100, 7200000, @deedFile, @reg, N'Verified', @u, SYSUTCDATETIME(), N'(Demo)', @u);
  INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, PersonId, OwnershipTypeId, SharePct, ValidFrom, EventId, PreviousOwnerName, TransferDocFileId, VerificationStatus, VerifiedBy, VerifiedAt, CreatedBy)
  SELECT @l, N'Rajwada Infra Developers Pvt Ltd', @buyerP, (SELECT id FROM @lk WHERE c = N'ownership-type' AND n = N'Company'), 100, '2026-07-20', e.EventId, N'Nirmala Dey', @deedFile, N'Verified', @u, SYSUTCDATETIME(), @u
  FROM dbo.LegalOwnershipEvent e WHERE e.LandId = @l AND e.RegisteredDeedId = @reg;
  INSERT INTO dbo.LegalOwnershipCheck (LandId, RecordId, CheckItem, Result, VerifiedBy, VerifiedAt, CreatedBy)
  SELECT @l, r.RecordId, j.value, CASE WHEN j.value = N'Relationship document checked' THEN N'Not Applicable' ELSE N'Verified' END, @u, SYSUTCDATETIME(), @u
  FROM dbo.LegalOwnershipRecord r CROSS JOIN OPENJSON(N'["Identity document checked","Previous ownership document checked","Transfer document checked","Relationship document checked","Ownership share checked","Date continuity checked","Current ownership checked"]') j
  WHERE r.LandId = @l;

  -- Steps 24–26: mutation approved, new Khatian.
  INSERT INTO dbo.LegalMutation (LandId, RegisteredDeedId, ApplicationNo, ApplicationDate, OfficeName, MouzaId, DagNo, PreviousKhatian, PreviousOwner, NewOwner, ApplicationStatus, DecidedBy, DecidedAt, HearingDate, OrderNo, OrderDate, OrderFileId, Remarks, CreatedBy)
  VALUES (@l, @reg, N'DEMO-MUT-2026-4410', '2026-07-28', N'BL&LRO Sonarpur-Jadavpur', @mz, N'2210', N'J-301', N'Nirmala Dey', N'Rajwada Infra Developers Pvt Ltd', N'Approved', @u, SYSUTCDATETIME(),
    '2026-08-21', N'DEMO-ORD-889', '2026-08-28', (SELECT id FROM @f WHERE n = N'SAMPLE-Mutation-Order-Jadavpur.pdf'), N'(Demo)', @u);
  INSERT INTO dbo.LegalMutationHearing (LandId, MutationId, HearingDate, ObjectionRaised, Outcome, CreatedBy)
  SELECT @l, MutationId, '2026-08-21', N'No', N'(Demo) No objection; mutation allowed', @u FROM dbo.LegalMutation WHERE LandId = @l;
  INSERT INTO dbo.LegalMutationRecord (LandId, MutationId, NewLrKhatianNo, NewLrDagNo, RecordedHolder, NewSharePct, UpdatedArea, AreaUnitId, RorDate, MutationOrderNo, MutationOrderDate, RorFileId, VerificationStatus, VerifiedBy, VerifiedAt, CreatedBy)
  SELECT @l, MutationId, N'5120', N'2210', N'Rajwada Infra Developers Pvt Ltd', 100, 3, @kat, '2026-09-02', N'DEMO-ORD-889', '2026-08-28', (SELECT id FROM @f WHERE n = N'SAMPLE-New-RoR-Jadavpur.pdf'), N'Verified', @u, SYSUTCDATETIME(), @u
  FROM dbo.LegalMutation WHERE LandId = @l;

  -- Steps 27–29: final checks, settlement, register.
  INSERT INTO dbo.LegalFinalCheck (LandId, CheckItem, Result, CheckedBy, CheckedAt, Remarks, CreatedBy)
  SELECT @l, j.value, N'Confirmed', @u, SYSUTCDATETIME(), N'(Demo)', @u FROM OPENJSON(N'["Registered deed uploaded and approved","Ownership transfer recorded","Mutation application status recorded","New Khatian / RoR uploaded where applicable","Identity and ownership documents verified","Legal documents verified","Purchase / sale financial records reconciled","Outstanding blocking issues resolved","Final checklist completed"]') j;
  INSERT INTO dbo.LegalSettlement (LandId, TransactionId, AgreementValue, TotalPaid, RemainingBalance, AdvocateFees, RegistrationCharges, SettlementDate, SettlementStatus, ApprovedBy, ApprovedAt, Remarks, CreatedBy)
  VALUES (@l, @txn, 7200000, 7200000, 0, 12000, 504000, '2026-09-05', N'Approved', @u, DATEADD(minute, -5, SYSUTCDATETIME()), N'(Demo) Fully paid', @u);
  INSERT INTO dbo.LegalLandRegisterSnapshot (LandId, SnapshotJson, Remarks, CreatedBy)
  VALUES (@l, N'{"landCode":"' + @code + N'","owners":[{"name":"Rajwada Infra Developers Pvt Ltd","sharePct":100}],"mutationStatus":"Approved (order DEMO-ORD-889)","settlementStatus":"Approved"}', N'(Demo) After settlement', @u);

  -- All 31 steps done (Audit Trail & Reports needs no record of its own).
  INSERT INTO dbo.LegalWorkflowStepState (LandId, StepCode, Status, ResponsibleUserId, Remarks, UpdatedBy)
  SELECT @l, s.StepCode, N'Completed', @u, N'(Demo) Completed example', @u FROM dbo.LegalWorkflowStep s WHERE s.IsActive = 1;
  INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
  SELECT @l, StepCode, NULL, N'Completed', N'(Demo) sample data', @u FROM dbo.LegalWorkflowStep WHERE IsActive = 1;
  UPDATE dbo.LegalLand SET WorkflowStatus = N'Completed' WHERE LandId = @l;
  INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, Remarks) VALUES (@u, N'Transaction closed', N'Land Property', @l, @l, N'(Demo) sample data');
END;
GO

PRINT '602-legal-phase6-demo-data applied successfully.';
GO
