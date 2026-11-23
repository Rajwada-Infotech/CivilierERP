-- Legal presentation data: examples for every newer part of the module, on the DEMO records only (adds / updates; the
-- frozen versions, audit trail and decisions are only added to, never changed).
--   Enquiries     ENQ-DEMO-0009 Rejected (same plot as ENQ-DEMO-0001 → "Rejected before" + its History with the reason)
--   Deed search   ENQ-DEMO-0002: DSR 1991–1995 Under Review, RA Calcutta 1956–1960 Not Applicable
--   LA & ULC      DEMO/00004 LA query raised (with history), ULC not applicable · DEMO/00005 LA approved (valid till),
--                 ULC application submitted · DEMO/00006 both approved
--   Payments      DEMO/00005 instalment schedule, a pending payment and a failed cheque; stamp duty / fee entries
--                 DEMO/00006 a duplicate entry reversed (kept in history)
--   Deed copy     DEMO/00004 deed copy replaced once — both kept as versions
--   Documents     the sale deeds also belong to the Registration section
--   Post-reg      DEMO/00006 tasks assigned, some done, one overdue, plus "Land tax 2027-28"
--   Decisions     Land approval / Deed approval decisions (Approve, Hold, Send back) with reasons
IF EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandCode LIKE N'DEMO/%')
BEGIN
  SET NOCOUNT ON;
  DECLARE @U INT = COALESCE((SELECT TOP 1 u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE r.RName LIKE N'%Super%' AND ISNULL(u.discontinue, 0) = 0 ORDER BY u.id), (SELECT TOP 1 id FROM dbo.users ORDER BY id));
  DECLARE @U2 INT = COALESCE((SELECT TOP 1 id FROM dbo.users WHERE id <> @U AND ISNULL(discontinue, 0) = 0 ORDER BY id), @U);
  DECLARE @Now DATETIME2 = SYSUTCDATETIME(), @Today DATE = CAST(GETDATE() AS DATE);
  DECLARE @L2 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00002/2026-27'),
          @L3 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00003/2026-27'),
          @L4 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00004/2026-27'),
          @L5 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00005/2026-27'),
          @L6 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'DEMO/00006/2026-27');
  DECLARE @F1 INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'sample_sale_deed.pdf' ORDER BY FileId DESC),
          @F2 INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'sample_record_copy.pdf' ORDER BY FileId DESC);
  DECLARE @lk TABLE (cat NVARCHAR(60), nm NVARCHAR(60), id INT);
  INSERT @lk (cat, nm) VALUES (N'txn-type', N'Advance'), (N'txn-type', N'Purchase Payment'), (N'txn-type', N'Final Payment'),
    (N'payment-mode', N'%Cheque%'), (N'payment-mode', N'%Bank%'), (N'fee-type', N'Stamp Duty'), (N'fee-type', N'Registration Fee'), (N'enquiry-source', N'%');
  UPDATE x SET id = COALESCE((SELECT TOP 1 LookupId FROM dbo.LegalLookupValue v WHERE v.Category = x.cat AND v.Name LIKE x.nm ORDER BY LookupId),
                             (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue v WHERE v.Category = x.cat ORDER BY LookupId)) FROM @lk x;
  DECLARE @Adv INT = (SELECT id FROM @lk WHERE nm = N'Advance'), @Pur INT = (SELECT id FROM @lk WHERE nm = N'Purchase Payment'), @Fin INT = (SELECT id FROM @lk WHERE nm = N'Final Payment'),
          @Chq INT = (SELECT id FROM @lk WHERE nm = N'%Cheque%'), @Bank INT = (SELECT id FROM @lk WHERE nm = N'%Bank%'),
          @Stamp INT = (SELECT id FROM @lk WHERE nm = N'Stamp Duty'), @RegFee INT = (SELECT id FROM @lk WHERE nm = N'Registration Fee'), @Src INT = (SELECT id FROM @lk WHERE cat = N'enquiry-source');

  -- ── Enquiries: a rejected one for the same plot as ENQ-DEMO-0001, with its history ──
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'ENQ-DEMO-0009')
  BEGIN
    INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId, ContactPerson, ContactNumber,
        ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy, CreatedAt)
      SELECT N'ENQ-DEMO-0009', DATEADD(DAY, -150, e.EnquiryDate), N'2026-27', @Src, e.LandLocation + N' (offered earlier)', e.DistrictId, e.MouzaId, e.JLNo, e.ApproxArea, e.AreaUnitId, N'Another broker', N'9830099999',
        e.ExpectedPrice * 1.4, @U, N'Rejected', e.ProjectId, e.RsDagNo, e.LrDagNo, e.RsKhatianNo, e.LrKhatianNo,
        N'[' + CONVERT(char(10), DATEADD(DAY, -140, @Today), 23) + N'] Rejected: price far above market; seller could not show the chain deed.', 1, @U, DATEADD(DAY, -150, @Now)
      FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo = N'ENQ-DEMO-0001';
    DECLARE @E9 INT = SCOPE_IDENTITY();
    INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, OldValue, NewValue, Remarks, CreatedAt)
      VALUES (@U, N'Enquiry status changed', N'Land Enquiry', @E9, N'{"status":"Under Review"}', N'{"status":"Rejected"}', N'Price far above market; seller could not show the chain deed.', DATEADD(DAY, -140, @Now));
  END

  -- ── Deed search: Under Review and Not Applicable years on ENQ-DEMO-0002 ──
  DECLARE @E2 INT = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'ENQ-DEMO-0002');
  IF @E2 IS NOT NULL
  BEGIN
    ;WITH y AS (SELECT 1991 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < 1995)
    INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, Details, SiteName, RequestedBy, RequestedAt)
      SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Under Review', o.SlaDays, o.DueDate, N'Index volume asked for at the DSR office — waiting for the certified search copy.', N'DSR office (in person)', @U, @Now
      FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
      WHERE o.EnquiryId = @E2 AND o.OfficeType = N'DSR' AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.CalendarYear = y.Y);
    ;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < 1960)
    INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
      SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Applicable', o.SlaDays, o.DueDate, N'RA Calcutta holds no records for this area before 1961.', N'RA Calcutta', @U, @U, @Now
      FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
      WHERE o.EnquiryId = @E2 AND o.OfficeType = N'RA Calcutta' AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.CalendarYear = y.Y);
  END

  -- ── LA & ULC clearances, each step kept as an event ──
  DECLARE @C TABLE (LandId INT, Kind NVARCHAR(10), Status NVARCHAR(30), AppliedOn DATE, AppNo NVARCHAR(100), ObtainedOn DATE, CertNo NVARCHAR(100), Expiry DATE, Remarks NVARCHAR(500), FileId INT);
  INSERT @C VALUES
    (@L4, N'LA', N'Query Raised', DATEADD(DAY, -20, @Today), N'LA/APP/2026/118', NULL, NULL, NULL, N'Office asked for the 1998 sale deed and a mouza map copy.', NULL),
    (@L4, N'ULC', N'Not Applicable', NULL, NULL, NULL, NULL, NULL, N'Area below the ULC ceiling — not applicable.', NULL),
    (@L5, N'LA', N'Approved', DATEADD(DAY, -60, @Today), N'LA/APP/2026/071', DATEADD(DAY, -15, @Today), N'LA/NOC/2026/071', DATEADD(YEAR, 1, @Today), N'No acquisition notice on these Dags.', @F2),
    (@L5, N'ULC', N'Application Submitted', DATEADD(DAY, -10, @Today), N'ULC/APP/2026/033', NULL, NULL, NULL, NULL, NULL),
    (@L6, N'LA', N'Approved', DATEADD(DAY, -120, @Today), N'LA/APP/2026/012', DATEADD(DAY, -90, @Today), N'LA/NOC/2026/012', DATEADD(DAY, 275, @Today), NULL, @F2),
    (@L6, N'ULC', N'Approved', DATEADD(DAY, -120, @Today), N'ULC/APP/2026/009', DATEADD(DAY, -85, @Today), N'ULC/CERT/2026/009', NULL, NULL, @F2);
  MERGE dbo.LegalLandClearance AS t USING (SELECT * FROM @C WHERE LandId IS NOT NULL) AS s ON t.LandId = s.LandId AND t.Kind = s.Kind
  WHEN MATCHED THEN UPDATE SET Status = s.Status, AppliedOn = s.AppliedOn, ApplicationNo = s.AppNo, ObtainedOn = s.ObtainedOn, CertificateNo = s.CertNo, ExpiryDate = s.Expiry, Remarks = s.Remarks, FileId = s.FileId, UpdatedBy = @U, UpdatedAt = @Now
  WHEN NOT MATCHED THEN INSERT (LandId, Kind, Status, AppliedOn, ApplicationNo, ObtainedOn, CertificateNo, ExpiryDate, Remarks, FileId, UpdatedBy, UpdatedAt)
    VALUES (s.LandId, s.Kind, s.Status, s.AppliedOn, s.AppNo, s.ObtainedOn, s.CertNo, s.Expiry, s.Remarks, s.FileId, @U, @Now);
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalLandClearanceEvent WHERE LandId IN (@L4, @L5, @L6))
    INSERT INTO dbo.LegalLandClearanceEvent (LandId, Kind, Status, EventDate, RefNo, Remarks, FileId, CreatedBy, CreatedAt) VALUES
      (@L4, N'LA', N'Application Submitted', DATEADD(DAY, -20, @Today), N'LA/APP/2026/118', NULL, NULL, @U, DATEADD(DAY, -20, @Now)),
      (@L4, N'LA', N'Under Review', DATEADD(DAY, -12, @Today), NULL, NULL, NULL, @U, DATEADD(DAY, -12, @Now)),
      (@L4, N'LA', N'Query Raised', DATEADD(DAY, -4, @Today), N'Memo 44/LA', N'Office asked for the 1998 sale deed and a mouza map copy.', NULL, @U, DATEADD(DAY, -4, @Now)),
      (@L4, N'ULC', N'Not Applicable', NULL, NULL, N'Area below the ULC ceiling — not applicable.', NULL, @U, DATEADD(DAY, -18, @Now)),
      (@L5, N'LA', N'Application Submitted', DATEADD(DAY, -60, @Today), N'LA/APP/2026/071', NULL, NULL, @U, DATEADD(DAY, -60, @Now)),
      (@L5, N'LA', N'Query Raised', DATEADD(DAY, -40, @Today), N'Memo 12/LA', N'Asked for the LR record copy.', NULL, @U, DATEADD(DAY, -40, @Now)),
      (@L5, N'LA', N'Query Replied', DATEADD(DAY, -35, @Today), N'Reply 12/LA', N'LR record copy submitted.', @F2, @U, DATEADD(DAY, -35, @Now)),
      (@L5, N'LA', N'Approved', DATEADD(DAY, -15, @Today), N'LA/NOC/2026/071', N'No acquisition notice on these Dags.', NULL, @U, DATEADD(DAY, -15, @Now)),
      (@L5, N'ULC', N'Application Submitted', DATEADD(DAY, -10, @Today), N'ULC/APP/2026/033', NULL, NULL, @U, DATEADD(DAY, -10, @Now)),
      (@L6, N'LA', N'Approved', DATEADD(DAY, -90, @Today), N'LA/NOC/2026/012', NULL, NULL, @U, DATEADD(DAY, -90, @Now)),
      (@L6, N'ULC', N'Approved', DATEADD(DAY, -85, @Today), N'ULC/CERT/2026/009', NULL, NULL, @U, DATEADD(DAY, -85, @Now));

  -- ── Payments: schedule, pending and failed on DEMO/00005; a reversed duplicate on DEMO/00006 ──
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalPaymentSchedule WHERE LandId = @L5)
    INSERT INTO dbo.LegalPaymentSchedule (LandId, DueDate, Amount, SharePct, Label, TxnTypeId, Remarks, CreatedBy) VALUES
      (@L5, DATEADD(DAY, -30, @Today), 500000, NULL, N'Advance on agreement', @Adv, NULL, @U),
      (@L5, DATEADD(DAY, 10, @Today), 2000000, NULL, N'Second instalment', @Pur, NULL, @U),
      (@L5, DATEADD(DAY, 40, @Today), 3000000, NULL, N'Balance before registration', @Fin, NULL, @U);
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalPayment WHERE LandId = @L5 AND TransactionRef IN (N'CHQ-551204', N'NEFT-5502'))
    INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payer, Payee, TransactionRef, ReceiptNo, Remarks, IsActive, CreatedBy, PaymentStatus) VALUES
      (@L5, DATEADD(DAY, -8, @Today), @Pur, 1000000, @Chq, N'Company', N'Seller', N'CHQ-551204', NULL, N'[' + CONVERT(char(10), DATEADD(DAY, -5, @Today), 23) + N'] Failed: cheque returned — signature mismatch', 1, @U, N'Failed'),
      (@L5, DATEADD(DAY, -2, @Today), @Pur, 1000000, @Bank, N'Company', N'Seller', N'NEFT-5502', NULL, N'Bank confirmation awaited', 1, @U, N'Pending');
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalPayment WHERE LandId = @L6 AND TransactionRef = N'NEFT-6601-DUP')
    INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payer, Payee, TransactionRef, Remarks, IsActive, CreatedBy, PaymentStatus) VALUES
      (@L6, DATEADD(DAY, -50, @Today), @Adv, 600000, @Bank, N'Company', N'Seller', N'NEFT-6601-DUP', N'[' + CONVERT(char(10), DATEADD(DAY, -49, @Today), 23) + N'] Reversed: same advance entered twice — the original is NEFT-6601', 1, @U, N'Reversed');
  IF OBJECT_ID('dbo.LegalStampDutyQuery', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalStampDutyQuery WHERE LandId = @L5)
    INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy) VALUES
      (@L5, DATEADD(DAY, -3, @Today), @Stamp, 330000, N'Stamp duty (6%) — e-assessment slip', @U),
      (@L5, DATEADD(DAY, -3, @Today), @RegFee, 55000, N'Registration fee (1%)', @U);

  -- ── Deed copy replaced on DEMO/00004: both kept as versions ──
  IF @L4 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDocument WHERE LandId = @L4 AND Title = N'Deed copy (Deed Process)')
  BEGIN
    DECLARE @DT INT = (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName LIKE N'%Deed%' ORDER BY DocTypeId);
    INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, CurrentVersionNo, Remarks, IsActive, CreatedBy)
      VALUES (N'DEMO-DEED-' + CAST(@L4 AS NVARCHAR(10)), @L4, @DT, N'Registration', N'Deed copy (Deed Process)', 2, N'Kept by Deed Process', 1, @U);
    DECLARE @DD INT = SCOPE_IDENTITY();
    INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, UploadedAt, ReviewStatus, ReviewRemarks) VALUES
      (@DD, 1, @F2, @U, DATEADD(DAY, -6, @Now), N'Rejected', N'Wrong draft uploaded — replaced'),
      (@DD, 2, @F1, @U, DATEADD(DAY, -1, @Now), N'Pending', NULL);
  END

  -- ── Documents in more than one section: each previous sale deed is also a Registration document ──
  IF OBJECT_ID('dbo.LegalLandDocumentSection', 'U') IS NOT NULL
    INSERT INTO dbo.LegalLandDocumentSection (DocumentId, Section)
      SELECT d.DocumentId, N'Registration' FROM dbo.LegalLandDocument d JOIN dbo.LegalLand l ON l.LandId = d.LandId
      WHERE l.LandCode LIKE N'DEMO/%' AND d.Title = N'Previous sale deed'
        AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDocumentSection x WHERE x.DocumentId = d.DocumentId AND x.Section = N'Registration');

  -- ── Post-registration tasks of DEMO/00006 ──
  IF @L6 IS NOT NULL
  BEGIN
    UPDATE t SET Status = v.St, DueDate = v.Due, RefNo = v.Ref, Remarks = v.Rm, AssignedUserId = v.A,
           CompletedBy = CASE WHEN v.St = N'Completed' THEN @U END, CompletedAt = CASE WHEN v.St = N'Completed' THEN DATEADD(DAY, -v.Ago, @Now) END,
           UpdatedBy = @U, UpdatedAt = @Now
    FROM dbo.LegalPostRegTask t JOIN (VALUES
      (N'Registered deed verification', N'Completed', DATEADD(DAY, -20, @Today), N'Verified copy', N'Certified copy matched with the IGR record.', @U, 20),
      (N'Mutation application', N'Application Submitted', DATEADD(DAY, 15, @Today), N'MUT/2026/4471', N'Hearing awaited at BL&LRO Rajarhat.', @U2, 0),
      (N'Updated Khatian / RoR', N'Not Started', DATEADD(DAY, 45, @Today), NULL, N'After the mutation order.', @U2, 0),
      (N'Updated land records', N'Not Started', DATEADD(DAY, 50, @Today), NULL, NULL, @U2, 0),
      (N'Land tax / revenue update', N'Under Processing', DATEADD(DAY, -5, @Today), NULL, N'Overdue — follow up at the tahsil office.', @U, 0),
      (N'Ownership record update', N'Completed', DATEADD(DAY, -15, @Today), NULL, N'Company recorded as owner.', @U, 15),
      (N'Project mapping eligibility', N'Completed', DATEADD(DAY, -10, @Today), NULL, N'Mapped to the project.', @U, 10)
    ) v(Task, St, Due, Ref, Rm, A, Ago) ON v.Task = t.Task
    WHERE t.LandId = @L6;
    IF NOT EXISTS (SELECT 1 FROM dbo.LegalPostRegTask WHERE LandId = @L6 AND Task = N'Land tax 2027-28')
      INSERT INTO dbo.LegalPostRegTask (LandId, TaskNo, Task, Status, DueDate, AssignedUserId, UpdatedBy, UpdatedAt)
        SELECT @L6, ISNULL(MAX(TaskNo), 0) + 1, N'Land tax 2027-28', N'Not Started', DATEFROMPARTS(YEAR(@Today) + 1, 6, 30), @U2, @U, @Now FROM dbo.LegalPostRegTask WHERE LandId = @L6;
  END

  -- ── Decisions (added only) ──
  IF OBJECT_ID('dbo.LegalLandDecision', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDecision WHERE LandId IN (@L2, @L4, @L5, @L6))
    INSERT INTO dbo.LegalLandDecision (LandId, Stage, Action, VersionNo, Reason, DecidedBy, DecidedAt) VALUES
      (@L2, N'Verification', N'Send back', 1, N'Correct the fields marked ✗: Ownership History › Father / husband name; Land Records › Recorded holder', @U, DATEADD(DAY, -1, @Now)),
      (@L4, N'Land approval', N'Approve', 1, N'Verified papers in order — to Deed Process', @U, DATEADD(DAY, -39, @Now)),
      (@L5, N'Land approval', N'Approve', 1, NULL, @U, DATEADD(DAY, -39, @Now)),
      (@L5, N'Deed approval', N'Hold', NULL, N'Waiting for the seller''s PAN copy', @U, DATEADD(DAY, -25, @Now)),
      (@L5, N'Deed approval', N'Approve', NULL, N'PAN received — deed approved', @U, DATEADD(DAY, -20, @Now)),
      (@L6, N'Land approval', N'Approve', 1, NULL, @U, DATEADD(DAY, -59, @Now)),
      (@L6, N'Deed approval', N'Approve', NULL, N'Deed approved', @U, DATEADD(DAY, -45, @Now));
END
GO
