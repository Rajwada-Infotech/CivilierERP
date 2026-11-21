-- Legal: wipe every Legal land and enquiry (all their records) and load a fresh presentation set — asked for, as all
-- Legal data on every database is dummy. Setup lists (districts, mouzas, document types, lookups, Approval Control,
-- offices, persons…) are kept. One example at every step of the route:
--   Enquiries     ENQ-DEMO-0001 New · 0002 Under Review (office searches) · 0003 Interested · 0004–0008 converted to lands
--   DEMO/00001  Draft — sent for verification; verifier part way (✓ / ✗ / N/A, some pending) → Approvals · Land verification
--   DEMO/00002  Draft — sent back by the verifier: 2 fields ✗ to correct (shown on the land page)
--   DEMO/00003  Draft — verified, version 1 saved                                       → Approvals · Land approval
--   DEMO/00004  Deed Process — deed copy uploaded, sent for final approval              → Approvals · Deed approval
--   DEMO/00005  Deed Registration — versions 1–2 (survey added), applied for registration
--   DEMO/00006  Registered — versions 1–3 (v3 = registration), mortgage, court case, mutation; amendment asked → Amendments
-- Versions and field marks are completed by the app the first time each land is opened (landFlow.js healPlaceholders).
SET NOCOUNT ON;
BEGIN TRY
BEGIN TRAN;
-- ── 1. Wipe ──
DECLARE @keep TABLE (n SYSNAME);
INSERT @keep VALUES (N'LegalAreaUnit'),(N'LegalChecklistItem'),(N'LegalChecklistTemplate'),(N'LegalDeedType'),(N'LegalDistrict'),(N'LegalDocumentType'),(N'LegalLawReference'),(N'LegalLookupValue'),(N'LegalRegistrationOfficeType'),(N'LegalRegistryOfficeSla'),(N'LegalRuleConfig'),(N'LegalStatusReason'),(N'LegalSuccessionRule'),(N'LegalWorkflowStep'),(N'LegalApprovalAuthority'),(N'LegalPortalLink'),(N'LegalPortalApi'),(N'LegalRegistrationOffice'),(N'LegalMouza'),(N'LegalBlock'),(N'LegalMunicipality'),(N'LegalPoliceStation'),(N'LegalSubDivision'),(N'LegalVillage'),(N'LegalMasterFile'),(N'LegalTaskType'),(N'LegalReminderSla'),(N'LegalApprovalWorkflow'),(N'LegalAdvocate'),(N'LegalPerson'),(N'LegalParty'),(N'LegalRsKhatian'),(N'LegalRsPlot'),(N'LegalLrRor'),(N'LegalLandType'),(N'LegalInstalmentTemplate'),(N'LegalPartyPersonMap');
IF COL_LENGTH('dbo.LegalLand', 'EnquiryId') IS NOT NULL EXEC('UPDATE dbo.LegalLand SET EnquiryId = NULL');
IF COL_LENGTH('dbo.LegalLandEnquiry', 'LandId') IS NOT NULL EXEC('UPDATE dbo.LegalLandEnquiry SET LandId = NULL');
IF COL_LENGTH('dbo.LegalRsPlot', 'LandId') IS NOT NULL EXEC('UPDATE dbo.LegalRsPlot SET LandId = NULL');
DECLARE @t TABLE (n SYSNAME, done BIT);
INSERT @t SELECT name, 0 FROM sys.tables WHERE name LIKE N'Legal%' AND name NOT IN (SELECT n FROM @keep);
DECLARE @pass INT = 0, @n SYSNAME;
WHILE @pass < 25 AND EXISTS (SELECT 1 FROM @t WHERE done = 0)
BEGIN
  SET @pass += 1;
  DECLARE wc CURSOR LOCAL FAST_FORWARD FOR SELECT n FROM @t WHERE done = 0;
  OPEN wc; FETCH NEXT FROM wc INTO @n;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    BEGIN TRY EXEC(N'DELETE FROM dbo.[' + @n + N']'); UPDATE @t SET done = 1 WHERE n = @n; END TRY BEGIN CATCH END CATCH;
    FETCH NEXT FROM wc INTO @n;
  END
  CLOSE wc; DEALLOCATE wc;
