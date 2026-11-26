-- Legal: presentation data on every database (asked for, against the usual "no demo data" rule, for the live demo).
-- Four lands DEMO/00001–00004, one at each step of the route:
--   DEMO/00001  sent for verification, 4 sections ticked            → Approvals · Land verification
--   DEMO/00002  version 1 approved, deed sent for final approval    → Approvals · Deed approval
--   DEMO/00003  version 1 approved, survey added, verified          → Approvals · Versions
--   DEMO/00004  registered, versions 1–2, mutation, amendment asked → Approvals · Amendments
-- Runs once, only when no DEMO/ land exists. Versions and ticks are placeholders the app completes the first time each
-- land is opened (landFlow.js healPlaceholders). Remove later: delete the DEMO/ lands and their rows.
IF NOT EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandCode LIKE N'DEMO/%')
   AND EXISTS (SELECT 1 FROM dbo.LegalDistrict)
BEGIN
  SET NOCOUNT ON;
  BEGIN TRY
  BEGIN TRAN;
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
  DECLARE @Own INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type'));
  DECLARE @Tr INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'transfer-type' AND Name LIKE N'%Sale%'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'transfer-type'));
  DECLARE @Mort INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'mortgage-type' AND Name LIKE N'%Bank%'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'mortgage-type'));
  DECLARE @CaseT INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'case-type' AND Name LIKE N'%Civil%'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'case-type'));
  DECLARE @CaseS INT = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'legal-status' AND Name LIKE N'%Dispos%'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'legal-status'));
  DECLARE @DocT INT = COALESCE((SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName LIKE N'%Deed%'), (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType ORDER BY DocTypeId));
  DECLARE @DocT2 INT = COALESCE((SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName LIKE N'%Khatian%' OR DocTypeName LIKE N'%Porcha%'), @DocT);
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();

  -- Two sample files (a one-page PDF).
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) VALUES (N'sample_sale_deed.pdf', N'application/pdf', 393, N'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4+Pj4+Pj5lbmRvYmoKNCAwIG9iajw8L0xlbmd0aCA3ND4+c3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3NjAgVGQgKFNhbXBsZSBkb2N1bWVudCAtIHByZXNlbnRhdGlvbiBkYXRhKSBUaiBFVAplbmRzdHJlYW0gZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK', @U);
  DECLARE @F1 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) VALUES (N'sample_record_copy.pdf', N'application/pdf', 393, N'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4+Pj4+Pj5lbmRvYmoKNCAwIG9iajw8L0xlbmd0aCA3ND4+c3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3NjAgVGQgKFNhbXBsZSBkb2N1bWVudCAtIHByZXNlbnRhdGlvbiBkYXRhKSBUaiBFVAplbmRzdHJlYW0gZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK', @U);
  DECLARE @F2 INT = SCOPE_IDENTITY();

  -- The four lands.
  DECLARE @L1 INT, @L2 INT, @L3 INT, @L4 INT;
  INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, ProjectId, LocationAddress, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo,
      WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, PossessionStatus, CreatedBy, CreatedAt)
    VALUES (N'DEMO/00001/2026-27', N'Rajarhat main road, north plot', @Dist, @M1, 5, @Katha, N'Identified', N'Existing / Backlog', @P1, N'Rajarhat main road, north plot', N'418', N'1376', N'94', N'2215',
      N'Draft (Verification Pending)', N'Draft', N'Pending', N'Pending', 0, 1, N'In Possession', @U, DATEADD(DAY, -30, @Now));
  SET @L1 = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, ProjectId, LocationAddress, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo,
      WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, PossessionStatus, CreatedBy, CreatedAt, FinalVerifiedBy, FinalVerifiedAt, DeedTargetDate, DeedFileId, DeedApprovalRequestedAt, DeedApprovalRequestedBy)
    VALUES (N'DEMO/00002/2026-27', N'Chowmatha junction plot, Rajarhat', @Dist, @M1, 7, @Katha, N'Identified', N'New Acquisition', @P1, N'Chowmatha junction, Rajarhat', N'425', N'1389', N'97', N'2241',
      N'Deed Process', N'Verified', N'Pending', N'Pending', 0, 1, N'In Possession', @U, DATEADD(DAY, -45, @Now), @U, DATEADD(DAY, -10, @Now), CAST(DATEADD(DAY, 20, @Now) AS DATE), @F1, @Now, @U);
  SET @L2 = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, ProjectId, LocationAddress, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo,
      WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, PossessionStatus, CreatedBy, CreatedAt, FinalVerifiedBy, FinalVerifiedAt, DeedFileId, L1ReviewerId, L1ReviewedAt, L2ApproverId, L2ApprovedAt, RegAppliedBy, RegAppliedAt)
    VALUES (N'DEMO/00003/2026-27', N'Kadampukur canal road', @Dist, @M2, 8, @Katha, N'Identified', N'New Acquisition', @P2, N'Canal road, Kadampukur', N'149', N'588', N'84', N'915',
      N'Deed Registration', N'Verified', N'Approved', N'Approved', 0, 1, N'In Possession', @U, DATEADD(DAY, -70, @Now), @U, DATEADD(DAY, -40, @Now), @F1, @U, DATEADD(DAY, -20, @Now), @U, DATEADD(DAY, -20, @Now), @U, DATEADD(DAY, -5, @Now));
  SET @L3 = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, ProjectId, LocationAddress, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo,
      WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, PossessionStatus, CreatedBy, CreatedAt, FinalVerifiedBy, FinalVerifiedAt, DeedFileId, L1ReviewerId, L1ReviewedAt, L2ApproverId, L2ApprovedAt,
      RegAppliedBy, RegAppliedAt, RegFinalDate, RegDeedNo, RegDeedFileId, RegCompletedBy, RegCompletedAt)
    VALUES (N'DEMO/00004/2026-27', N'Kadampukur market back plot', @Dist, @M2, 6, @Katha, N'Owned', N'New Acquisition', @P2, N'Behind the market, Kadampukur', N'140', N'571', N'80', N'902',
      N'Registered', N'Verified', N'Approved', N'Approved', 0, 1, N'In Possession', @U, DATEADD(DAY, -90, @Now), @U, DATEADD(DAY, -60, @Now), @F1, @U, DATEADD(DAY, -45, @Now), @U, DATEADD(DAY, -45, @Now),
      @U, DATEADD(DAY, -30, @Now), CAST(DATEADD(DAY, -25, @Now) AS DATE), N'I-1504-08812/2026', @F1, @U, DATEADD(DAY, -25, @Now));
  SET @L4 = SCOPE_IDENTITY();

  -- RS / LR records and owners of each land.
  INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy)
    SELECT LandId, MouzaId, RsKhatianNo, RsDagNo, N'Nitai Sarkar', Area, AreaUnitId, 1, @U FROM dbo.LegalLand WHERE LandId IN (@L1, @L2, @L3, @L4);
  INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy)
    SELECT LandId, MouzaId, LrKhatianNo, LrDagNo, N'Bimal Sarkar & Kamal Sarkar', Area, AreaUnitId, 1, @U FROM dbo.LegalLand WHERE LandId IN (@L1, @L2, @L3, @L4);
  INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy)
    SELECT LandId, N'Bimal Sarkar', N'Late Nitai Sarkar', @Own, 50, '2004-05-10', 1, @U FROM dbo.LegalLand WHERE LandId IN (@L1, @L2, @L3, @L4)
    UNION ALL SELECT LandId, N'Kamal Sarkar', N'Late Nitai Sarkar', @Own, 50, '2004-05-10', 1, @U FROM dbo.LegalLand WHERE LandId IN (@L1, @L2, @L3, @L4);

  -- Two documents each (sale deed, record copy), file version 1, verified.
  INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, CurrentVersionNo, IsActive, CreatedBy)
    SELECT N'DEMO-DOC-' + CAST(LandId AS NVARCHAR(10)) + N'-1', LandId, @DocT, N'Ownership', N'Previous sale deed', N'I-2210/2004', 1, 1, @U FROM dbo.LegalLand WHERE LandId IN (@L1, @L2, @L3, @L4)
    UNION ALL SELECT N'DEMO-DOC-' + CAST(LandId AS NVARCHAR(10)) + N'-2', LandId, @DocT2, N'Property', N'LR record copy (porcha)', LrKhatianNo, 1, 1, @U FROM dbo.LegalLand WHERE LandId IN (@L1, @L2, @L3, @L4);
  INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, ReviewStatus, UploadedBy)
    SELECT DocumentId, 1, CASE WHEN DocumentCode LIKE N'%-1' THEN @F1 ELSE @F2 END, N'Verified', @U FROM dbo.LegalLandDocument WHERE LandId IN (@L1, @L2, @L3, @L4);

  -- Earlier transfer (the chain), one per land; DEMO/00001 leaves the deed number blank on purpose.
  INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerName, NewOwnerName, DeedNo, RegistrationDate, TransferArea, AreaUnitId, TransferSharePct, TransferValue, DocFileId, IsActive)
    VALUES (@L1, @Tr, '2004-05-10', N'Haripada Sarkar', N'Bimal Sarkar & Kamal Sarkar', NULL, NULL, 5, @Katha, 100, 1500000, @F1, 1),
           (@L2, @Tr, '1998-02-20', N'Nitai Das', N'Gopal Das', N'I-1204/1998', '1998-02-20', 7, @Katha, 100, 900000, @F1, 1),
           (@L3, @Tr, '2001-11-03', N'Ramesh Mondal', N'Suresh Mondal', N'I-3310/2001', '2001-11-03', 8, @Katha, 100, 1200000, @F1, 1),
           (@L4, @Tr, '1995-07-14', N'Abdul Karim', N'Rahim Karim', N'I-0977/1995', '1995-07-14', 6, @Katha, 100, 700000, @F1, 1);

  -- Tax, survey and the rest.
  INSERT INTO dbo.LegalLandTax (LandId, TaxYear, PaymentDate, Amount, ReceiptNo, RelatedOwner, ReceiptFileId, IsActive) VALUES
    (@L2, N'2024-25', '2024-06-15', 1850, N'KH/2024/02', N'Company', @F2, 1),
    (@L3, N'2025-26', '2025-06-15', 2100, N'KH/2025/03', N'Company', @F2, 1),
    (@L4, N'2025-26', '2025-06-15', 2400, N'KH/2025/04', N'Company', @F2, 1);
  INSERT INTO dbo.LegalLandTax (LandId, TaxYear, PaymentDate, Amount, ReceiptNo, RelatedOwner, ReceiptFileId, IsActive) VALUES (@L4, N'2026-27', '2026-06-15', 2400, N'KH/2026/04', N'Company', @F2, 1);
  DECLARE @Tax4 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, ValuationFileId, Surveyor, SurveyDate, BoundaryFindings, IsActive) VALUES
    (@L2, '2026-08-01', 7, @Katha, 450000, 3150000, 2520000, N'Govt. valuer + site survey', @F2, N'S. Ghosh, Licensed Surveyor', '2026-08-01', N'Boundary pillars found on all four sides; matches the RS map.', 1),
    (@L4, '2026-09-10', 6, @Katha, 520000, 3120000, 2496000, N'Govt. valuer + site survey', @F2, N'S. Ghosh, Licensed Surveyor', '2026-09-10', N'Boundary matches the RS map.', 1);
  INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, ValuationFileId, Surveyor, SurveyDate, BoundaryFindings, IsActive)
    VALUES (@L3, '2026-10-20', 8, @Katha, 480000, 3840000, 3072000, N'Govt. valuer + site survey', @F2, N'S. Ghosh, Licensed Surveyor', '2026-10-20', N'Boundary pillars found; canal side setback noted.', 1);
  DECLARE @Val3 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalMortgage (LandId, LenderName, BorrowerName, MortgageTypeId, LoanAmount, OutstandingAmount, LoanStartDate, LoanEndDate, LoanStatus, LoanClosureDate, MortgageDeedNo, ClearanceDate, ReleaseDocFileId, MortgageStatus, CheckedOn, IsActive)
    VALUES (@L4, N'State Bank of India, Rajarhat', N'Rahim Karim', @Mort, 800000, 0, '2010-04-01', '2020-03-31', N'Closed', '2020-03-15', N'M-221/2010', '2020-04-02', @F1, N'Loan Closed', '2026-09-01', 1);
  INSERT INTO dbo.LegalCase (LandId, CaseNumber, CaseTypeId, CourtName, FilingDate, Plaintiff, Defendant, CaseSubject, LegalStatusId, CaseResult, StayType, DocFileId, IsActive)
    VALUES (@L4, N'T.S. 114/2012', @CaseT, N'Civil Judge (Jr. Div.), Barasat', '2012-03-05', N'Karim family', N'Neighbour (east)', N'Boundary dispute on the east side.', @CaseS, N'Decreed for the Karim family; boundary fixed by survey.', N'None', @F2, 1);
  IF COL_LENGTH('dbo.LegalCase', 'ClearedAt') IS NOT NULL
    EXEC sp_executesql N'UPDATE dbo.LegalCase SET ClearedAt = SYSUTCDATETIME(), ClearedBy = @U, ClearRemarks = N''Decree in favour — case closed'' WHERE LandId = @L', N'@U INT, @L INT', @U = @U, @L = @L4;
  INSERT INTO dbo.LegalLandPhoto (LandId, Caption, PhotoFileId, TakenOn, IsActive) VALUES (@L4, N'Front view from the market road', @F2, '2026-09-10', 1);
  INSERT INTO dbo.LegalRegisteredDeed (LandId, DeedId, RegisteredDeedNo, RegistrationDate, DeedFileId, CertifiedCopyStatus, ApprovalStatus, ApprovedAt, IsActive, CreatedBy)
    VALUES (@L4, NULL, N'I-1504-08812/2026', CAST(DATEADD(DAY, -25, @Now) AS DATE), @F1, N'Not Applied', N'Approved', DATEADD(DAY, -25, @Now), 1, @U);
  DECLARE @Reg4 INT = SCOPE_IDENTITY();
  INSERT INTO dbo.LegalMutation (LandId, RegisteredDeedId, ApplicationNo, ApplicationDate, OfficeName, PreviousKhatian, PreviousOwner, NewOwner, ApplicationStatus, IsActive)
    VALUES (@L4, @Reg4, N'MUT/2026/4471', '2026-10-05', N'BL&LRO Rajarhat', N'LR-902', N'Rahim Karim', N'Company', N'Submitted', 1);

  -- Versions (placeholders completed by the app) and reviews.
  DECLARE @At NVARCHAR(30) = CONVERT(NVARCHAR(30), @Now, 127);
  INSERT INTO dbo.LegalLandRegisterSnapshot (LandId, SnapshotJson, Remarks, CreatedBy, CreatedAt) VALUES
    (@L2, N'{"rebuild":true,"exclude":[]}', N'Version 1 approved — Land review approved', @U, DATEADD(DAY, -10, @Now)),
    (@L3, N'{"rebuild":true,"exclude":[["valuation",' + CAST(@Val3 AS NVARCHAR(10)) + N']]}', N'Version 1 approved — Land review approved', @U, DATEADD(DAY, -40, @Now)),
    (@L4, N'{"rebuild":true,"exclude":[["land-tax",' + CAST(@Tax4 AS NVARCHAR(10)) + N']]}', N'Version 1 approved — Land review approved', @U, DATEADD(DAY, -60, @Now)),
    (@L4, N'{"rebuild":true,"exclude":[]}', N'Version 2 approved — Land review approved', @U, DATEADD(DAY, -3, @Now));
  INSERT INTO dbo.LegalLandReview (LandId, VersionNo, Status, ChecksJson, EntrySubmittedBy, EntrySubmittedAt, SubmittedBy, SubmittedAt, DecidedBy, DecidedAt, Remarks) VALUES
    (@L2, 1, N'Approved', N'{"*all":{"hash":"*","by":"Verifier","at":"' + @At + N'"}}', @U, DATEADD(DAY, -12, @Now), @U, DATEADD(DAY, -11, @Now), @U, DATEADD(DAY, -10, @Now), N'First verification — all sections checked'),
    (@L3, 1, N'Approved', N'{"*all":{"hash":"*","by":"Verifier","at":"' + @At + N'"}}', @U, DATEADD(DAY, -42, @Now), @U, DATEADD(DAY, -41, @Now), @U, DATEADD(DAY, -40, @Now), N'First verification — all sections checked'),
    (@L4, 1, N'Approved', N'{"*all":{"hash":"*","by":"Verifier","at":"' + @At + N'"}}', @U, DATEADD(DAY, -62, @Now), @U, DATEADD(DAY, -61, @Now), @U, DATEADD(DAY, -60, @Now), N'First verification — all sections checked'),
    (@L4, 2, N'Approved', N'{"*all":{"hash":"*","by":"Verifier","at":"' + @At + N'"}}', @U, DATEADD(DAY, -5, @Now), @U, DATEADD(DAY, -4, @Now), @U, DATEADD(DAY, -3, @Now), N'Tax receipt verified'),
    (@L3, 2, N'Submitted', N'{"*all":{"hash":"*","by":"Verifier","at":"' + @At + N'"}}', @U, @Now, @U, @Now, NULL, NULL, N'Survey report checked against the RS map'),
    (@L1, 1, N'Verifying', N'{"basic":{"hash":"*","by":"Verifier","at":"' + @At + N'"},"ownership":{"hash":"*","by":"Verifier","at":"' + @At + N'"},"acquisition":{"hash":"*","by":"Verifier","at":"' + @At + N'"},"records":{"hash":"*","by":"Verifier","at":"' + @At + N'"}}',
      @U, @Now, NULL, NULL, NULL, NULL, N'All old-file papers entered');
  INSERT INTO dbo.LegalLandAmendment (LandId, AmendmentNo, AmendType, Reason, ChangesJson, ReferenceNo, Status, RequestedBy)
    VALUES (@L4, 1, N'Mutation / LR record update', N'Mutation order received — LR Khatian changes to the company name; update LR record and owners.', N'[]', N'MUT/2026/4471', N'Pending', @U);
  COMMIT;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
  END CATCH
END
GO