END
IF EXISTS (SELECT 1 FROM @t WHERE done = 0)
BEGIN
  DECLARE @left NVARCHAR(MAX) = (SELECT STRING_AGG(n, N', ') FROM @t WHERE done = 0);
  RAISERROR(N'Could not clear: %s', 16, 1, @left);
END

-- ── 2. References (found by name on this database) ──
IF EXISTS (SELECT 1 FROM dbo.LegalDistrict)
BEGIN
  DECLARE @U INT = COALESCE((SELECT TOP 1 u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE r.RName LIKE N'%Super%' AND ISNULL(u.discontinue, 0) = 0 ORDER BY u.id), (SELECT TOP 1 id FROM dbo.users ORDER BY id));
  DECLARE @Dist INT = COALESCE((SELECT TOP 1 DistrictId FROM dbo.LegalDistrict WHERE DistrictName LIKE N'%North 24%'), (SELECT TOP 1 DistrictId FROM dbo.LegalDistrict ORDER BY DistrictId));
  DECLARE @DistName NVARCHAR(150) = (SELECT DistrictName FROM dbo.LegalDistrict WHERE DistrictId = @Dist);
  DECLARE @Katha INT = COALESCE((SELECT TOP 1 AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitName = N'Katha'), (SELECT TOP 1 AreaUnitId FROM dbo.LegalAreaUnit ORDER BY AreaUnitId));
  DECLARE @P1 INT = (SELECT TOP 1 id FROM dbo.enterprise WHERE business_type = 'P' ORDER BY id);
  DECLARE @P2 INT = COALESCE((SELECT id FROM dbo.enterprise WHERE business_type = 'P' ORDER BY id OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY), @P1);
  DECLARE @M1 INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Rajarhat');
  IF @M1 IS NULL BEGIN INSERT INTO dbo.LegalMouza (MouzaName, JLNo, District) VALUES (N'Rajarhat', N'105', ISNULL(@DistName, N'North 24 Parganas')); SET @M1 = SCOPE_IDENTITY(); END
  DECLARE @M2 INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Kadampukur');
  IF @M2 IS NULL BEGIN INSERT INTO dbo.LegalMouza (MouzaName, JLNo, District) VALUES (N'Kadampukur', N'27', ISNULL(@DistName, N'North 24 Parganas')); SET @M2 = SCOPE_IDENTITY(); END
  IF COL_LENGTH('dbo.LegalMouza', 'DistrictId') IS NOT NULL
    EXEC sp_executesql N'UPDATE dbo.LegalMouza SET DistrictId = @D WHERE MouzaId IN (@A, @B) AND DistrictId IS NULL', N'@D INT, @A INT, @B INT', @D = @Dist, @A = @M1, @B = @M2;
  DECLARE @L TABLE (k INT PRIMARY KEY, id INT);
  DECLARE @lk TABLE (cat NVARCHAR(60), pat NVARCHAR(60), id INT);
  INSERT @lk (cat, pat) VALUES (N'ownership-type', N'Joint'), (N'transfer-type', N'%Sale%'), (N'mortgage-type', N'%Bank%'), (N'case-type', N'%Civil%'), (N'legal-status', N'%Dispos%'),
    (N'enquiry-source', N'%Broker%'), (N'payment-mode', N'%Bank%'), (N'registration-mode', N'%'), (N'txn-type', N'%Advance%'), (N'fee-type', N'%Stamp%');
  UPDATE x SET id = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue v WHERE v.Category = x.cat AND v.Name LIKE x.pat ORDER BY LookupId),
                             (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue v WHERE v.Category = x.cat ORDER BY LookupId)) FROM @lk x;
  DECLARE @Own INT = (SELECT id FROM @lk WHERE cat = N'ownership-type'), @Tr INT = (SELECT id FROM @lk WHERE cat = N'transfer-type'),
          @Mort INT = (SELECT id FROM @lk WHERE cat = N'mortgage-type'), @CaseT INT = (SELECT id FROM @lk WHERE cat = N'case-type'),
          @CaseS INT = (SELECT id FROM @lk WHERE cat = N'legal-status'), @Src INT = (SELECT id FROM @lk WHERE cat = N'enquiry-source'),
          @PayM INT = (SELECT id FROM @lk WHERE cat = N'payment-mode'), @RegM INT = (SELECT id FROM @lk WHERE cat = N'registration-mode'),
          @Adv INT = (SELECT id FROM @lk WHERE cat = N'txn-type'), @Fee INT = (SELECT id FROM @lk WHERE cat = N'fee-type');
  DECLARE @Final INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name LIKE N'%Final%'), @Adv);
  DECLARE @RegFee INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'fee-type' AND Name LIKE N'%Registration%'), @Fee);
  DECLARE @Office INT = (SELECT TOP 1 OfficeId FROM dbo.LegalRegistrationOffice ORDER BY OfficeId);
  DECLARE @DocT INT = COALESCE((SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName LIKE N'%Deed%'), (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType ORDER BY DocTypeId));
  DECLARE @DocT2 INT = COALESCE((SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName LIKE N'%Khatian%' OR DocTypeName LIKE N'%Porcha%'), @DocT);
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @At NVARCHAR(30) = CONVERT(NVARCHAR(30), @Now, 127);

  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) VALUES (N'sample_sale_deed.pdf', N'application/pdf', 393, N'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4+Pj4+Pj5lbmRvYmoKNCAwIG9iajw8L0xlbmd0aCA3ND4+c3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3NjAgVGQgKFNhbXBsZSBkb2N1bWVudCAtIHByZXNlbnRhdGlvbiBkYXRhKSBUaiBFVAplbmRzdHJlYW0gZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK', @U);
  DECLARE @F1 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) VALUES (N'sample_record_copy.pdf', N'application/pdf', 393, N'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4+Pj4+Pj5lbmRvYmoKNCAwIG9iajw8L0xlbmd0aCA3ND4+c3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3NjAgVGQgKFNhbXBsZSBkb2N1bWVudCAtIHByZXNlbnRhdGlvbiBkYXRhKSBUaiBFVAplbmRzdHJlYW0gZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK', @U);
  DECLARE @F2 INT = SCOPE_IDENTITY();

  -- ── 3. Enquiries ──
  -- [no, location, mouza, project, rsDag, lrDag, rsKh, lrKh, area, price, status, days ago]
  DECLARE @E TABLE (k INT, no NVARCHAR(30), loc NVARCHAR(200), m INT, p INT, rd NVARCHAR(20), ld NVARCHAR(20), rk NVARCHAR(20), lk NVARCHAR(20), area DECIMAL(9,2), price DECIMAL(14,2), st NVARCHAR(40), ago INT, id INT NULL);
  INSERT @E (k, no, loc, m, p, rd, ld, rk, lk, area, price, st, ago) VALUES
    (1, N'ENQ-DEMO-0001', N'Greens phase 2 — east corner, Rajarhat', @M1, @P1, N'441', N'1410', N'221', N'2290', 6, 3600000, N'New', 1),
    (2, N'ENQ-DEMO-0002', N'Behind Rajarhat bus depot', @M1, @P1, N'452', N'1433', N'226', N'2302', 4, 2600000, N'Under Review', 12),
    (3, N'ENQ-DEMO-0003', N'Kadampukur bus stand, east side', @M2, @P2, N'157', N'602', N'88', N'941', 5, 3100000, N'Interested', 6),
    (4, N'ENQ-DEMO-0004', N'Greens phase 1 — canal side', @M1, @P1, N'433', N'1402', N'219', N'2264', 8, 4800000, N'Converted to Land Record', 60),
    (5, N'ENQ-DEMO-0005', N'Chowmatha junction plot, Rajarhat', @M1, @P1, N'425', N'1389', N'97', N'2241', 7, 4200000, N'Converted to Land Record', 70),
    (6, N'ENQ-DEMO-0006', N'Kadampukur canal road', @M2, @P2, N'149', N'588', N'84', N'915', 8, 4800000, N'Converted to Land Record', 80),
    (7, N'ENQ-DEMO-0007', N'Kadampukur school road', @M2, @P2, N'162', N'611', N'91', N'958', 10, 5500000, N'Converted to Land Record', 90),
    (8, N'ENQ-DEMO-0008', N'Kadampukur market back plot', @M2, @P2, N'140', N'571', N'80', N'902', 6, 3600000, N'Converted to Land Record', 120);
  DECLARE @k INT = 1;
  WHILE @k <= 8
  BEGIN
    INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId, ContactPerson, ContactNumber,
        ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy, CreatedAt)
      SELECT no, CAST(DATEADD(DAY, -ago, @Now) AS DATE), N'2026-27', @Src, loc, @Dist, m, CASE WHEN m = @M1 THEN N'105' ELSE N'27' END, area, @Katha, N'Seller contact', N'9830012345',
        price, @U, st, p, rd, ld, rk, lk, N'Presentation enquiry — ' + st + N'.', 1, @U, DATEADD(DAY, -ago, @Now) FROM @E WHERE k = @k;
    UPDATE @E SET id = SCOPE_IDENTITY() WHERE k = @k;
    SET @k += 1;
  END
  INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy) SELECT id, m, rk, rd, N'Nitai Sarkar', area, @Katha, @U FROM @E;
  INSERT INTO dbo.LegalEnquiryLrRecord (EnquiryId, MouzaId, LrKhatianNo, LrDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy) SELECT id, m, lk, ld, N'Bimal Sarkar & Kamal Sarkar', area, @Katha, @U FROM @E;
  -- Office search timelines for the enquiry under review (as saving an enquiry does).
  IF OBJECT_ID('dbo.LegalEnquiryOfficeSearch', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.LegalRegistrationOfficeType WHERE IsActive = 1)
    INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate)
      SELECT e.id, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear, DATEADD(DAY, t.SlaDays, CAST(DATEADD(DAY, -e.ago, @Now) AS DATE))
      FROM @E e CROSS JOIN dbo.LegalRegistrationOfficeType t WHERE e.k = 2 AND t.IsActive = 1;

  -- ── 4. Lands (DEMO/00001 is an old-file land; the rest come from the converted enquiries) ──
  -- [k, code, name, enquiry k, mouza, project, rsDag, lrDag, rsKh, lrKh, area, entry, workflow, verification, days ago]
  DECLARE @D TABLE (k INT, code NVARCHAR(40), name NVARCHAR(200), e INT, m INT, p INT, rd NVARCHAR(20), ld NVARCHAR(20), rk NVARCHAR(20), lk NVARCHAR(20), area DECIMAL(9,2), et NVARCHAR(30), wf NVARCHAR(60), vs NVARCHAR(20), ago INT);
  INSERT @D VALUES
    (1, N'DEMO/00001/2026-27', N'Rajarhat main road, north plot', NULL, @M1, @P1, N'418', N'1376', N'94', N'2215', 5, N'Existing / Backlog', N'Draft (Verification Pending)', N'Draft', 30),
    (2, N'DEMO/00002/2026-27', N'Greens phase 1 — canal side', 4, @M1, @P1, N'433', N'1402', N'219', N'2264', 8, N'New Acquisition', N'Draft (Verification Pending)', N'Draft', 50),
    (3, N'DEMO/00003/2026-27', N'Chowmatha junction plot, Rajarhat', 5, @M1, @P1, N'425', N'1389', N'97', N'2241', 7, N'New Acquisition', N'Draft (Verification Pending)', N'Verified', 60),
    (4, N'DEMO/00004/2026-27', N'Kadampukur canal road', 6, @M2, @P2, N'149', N'588', N'84', N'915', 8, N'New Acquisition', N'Deed Process', N'Verified', 75),
    (5, N'DEMO/00005/2026-27', N'Kadampukur school road', 7, @M2, @P2, N'162', N'611', N'91', N'958', 10, N'New Acquisition', N'Deed Registration', N'Verified', 85),
    (6, N'DEMO/00006/2026-27', N'Kadampukur market back plot', 8, @M2, @P2, N'140', N'571', N'80', N'902', 6, N'New Acquisition', N'Registered', N'Verified', 110);
  SET @k = 1;
  WHILE @k <= 6
  BEGIN
    INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, EnquiryId, ProjectId, LocationAddress, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo,
        WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, PossessionStatus, CreatedBy, CreatedAt)
      SELECT d.code, d.name, @Dist, d.m, d.area, @Katha, CASE WHEN d.wf = N'Registered' THEN N'Owned' ELSE N'Identified' END, d.et, (SELECT id FROM @E WHERE k = d.e), d.p, d.name + N', ' + ISNULL(@DistName, N''),
        d.rd, d.ld, d.rk, d.lk, d.wf, d.vs, N'Pending', N'Pending', 0, 1, N'In Possession', @U, DATEADD(DAY, -d.ago, @Now) FROM @D d WHERE d.k = @k;
    INSERT @L VALUES (@k, SCOPE_IDENTITY());
    SET @k += 1;
  END
  UPDATE e SET LandId = l.id FROM dbo.LegalLandEnquiry e JOIN @E x ON x.id = e.EnquiryId JOIN @D d ON d.e = x.k JOIN @L l ON l.k = d.k;
  DECLARE @L1 INT = (SELECT id FROM @L WHERE k = 1), @L2 INT = (SELECT id FROM @L WHERE k = 2), @L3 INT = (SELECT id FROM @L WHERE k = 3),
          @L4 INT = (SELECT id FROM @L WHERE k = 4), @L5 INT = (SELECT id FROM @L WHERE k = 5), @L6 INT = (SELECT id FROM @L WHERE k = 6);
  -- Pipeline details of the later lands.
  UPDATE dbo.LegalLand SET FinalVerifiedBy = @U, FinalVerifiedAt = DATEADD(DAY, -40, @Now) WHERE LandId IN (@L3, @L4, @L5, @L6);
  UPDATE dbo.LegalLand SET DeedTargetDate = CAST(DATEADD(DAY, 20, @Now) AS DATE), DeedFileId = @F1, DeedApprovalRequestedAt = @Now, DeedApprovalRequestedBy = @U WHERE LandId = @L4;
  UPDATE dbo.LegalLand SET DeedFileId = @F1, L1Status = N'Approved', L1ReviewerId = @U, L1ReviewedAt = DATEADD(DAY, -20, @Now), L2Status = N'Approved', L2ApproverId = @U, L2ApprovedAt = DATEADD(DAY, -20, @Now),
         RegAppliedBy = @U, RegAppliedAt = DATEADD(DAY, -5, @Now), ConsDate = CAST(DATEADD(DAY, -30, @Now) AS DATE), ConsTotalAmount = 5500000, ConsAdvanceAmount = 500000, ConsPaymentModeId = @PayM
    WHERE LandId = @L5;
  UPDATE dbo.LegalLand SET DeedFileId = @F1, L1Status = N'Approved', L1ReviewerId = @U, L1ReviewedAt = DATEADD(DAY, -45, @Now), L2Status = N'Approved', L2ApproverId = @U, L2ApprovedAt = DATEADD(DAY, -45, @Now),
         RegAppliedBy = @U, RegAppliedAt = DATEADD(DAY, -32, @Now), RegFinalDate = CAST(DATEADD(DAY, -25, @Now) AS DATE), RegOfficeId = @Office, RegModeId = @RegM, RegDeedNo = N'I-1504-08812/2026',
         RegDeedFileId = @F1, RegCompletedBy = @U, RegCompletedAt = DATEADD(DAY, -25, @Now),
         ConsDate = CAST(DATEADD(DAY, -50, @Now) AS DATE), ConsTotalAmount = 3600000, ConsAdvanceAmount = 600000, ConsPaymentModeId = @PayM
    WHERE LandId = @L6;

  -- RS / LR records, owners, documents and the earlier transfer of every land.
  INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy)
    SELECT l.id, d.m, d.rk, d.rd, N'Nitai Sarkar', d.area, @Katha, 1, @U FROM @D d JOIN @L l ON l.k = d.k;
  INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy)
    SELECT l.id, d.m, d.lk, d.ld, N'Bimal Sarkar & Kamal Sarkar', d.area, @Katha, 1, @U FROM @D d JOIN @L l ON l.k = d.k;
  INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy)
    SELECT id, N'Bimal Sarkar', N'Late Nitai Sarkar', @Own, 50, '2004-05-10', 1, @U FROM @L
    UNION ALL SELECT id, N'Kamal Sarkar', N'Late Nitai Sarkar', @Own, 50, '2004-05-10', 1, @U FROM @L;
  INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, CurrentVersionNo, IsActive, CreatedBy)
    SELECT N'DEMO-DOC-' + CAST(id AS NVARCHAR(10)) + N'-1', id, @DocT, N'Ownership', N'Previous sale deed', N'I-2210/2004', 1, 1, @U FROM @L
    UNION ALL SELECT N'DEMO-DOC-' + CAST(l.id AS NVARCHAR(10)) + N'-2', l.id, @DocT2, N'Property', N'LR record copy (porcha)', d.lk, 1, 1, @U FROM @L l JOIN @D d ON d.k = l.k;
  INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, ReviewStatus, UploadedBy)
    SELECT DocumentId, 1, CASE WHEN DocumentCode LIKE N'%-1' THEN @F1 ELSE @F2 END, N'Verified', @U FROM dbo.LegalLandDocument WHERE LandId IN (SELECT id FROM @L);
  INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, NewOwnerName, DeedNo, RegistrationDate, TransferArea, AreaUnitId, TransferSharePct, TransferValue, DocFileId, IsActive)
    SELECT l.id, @Tr, '2004-05-10', N'Haripada Sarkar', N'Bimal Sarkar & Kamal Sarkar', CASE WHEN l.k = 1 THEN NULL ELSE N'I-2210/2004' END, '2004-05-10', d.area, @Katha, 100, 1500000, @F1, 1
    FROM @L l JOIN @D d ON d.k = l.k;

  -- Tax, survey, loan, court case, photo, mutation, payments and fees.
  INSERT INTO dbo.LegalLandTax (LandId, TaxYear, PaymentDate, Amount, ReceiptNo, RelatedOwner, ReceiptFileId, IsActive)
    SELECT id, N'2025-26', '2025-06-15', 2100, N'KH/2025/' + CAST(id AS NVARCHAR(10)), N'Company', @F2, 1 FROM @L WHERE k >= 3;
  INSERT INTO dbo.LegalLandTax (LandId, TaxYear, PaymentDate, Amount, ReceiptNo, RelatedOwner, ReceiptFileId, IsActive) VALUES (@L6, N'2026-27', '2026-06-15', 2400, N'KH/2026/6', N'Company', @F2, 1);
  DECLARE @Tax6 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, ValuationFileId, Surveyor, SurveyDate, BoundaryFindings, IsActive) VALUES
    (@L4, '2026-08-01', 8, @Katha, 450000, 3600000, 2880000, N'Govt. valuer + site survey', @F2, N'S. Ghosh, Licensed Surveyor', '2026-08-01', N'Boundary pillars found on all four sides; matches the RS map.', 1),
    (@L6, '2026-09-10', 6, @Katha, 520000, 3120000, 2496000, N'Govt. valuer + site survey', @F2, N'S. Ghosh, Licensed Surveyor', '2026-09-10', N'Boundary matches the RS map.', 1);
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, ValuationFileId, Surveyor, SurveyDate, BoundaryFindings, IsActive)
    VALUES (@L5, '2026-10-20', 10, @Katha, 480000, 4800000, 3840000, N'Govt. valuer + site survey', @F2, N'S. Ghosh, Licensed Surveyor', '2026-10-20', N'Canal-side setback noted.', 1);
  DECLARE @Val5 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalMortgage (LandId, LenderName, BorrowerName, MortgageTypeId, LoanAmount, OutstandingAmount, LoanStartDate, LoanEndDate, LoanStatus, LoanClosureDate, MortgageDeedNo, ClearanceDate, ReleaseDocFileId, MortgageStatus, CheckedOn, IsActive)
    VALUES (@L6, N'State Bank of India, Rajarhat', N'Rahim Karim', @Mort, 800000, 0, '2010-04-01', '2020-03-31', N'Closed', '2020-03-15', N'M-221/2010', '2020-04-02', @F1, N'Loan Closed', '2026-09-01', 1);
  INSERT INTO dbo.LegalCase (LandId, CaseNumber, CaseTypeId, CourtName, FilingDate, Plaintiff, Defendant, CaseSubject, LegalStatusId, CaseResult, StayType, DocFileId, IsActive)
    VALUES (@L6, N'T.S. 114/2012', @CaseT, N'Civil Judge (Jr. Div.), Barasat', '2012-03-05', N'Karim family', N'Neighbour (east)', N'Boundary dispute on the east side.', @CaseS, N'Decreed for the Karim family; boundary fixed by survey.', N'None', @F2, 1);
  IF COL_LENGTH('dbo.LegalCase', 'ClearedAt') IS NOT NULL
    EXEC sp_executesql N'UPDATE dbo.LegalCase SET ClearedAt = SYSUTCDATETIME(), ClearedBy = @U, ClearRemarks = N''Decree in favour — case closed'' WHERE LandId = @L', N'@U INT, @L INT', @U = @U, @L = @L6;
  INSERT INTO dbo.LegalLandPhoto (LandId, Caption, PhotoFileId, TakenOn, IsActive) VALUES (@L6, N'Front view from the market road', @F2, '2026-09-10', 1);
  INSERT INTO dbo.LegalRegisteredDeed (LandId, DeedId, RegisteredDeedNo, RegistrationDate, RegistrationOfficeId, DeedFileId, CertifiedCopyStatus, ApprovalStatus, ApprovedAt, IsActive, CreatedBy)
    VALUES (@L6, NULL, N'I-1504-08812/2026', CAST(DATEADD(DAY, -25, @Now) AS DATE), @Office, @F1, N'Not Applied', N'Approved', DATEADD(DAY, -25, @Now), 1, @U);
  DECLARE @Reg6 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalMutation (LandId, RegisteredDeedId, ApplicationNo, ApplicationDate, OfficeName, PreviousKhatian, PreviousOwner, NewOwner, ApplicationStatus, IsActive)
    VALUES (@L6, @Reg6, N'MUT/2026/4471', '2026-10-05', N'BL&LRO Rajarhat', N'LR-902', N'Rahim Karim', N'Company', N'Submitted', 1);
  INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payer, Payee, TransactionRef, ReceiptNo, ReceiptFileId, IsActive) VALUES
    (@L5, CAST(DATEADD(DAY, -30, @Now) AS DATE), @Adv, 500000, @PayM, N'Company', N'Seller', N'NEFT-5501', N'R-5501', @F2, 1),
    (@L6, CAST(DATEADD(DAY, -50, @Now) AS DATE), @Adv, 600000, @PayM, N'Company', N'Seller', N'NEFT-6601', N'R-6601', @F2, 1),
    (@L6, CAST(DATEADD(DAY, -26, @Now) AS DATE), @Final, 3000000, @PayM, N'Company', N'Seller', N'NEFT-6602', N'R-6602', @F2, 1);
  IF OBJECT_ID('dbo.LegalStampDutyQuery', 'U') IS NOT NULL
    INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy) VALUES
      (@L6, CAST(DATEADD(DAY, -27, @Now) AS DATE), @Fee, 216000, N'Stamp duty (6%)', @U),
      (@L6, CAST(DATEADD(DAY, -27, @Now) AS DATE), @RegFee, 36000, N'Registration fee (1%)', @U);

  -- ── 5. Versions (placeholders the app completes) and verification ──
  INSERT INTO dbo.LegalLandRegisterSnapshot (LandId, SnapshotJson, Remarks, CreatedBy, CreatedAt) VALUES
    (@L3, N'{"rebuild":true,"exclude":[["registration","*"],["reg-consideration","*"],["reg-schedule","*"],["reg-payment","*"],["reg-paid","*"],["reg-duty","*"],["reg-fee","*"],["reg-fee-total","*"]]}', N'Version 1 approved — Land verified', @U, DATEADD(DAY, -2, @Now)),
    (@L4, N'{"rebuild":true,"exclude":[["registration","*"],["reg-consideration","*"],["reg-schedule","*"],["reg-payment","*"],["reg-paid","*"],["reg-duty","*"],["reg-fee","*"],["reg-fee-total","*"]]}', N'Version 1 approved — Land verified', @U, DATEADD(DAY, -40, @Now)),
    (@L5, N'{"rebuild":true,"exclude":[["valuation",' + CAST(@Val5 AS NVARCHAR(10)) + N'],["registration","*"],["reg-consideration","*"],["reg-schedule","*"],["reg-payment","*"],["reg-paid","*"],["reg-duty","*"],["reg-fee","*"],["reg-fee-total","*"]]}', N'Version 1 approved — Land verified', @U, DATEADD(DAY, -40, @Now)),
    (@L5, N'{"rebuild":true,"exclude":[["registration","*"],["reg-consideration","*"],["reg-schedule","*"],["reg-payment","*"],["reg-paid","*"],["reg-duty","*"],["reg-fee","*"],["reg-fee-total","*"]]}', N'Version 2 approved — Land verified', @U, DATEADD(DAY, -10, @Now)),
    (@L6, N'{"rebuild":true,"exclude":[["land-tax",' + CAST(@Tax6 AS NVARCHAR(10)) + N'],["registration","*"],["reg-consideration","*"],["reg-schedule","*"],["reg-payment","*"],["reg-paid","*"],["reg-duty","*"],["reg-fee","*"],["reg-fee-total","*"]]}', N'Version 1 approved — Land verified', @U, DATEADD(DAY, -60, @Now)),
    (@L6, N'{"rebuild":true,"exclude":[["registration","*"],["reg-consideration","*"],["reg-schedule","*"],["reg-payment","*"],["reg-paid","*"],["reg-duty","*"],["reg-fee","*"],["reg-fee-total","*"]]}', N'Version 2 approved — Land verified', @U, DATEADD(DAY, -35, @Now)),
    (@L6, N'{"rebuild":true,"exclude":[]}', N'Version 3 approved — Deed registered — I-1504-08812/2026', @U, DATEADD(DAY, -25, @Now));
  DECLARE @AllOk NVARCHAR(MAX) = N'{' + STUFF((SELECT N',"' + k + N'":{"auto":"ok","by":"Verifier","at":"' + @At + N'"}'
    FROM (VALUES (N'basic'),(N'ownership'),(N'acquisition'),(N'records'),(N'legal'),(N'loans'),(N'mutation'),(N'payments'),(N'tax'),(N'survey'),(N'documents'),(N'photos')) v(k)
    FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, N'') + N'}';
  INSERT INTO dbo.LegalLandReview (LandId, VersionNo, Status, ChecksJson, EntrySubmittedBy, EntrySubmittedAt, SubmittedBy, SubmittedAt, DecidedBy, DecidedAt, Remarks) VALUES
    (@L3, 1, N'Approved', @AllOk, @U, DATEADD(DAY, -3, @Now), @U, DATEADD(DAY, -2, @Now), @U, DATEADD(DAY, -2, @Now), N'All sections checked against the papers'),
    (@L4, 1, N'Approved', @AllOk, @U, DATEADD(DAY, -41, @Now), @U, DATEADD(DAY, -40, @Now), @U, DATEADD(DAY, -40, @Now), N'All sections checked against the papers'),
    (@L5, 1, N'Approved', @AllOk, @U, DATEADD(DAY, -41, @Now), @U, DATEADD(DAY, -40, @Now), @U, DATEADD(DAY, -40, @Now), N'All sections checked against the papers'),
    (@L5, 2, N'Approved', @AllOk, @U, DATEADD(DAY, -11, @Now), @U, DATEADD(DAY, -10, @Now), @U, DATEADD(DAY, -10, @Now), N'Survey report checked against the RS map'),
    (@L6, 1, N'Approved', @AllOk, @U, DATEADD(DAY, -61, @Now), @U, DATEADD(DAY, -60, @Now), @U, DATEADD(DAY, -60, @Now), N'All sections checked against the papers'),
    (@L6, 2, N'Approved', @AllOk, @U, DATEADD(DAY, -36, @Now), @U, DATEADD(DAY, -35, @Now), @U, DATEADD(DAY, -35, @Now), N'2026-27 tax receipt verified'),
    -- DEMO/00001: with the verifier, part way.
    (@L1, 1, N'Verifying', N'{"basic":{"auto":"ok","pending":["LocationAddress","LrDagNo"],"by":"Verifier","at":"' + @At + N'"},"ownership":{"auto":"ok","by":"Verifier","at":"' + @At + N'"},"acquisition":{"auto":"ok","bad":["TransferValue"],"by":"Verifier","at":"' + @At + N'"}}',
      @U, @Now, NULL, NULL, NULL, NULL, N'All old-file papers entered'),
    -- DEMO/00002: sent back with 2 fields ✗ (owner's father's name, the LR record holder).
    (@L2, 1, N'Returned', N'{"ownership":{"auto":"ok","bad":["OwnerGuardian"],"by":"Verifier","at":"' + @At + N'"},"records":{"auto":"ok","bad":["RecordedHolder"],"by":"Verifier","at":"' + @At + N'"}}',
      @U, DATEADD(DAY, -1, @Now), NULL, NULL, @U, @Now, N'Correct the fields marked ✗: Ownership History › Father / husband name; Land Records › Recorded holder');
  INSERT INTO dbo.LegalLandAmendment (LandId, AmendmentNo, AmendType, Reason, ChangesJson, ReferenceNo, Status, RequestedBy)
    VALUES (@L6, 1, N'Mutation / LR record update', N'Mutation order received — LR Khatian changes to the company name; update the LR record and owners.', N'[]', N'MUT/2026/4471', N'Pending', @U);
END
COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH
GO
