-- Migration 690: Legal module PRESENTATION DATA (requested for the live demo).
-- WIPES every Legal record (lands, enquiries, deed searches, deed process / registration, payments, documents, audit)
-- and loads a demo set that shows every page and stage. Setup masters and reference lists are kept.
--   10 enquiries (DEMO-ENQ-001..010) in the first two projects, at every status; Deed Registry Search fully searched,
--   half searched and overdue; 4 lands DEMO/00001..00004 at Draft → Deed Process → Deed Registration (part paid,
--   one instalment overdue) → Registered (paid, IGR tracked to the locker, post-registration tasks).
-- Uses what the database has: the first two projects, a district with mouzas, the Katha unit, admin users, an uploaded
-- Legal file if any. Skips itself (changes nothing) if there are not two projects, a mouza and an admin user.
-- One transaction: any error rolls everything back and the migration fails.
SET XACT_ABORT OFF;
SET NOCOUNT ON;
DECLARE @G INT, @R INT, @DIST INT, @M1 INT, @M2 INT, @KATHA INT, @UE INT, @UV INT, @U1 INT, @U2 INT, @FILE INT, @FILE2 INT, @ADSR INT;
SELECT @G = MIN(id) FROM dbo.enterprise WHERE business_type = 'P';
SELECT @R = MIN(id) FROM dbo.enterprise WHERE business_type = 'P' AND id > @G;
SELECT TOP 1 @DIST = d.DistrictId FROM dbo.LegalDistrict d WHERE EXISTS (SELECT 1 FROM dbo.LegalMouza m WHERE m.DistrictId = d.DistrictId)
  ORDER BY CASE WHEN d.DistrictName LIKE N'%North 24%' THEN 0 ELSE 1 END, d.DistrictId;
SELECT @M1 = MIN(MouzaId) FROM dbo.LegalMouza WHERE DistrictId = @DIST;
SELECT @M2 = ISNULL(MIN(MouzaId), @M1) FROM dbo.LegalMouza WHERE DistrictId = @DIST AND MouzaId > @M1;
SELECT TOP 1 @KATHA = AreaUnitId FROM dbo.LegalAreaUnit ORDER BY CASE WHEN UnitName LIKE N'Katha%' THEN 0 ELSE 1 END, AreaUnitId;
DECLARE @users TABLE (n INT IDENTITY(1,1), id INT);
INSERT INTO @users (id) SELECT TOP 4 u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE ISNULL(u.discontinue, 0) = 0 AND LOWER(r.RName) IN (N'super admin', N'super_admin', N'admin') ORDER BY u.id;
SELECT @UE = id FROM @users WHERE n = 1;
SELECT @UV = ISNULL((SELECT id FROM @users WHERE n = 2), @UE), @U1 = ISNULL((SELECT id FROM @users WHERE n = 3), @UE), @U2 = ISNULL((SELECT id FROM @users WHERE n = 4), @UE);
SELECT @FILE = MAX(FileId) FROM dbo.LegalMasterFile;
SELECT @FILE2 = ISNULL(MAX(FileId), @FILE) FROM dbo.LegalMasterFile WHERE FileId < @FILE;
SELECT TOP 1 @ADSR = OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeType = N'ADSR';

IF @R IS NULL OR @M1 IS NULL OR @KATHA IS NULL OR @UE IS NULL
BEGIN
  PRINT 'Migration 690: skipped - needs two projects, a Legal district with a mouza, an area unit and an admin user.';
  RETURN;
END;

BEGIN TRY
BEGIN TRAN;

-- 1. Clear every Legal table except Setup masters / reference lists (retry passes for foreign-key order).
DECLARE @keep TABLE (t SYSNAME);
INSERT INTO @keep VALUES (N'LegalAreaUnit'),(N'LegalChecklistItem'),(N'LegalChecklistTemplate'),(N'LegalDeedType'),(N'LegalDistrict'),(N'LegalDocumentType'),
  (N'LegalLawReference'),(N'LegalLookupValue'),(N'LegalRegistrationOfficeType'),(N'LegalRegistryOfficeSla'),(N'LegalRuleConfig'),(N'LegalStatusReason'),
  (N'LegalSuccessionRule'),(N'LegalWorkflowStep'),(N'LegalApprovalAuthority'),(N'LegalPortalLink'),(N'LegalPortalApi'),(N'LegalRegistrationOffice'),
  (N'LegalMouza'),(N'LegalBlock'),(N'LegalMunicipality'),(N'LegalPoliceStation'),(N'LegalSubDivision'),(N'LegalVillage'),(N'LegalMasterFile'),
  (N'LegalTaskType'),(N'LegalReminderSla'),(N'LegalApprovalWorkflow'),(N'LegalAdvocate'),(N'LegalPerson'),(N'LegalParty'),(N'LegalRsKhatian'),
  (N'LegalRsPlot'),(N'LegalLrRor'),(N'LegalInstalmentTemplate'),(N'LegalInstalmentTemplateLine');
UPDATE dbo.LegalLand SET EnquiryId = NULL; UPDATE dbo.LegalLandEnquiry SET LandId = NULL;
IF COL_LENGTH('dbo.LegalRsPlot', 'LandId') IS NOT NULL EXEC('UPDATE dbo.LegalRsPlot SET LandId = NULL');
DECLARE @left TABLE (t SYSNAME);
INSERT INTO @left SELECT name FROM sys.tables WHERE name LIKE N'Legal%' AND name NOT IN (SELECT t FROM @keep);
DECLARE @pass INT = 0, @t SYSNAME, @sql NVARCHAR(400);
WHILE EXISTS (SELECT 1 FROM @left) AND @pass < 15
BEGIN
  SET @pass += 1;
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT t FROM @left;
  OPEN c; FETCH NEXT FROM c INTO @t;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SAVE TRAN s1;
    BEGIN TRY
      SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@t); EXEC sp_executesql @sql;
      DELETE FROM @left WHERE t = @t;
    END TRY
    BEGIN CATCH
      IF XACT_STATE() = 1 ROLLBACK TRAN s1; ELSE THROW;
    END CATCH;
    FETCH NEXT FROM c INTO @t;
  END;
  CLOSE c; DEALLOCATE c;
END;
IF EXISTS (SELECT 1 FROM @left) THROW 50001, 'Migration 690: could not clear every Legal table', 1;

-- 2. Enquiries, their RS / LR records and office timelines.
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-001', CAST(DATEADD(day, 0, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Broker'), N'Greens phase 2 — east corner, Rajarhat', @DIST, @M1, N'105', 6, @KATHA,
  N'Seller contact', N'9830012345', 3600000, @UE, N'New', @G, N'441', N'1410', N'221', N'2290', N'Demo enquiry — New.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-002', CAST(DATEADD(day, -12, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Direct Owner'), N'Behind Rajarhat bus depot', @DIST, @M1, N'105', 4, @KATHA,
  N'Seller contact', N'9830012345', 2600000, @UE, N'Under Review', @G, N'452', N'1433', N'226', N'2302', N'Demo enquiry — Under Review.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-003', CAST(DATEADD(day, -5, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Reference'), N'Canal-side plot, Rajarhat', @DIST, @M1, N'105', 8, @KATHA,
  N'Seller contact', N'9830012345', 4800000, @UE, N'Interested', @G, N'433', N'1402', N'219', N'2264', N'Demo enquiry — Interested.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-004', CAST(DATEADD(day, -15, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Broker'), N'Kadampukur school road', @DIST, @M2, N'27', 10, @KATHA,
  N'Seller contact', N'9830012345', 5500000, @UE, N'Interested', @R, N'162', N'611', N'91', N'958', N'Demo enquiry — Interested.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-005', CAST(DATEADD(day, -3, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Website'), N'Kadampukur bus stand, east side', @DIST, @M2, N'27', 5, @KATHA,
  N'Seller contact', N'9830012345', 3100000, @UE, N'On Hold', @R, N'157', N'602', N'88', N'941', N'Demo enquiry — On Hold.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-006', CAST(DATEADD(day, -20, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Walk-in'), N'Low land near Kadampukur bheri', @DIST, @M2, N'27', 12, @KATHA,
  N'Seller contact', N'9830012345', 2400000, @UE, N'Rejected', @R, N'171', N'630', N'95', N'977', N'Demo enquiry — Rejected.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-007', CAST(DATEADD(day, -40, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Direct Owner'), N'Rajarhat main road, north plot', @DIST, @M1, N'105', 5, @KATHA,
  N'Seller contact', N'9830012345', 3000000, @UE, N'Converted to Land Record', @G, N'418', N'1376', N'94', N'2215', N'Demo enquiry — Converted to Land Record.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-008', CAST(DATEADD(day, -55, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Broker'), N'Chowmatha junction plot, Rajarhat', @DIST, @M1, N'105', 7, @KATHA,
  N'Seller contact', N'9830012345', 4200000, @UE, N'Converted to Land Record', @G, N'425', N'1389', N'97', N'2241', N'Demo enquiry — Converted to Land Record.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-009', CAST(DATEADD(day, -70, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Reference'), N'Kadampukur canal road', @DIST, @M2, N'27', 8, @KATHA,
  N'Seller contact', N'9830012345', 4800000, @UE, N'Converted to Land Record', @R, N'149', N'588', N'84', N'915', N'Demo enquiry — Converted to Land Record.', 1, @UE);
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, FinYear, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId,
  ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, ProjectId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, InitialNotes, IsActive, CreatedBy)
VALUES (N'DEMO-ENQ-010', CAST(DATEADD(day, -90, GETDATE()) AS DATE), N'2026-27', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = N'Broker'), N'Kadampukur market back plot', @DIST, @M2, N'27', 6, @KATHA,
  N'Seller contact', N'9830012345', 3600000, @UE, N'Converted to Land Record', @R, N'140', N'571', N'80', N'902', N'Demo enquiry — Converted to Land Record.', 1, @UE);
UPDATE dbo.LegalLandEnquiry SET DeedArea = ApproxArea - 0.25;
INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy)
  SELECT EnquiryId, MouzaId, RsKhatianNo, RsDagNo, N'Nitai Sarkar', ApproxArea, AreaUnitId, CreatedBy FROM dbo.LegalLandEnquiry;
INSERT INTO dbo.LegalEnquiryLrRecord (EnquiryId, MouzaId, LrKhatianNo, LrDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy)
  SELECT EnquiryId, MouzaId, LrKhatianNo, LrDagNo, N'Bimal Sarkar & Kamal Sarkar', ApproxArea, AreaUnitId, CreatedBy FROM dbo.LegalLandEnquiry;
INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, CreatedBy)
  SELECT EnquiryId, MouzaId, N'219', N'434', N'Nitai Sarkar', 2, AreaUnitId, CreatedBy FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003';
UPDATE dbo.LegalLandEnquiry SET RsDagNo = N'433, 434' WHERE EnquiryNo = N'DEMO-ENQ-003';
INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate)
  SELECT e.EnquiryId, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear, DATEADD(day, t.SlaDays, e.EnquiryDate)
  FROM dbo.LegalLandEnquiry e JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
  JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1 AND (t.StateName IS NULL OR t.StateName = d.State);
IF @ADSR IS NOT NULL UPDATE dbo.LegalEnquiryOfficeSearch SET OfficeId = @ADSR WHERE OfficeType = N'ADSR';

-- Deed Registry Search: DEMO-ENQ-003 part searched (DSR half way, RA Calcutta not started); 004 and the converted ones complete.
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, 2009, N'Found', o.SlaDays, o.DueDate, N'I-0874/2009', '2009-03-15', N'Haripada Ghosh → Sukanta Ghosh', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003') AND o.OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003') AND o.OfficeType = N'ADSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; 1 deed(s) found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003') AND OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003') AND o.OfficeType = N'BLRO'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003') AND OfficeType = N'BLRO';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < 1990)
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-003') AND o.OfficeType = N'DSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, 2011, N'Found', o.SlaDays, o.DueDate, N'I-0412/2011', '2011-03-15', N'Previous owner → present seller', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND o.OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND o.OfficeType = N'ADSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; 1 deed(s) found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND o.OfficeType = N'DSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND OfficeType = N'DSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND o.OfficeType = N'RA Calcutta'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND OfficeType = N'RA Calcutta';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND o.OfficeType = N'BLRO'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-004') AND OfficeType = N'BLRO';
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, 2011, N'Found', o.SlaDays, o.DueDate, N'I-0712/2011', '2011-03-15', N'Previous owner → present seller', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND o.OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND o.OfficeType = N'ADSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; 1 deed(s) found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND o.OfficeType = N'DSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND OfficeType = N'DSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND o.OfficeType = N'RA Calcutta'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND OfficeType = N'RA Calcutta';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND o.OfficeType = N'BLRO'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-007') AND OfficeType = N'BLRO';
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, 2011, N'Found', o.SlaDays, o.DueDate, N'I-0812/2011', '2011-03-15', N'Previous owner → present seller', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND o.OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND o.OfficeType = N'ADSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; 1 deed(s) found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND o.OfficeType = N'DSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND OfficeType = N'DSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND o.OfficeType = N'RA Calcutta'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND OfficeType = N'RA Calcutta';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND o.OfficeType = N'BLRO'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-008') AND OfficeType = N'BLRO';
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, 2011, N'Found', o.SlaDays, o.DueDate, N'I-0912/2011', '2011-03-15', N'Previous owner → present seller', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND o.OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND o.OfficeType = N'ADSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; 1 deed(s) found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND o.OfficeType = N'DSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND OfficeType = N'DSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND o.OfficeType = N'RA Calcutta'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND OfficeType = N'RA Calcutta';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND o.OfficeType = N'BLRO'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-009') AND OfficeType = N'BLRO';
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, 2011, N'Found', o.SlaDays, o.DueDate, N'I-1012/2011', '2011-03-15', N'Previous owner → present seller', N'Deed index matched the RS / LR Dag.', N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND o.OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND o.OfficeType = N'ADSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; 1 deed(s) found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND OfficeType = N'ADSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND o.OfficeType = N'DSR'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND OfficeType = N'DSR';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND o.OfficeType = N'RA Calcutta'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND OfficeType = N'RA Calcutta';
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < YEAR(GETDATE()))
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y, N'Not Found', o.SlaDays, o.DueDate, N'WB Registration (wbregistration.gov.in)', @UV, @UV, SYSUTCDATETIME()
  FROM dbo.LegalEnquiryOfficeSearch o CROSS JOIN y
  WHERE o.EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND o.OfficeType = N'BLRO'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = o.EnquiryId AND x.OfficeType = o.OfficeType AND x.CalendarYear = y.Y)
  OPTION (MAXRECURSION 400);
UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', CompletedBy = @UV, CompletedAt = SYSUTCDATETIME(),
  Remarks = N'1956–' + CAST(YEAR(GETDATE()) AS NVARCHAR(4)) + N' searched; nothing found.' WHERE EnquiryId = (SELECT EnquiryId FROM dbo.LegalLandEnquiry WHERE EnquiryNo = N'DEMO-ENQ-010') AND OfficeType = N'BLRO';

-- 3. Lands from the converted enquiries.
DECLARE @id INT, @doc INT, @L1 INT, @L2 INT, @L3 INT, @L4 INT;
INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, EnquiryId, ProjectId, LocationAddress,
  RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, CreatedBy, CreatedAt,
  OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent)
SELECT N'DEMO/00001/2026-27', N'Rajarhat main road, north plot', @DIST, @M1, 5, @KATHA, N'Identified', N'New Acquisition', e.EnquiryId, e.ProjectId, N'Rajarhat main road, north plot',
  N'418', N'1376', N'94', N'2215', N'Draft (Verification Pending)', N'Draft', N'Pending', N'Pending', 0, 1, @UE, DATEADD(day, -30, SYSUTCDATETIME()),
  N'Individual', N'Purchase', N'Pending', N'Pending', N'Pending'
FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo = N'DEMO-ENQ-007';
SET @id = SCOPE_IDENTITY(); SET @L1 = @id;
UPDATE dbo.LegalLandEnquiry SET LandId = @id WHERE EnquiryNo = N'DEMO-ENQ-007';
INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy) VALUES
  (@id, N'Bimal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE),
  (@id, N'Kamal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE);
INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy) VALUES (@id, @M1, N'94', N'418', N'Nitai Sarkar', 5, @KATHA, 1, @UE);
INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, IsActive, CreatedBy) VALUES (@id, @M1, N'2215', N'1376', 1, @UE);
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00001', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'Sale Deed'), N'Purchase / Sale', N'Parent sale deed', N'I-418/2004', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00002', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'LR Khatian'), N'Ownership', N'LR Khatian (RoR)', N'2215', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, EnquiryId, ProjectId, LocationAddress,
  RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, CreatedBy, CreatedAt,
  OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent)
SELECT N'DEMO/00002/2026-27', N'Chowmatha junction plot, Rajarhat', @DIST, @M1, 7, @KATHA, N'Identified', N'New Acquisition', e.EnquiryId, e.ProjectId, N'Chowmatha junction plot, Rajarhat',
  N'425', N'1389', N'97', N'2241', N'Deed Process', N'Verified', N'Pending', N'Pending', 0, 1, @UE, DATEADD(day, -30, SYSUTCDATETIME()),
  N'Individual', N'Purchase', N'Verified', N'Has authority', N'All owners consented'
FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo = N'DEMO-ENQ-008';
SET @id = SCOPE_IDENTITY(); SET @L2 = @id;
UPDATE dbo.LegalLandEnquiry SET LandId = @id WHERE EnquiryNo = N'DEMO-ENQ-008';
INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy) VALUES
  (@id, N'Bimal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE),
  (@id, N'Kamal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE);
INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy) VALUES (@id, @M1, N'97', N'425', N'Nitai Sarkar', 7, @KATHA, 1, @UE);
INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, IsActive, CreatedBy) VALUES (@id, @M1, N'2241', N'1389', 1, @UE);
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00003', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'Sale Deed'), N'Purchase / Sale', N'Parent sale deed', N'I-425/2004', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00004', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'LR Khatian'), N'Ownership', N'LR Khatian (RoR)', N'2241', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalDiligenceArea (LandId, Area, Status, Remarks, CheckedBy, CheckedAt) VALUES
  (@id, N'ownership', N'Verified', N'Both co-owners verified.', @UV, SYSUTCDATETIME()),
  (@id, N'inheritance', N'Not Applicable', N'Bought in 2004; no inheritance since.', @UV, SYSUTCDATETIME()),
  (@id, N'title', N'Verified', N'Title chain continuous; RS / LR match.', @UV, SYSUTCDATETIME()),
  (@id, N'documents', N'Verified', N'Deed and RoR on file.', @UV, SYSUTCDATETIME());
INSERT INTO dbo.LegalRiskAssessment (LandId, RiskLevel, Remarks, AssessedBy) VALUES (@id, N'Low', N'Clean title, no encumbrance or case.', @UV);
INSERT INTO dbo.LegalReview (LandId, Status, ReviewerUserId, AssignedOn, CompletedOn, Opinion, Recommendation, CreatedBy)
  VALUES (@id, N'Legally Cleared', @UV, CAST(DATEADD(day, -12, GETDATE()) AS DATE), CAST(DATEADD(day, -10, GETDATE()) AS DATE), N'Title clear and marketable.', N'Cleared for registration.', @UV);
UPDATE dbo.LegalLand SET FinalVerifiedBy = @UV, FinalVerifiedAt = DATEADD(day, -9, SYSUTCDATETIME()), DeedFileId = @FILE WHERE LandId = @id;
INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, EnquiryId, ProjectId, LocationAddress,
  RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, CreatedBy, CreatedAt,
  OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent)
SELECT N'DEMO/00003/2026-27', N'Kadampukur canal road', @DIST, @M2, 8, @KATHA, N'Identified', N'New Acquisition', e.EnquiryId, e.ProjectId, N'Kadampukur canal road',
  N'149', N'588', N'84', N'915', N'Deed Registration', N'Verified', N'Pending', N'Pending', 0, 1, @UE, DATEADD(day, -30, SYSUTCDATETIME()),
  N'Individual', N'Purchase', N'Verified', N'Has authority', N'All owners consented'
FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo = N'DEMO-ENQ-009';
SET @id = SCOPE_IDENTITY(); SET @L3 = @id;
UPDATE dbo.LegalLandEnquiry SET LandId = @id WHERE EnquiryNo = N'DEMO-ENQ-009';
INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy) VALUES
  (@id, N'Bimal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE),
  (@id, N'Kamal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE);
INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy) VALUES (@id, @M2, N'84', N'149', N'Nitai Sarkar', 8, @KATHA, 1, @UE);
INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, IsActive, CreatedBy) VALUES (@id, @M2, N'915', N'588', 1, @UE);
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00005', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'Sale Deed'), N'Purchase / Sale', N'Parent sale deed', N'I-149/2004', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00006', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'LR Khatian'), N'Ownership', N'LR Khatian (RoR)', N'915', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalDiligenceArea (LandId, Area, Status, Remarks, CheckedBy, CheckedAt) VALUES
  (@id, N'ownership', N'Verified', N'Both co-owners verified.', @UV, SYSUTCDATETIME()),
  (@id, N'inheritance', N'Not Applicable', N'Bought in 2004; no inheritance since.', @UV, SYSUTCDATETIME()),
  (@id, N'title', N'Verified', N'Title chain continuous; RS / LR match.', @UV, SYSUTCDATETIME()),
  (@id, N'documents', N'Verified', N'Deed and RoR on file.', @UV, SYSUTCDATETIME());
INSERT INTO dbo.LegalRiskAssessment (LandId, RiskLevel, Remarks, AssessedBy) VALUES (@id, N'Low', N'Clean title, no encumbrance or case.', @UV);
INSERT INTO dbo.LegalReview (LandId, Status, ReviewerUserId, AssignedOn, CompletedOn, Opinion, Recommendation, CreatedBy)
  VALUES (@id, N'Legally Cleared', @UV, CAST(DATEADD(day, -12, GETDATE()) AS DATE), CAST(DATEADD(day, -10, GETDATE()) AS DATE), N'Title clear and marketable.', N'Cleared for registration.', @UV);
UPDATE dbo.LegalLand SET FinalVerifiedBy = @UV, FinalVerifiedAt = DATEADD(day, -9, SYSUTCDATETIME()), DeedFileId = @FILE WHERE LandId = @id;
INSERT INTO dbo.LegalLand (LandCode, LandName, DistrictId, MouzaId, Area, AreaUnitId, LandStatus, EntryType, EnquiryId, ProjectId, LocationAddress,
  RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, WorkflowStatus, VerificationStatus, L1Status, L2Status, IsOnHold, IsActive, CreatedBy, CreatedAt,
  OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent)
SELECT N'DEMO/00004/2026-27', N'Kadampukur market back plot', @DIST, @M2, 6, @KATHA, N'Owned', N'New Acquisition', e.EnquiryId, e.ProjectId, N'Kadampukur market back plot',
  N'140', N'571', N'80', N'902', N'Registered', N'Verified', N'Pending', N'Pending', 0, 1, @UE, DATEADD(day, -30, SYSUTCDATETIME()),
  N'Individual', N'Purchase', N'Verified', N'Has authority', N'All owners consented'
FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo = N'DEMO-ENQ-010';
SET @id = SCOPE_IDENTITY(); SET @L4 = @id;
UPDATE dbo.LegalLandEnquiry SET LandId = @id WHERE EnquiryNo = N'DEMO-ENQ-010';
INSERT INTO dbo.LegalOwnershipRecord (LandId, OwnerName, OwnerGuardian, OwnershipTypeId, SharePct, ValidFrom, IsActive, CreatedBy) VALUES
  (@id, N'Bimal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE),
  (@id, N'Kamal Sarkar', N'Late Nitai Sarkar', (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'ownership-type' AND Name = N'Joint'), 50, '2004-05-10', 1, @UE);
INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, IsActive, CreatedBy) VALUES (@id, @M2, N'80', N'140', N'Nitai Sarkar', 6, @KATHA, 1, @UE);
INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, IsActive, CreatedBy) VALUES (@id, @M2, N'902', N'571', 1, @UE);
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00007', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'Sale Deed'), N'Purchase / Sale', N'Parent sale deed', N'I-140/2004', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, IssuingAuthority, CurrentVersionNo, Remarks, IsActive, CreatedBy)
VALUES (N'DEMO-DOC-00008', @id, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'LR Khatian'), N'Ownership', N'LR Khatian (RoR)', N'902', N'ADSR', 1, N'Demo document', 1, @UE);
SET @doc = SCOPE_IDENTITY();
IF @FILE IS NOT NULL INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadedBy, ReviewStatus) VALUES (@doc, 1, @FILE, @UE, N'Verified');
INSERT INTO dbo.LegalDiligenceArea (LandId, Area, Status, Remarks, CheckedBy, CheckedAt) VALUES
  (@id, N'ownership', N'Verified', N'Both co-owners verified.', @UV, SYSUTCDATETIME()),
  (@id, N'inheritance', N'Not Applicable', N'Bought in 2004; no inheritance since.', @UV, SYSUTCDATETIME()),
  (@id, N'title', N'Verified', N'Title chain continuous; RS / LR match.', @UV, SYSUTCDATETIME()),
  (@id, N'documents', N'Verified', N'Deed and RoR on file.', @UV, SYSUTCDATETIME());
INSERT INTO dbo.LegalRiskAssessment (LandId, RiskLevel, Remarks, AssessedBy) VALUES (@id, N'Low', N'Clean title, no encumbrance or case.', @UV);
INSERT INTO dbo.LegalReview (LandId, Status, ReviewerUserId, AssignedOn, CompletedOn, Opinion, Recommendation, CreatedBy)
  VALUES (@id, N'Legally Cleared', @UV, CAST(DATEADD(day, -12, GETDATE()) AS DATE), CAST(DATEADD(day, -10, GETDATE()) AS DATE), N'Title clear and marketable.', N'Cleared for registration.', @UV);
UPDATE dbo.LegalLand SET FinalVerifiedBy = @UV, FinalVerifiedAt = DATEADD(day, -9, SYSUTCDATETIME()), DeedFileId = @FILE WHERE LandId = @id;

-- Deed Process: L1 approved, waiting for L2, timeline in 5 days.
UPDATE dbo.LegalLand SET DeedTargetDate = CAST(DATEADD(day, 5, GETDATE()) AS DATE), L1Status = N'Approved', L1ReviewerId = @U1, L1ReviewedAt = DATEADD(day, -1, SYSUTCDATETIME()), L1Remarks = N'Documents in order.' WHERE LandId = @L2;
-- Deed Registration: approved; consideration, stamp duty, applied; final registration still to do.
UPDATE dbo.LegalLand SET DeedTargetDate = CAST(DATEADD(day, -4, GETDATE()) AS DATE), L1Status = N'Approved', L1ReviewerId = @U1, L1ReviewedAt = DATEADD(day, -7, SYSUTCDATETIME()),
  L2Status = N'Approved', L2ApproverId = @U2, L2ApprovedAt = DATEADD(day, -6, SYSUTCDATETIME()),
  ConsTotalAmount = 4800000, ConsRate = 600000, ConsRateUnitId = @KATHA, ConsAdvanceAmount = 500000, ConsPaymentModeId = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'payment-mode' AND Name = N'RTGS'),
  ConsRemarks = N'8 katha @ ₹6 lakh per katha; advance on agreement, balance at registration.', RegAppliedBy = @U1, RegAppliedAt = DATEADD(day, -3, SYSUTCDATETIME())
WHERE LandId = @L3;
INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy) VALUES
  (@L3, CAST(DATEADD(day, -4, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'fee-type' AND Name = N'Stamp Duty'), 288000, N'6% on market value ₹48 lakh', @UE),
  (@L3, CAST(DATEADD(day, -4, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'fee-type' AND Name = N'Registration Fee'), 52800, N'1.1% registration fee', @UE);
-- Registered: every step done, deed tracked to the company locker, post-registration under way.
UPDATE dbo.LegalLand SET DeedTargetDate = CAST(DATEADD(day, -30, GETDATE()) AS DATE), L1Status = N'Approved', L1ReviewerId = @U1, L1ReviewedAt = DATEADD(day, -35, SYSUTCDATETIME()),
  L2Status = N'Approved', L2ApproverId = @U2, L2ApprovedAt = DATEADD(day, -34, SYSUTCDATETIME()),
  ConsTotalAmount = 3600000, ConsRate = 600000, ConsRateUnitId = @KATHA, ConsAdvanceAmount = 1000000, ConsPaymentModeId = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'payment-mode' AND Name = N'Cheque'),
  RegAppliedBy = @U1, RegAppliedAt = DATEADD(day, -30, SYSUTCDATETIME()),
  RegFinalDate = CAST(DATEADD(day, -20, GETDATE()) AS DATE), RegOfficeId = @ADSR, RegModeId = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'registration-mode' AND Name = N'Physical (at office)'), RegDeedNo = N'I-1504-08812/2026',
  RegDeedFileId = @FILE2, RegCompletedBy = @U2, RegCompletedAt = DATEADD(day, -19, SYSUTCDATETIME()),
  IgrTrackingUrl = N'https://wbregistration.gov.in/', IgrStatusId = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'igr-status' AND Name = N'Delivered'), DeedLocationId = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'deed-location' AND Name = N'In company locker / vault')
WHERE LandId = @L4;
INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, CreatedBy) VALUES
  (@L4, CAST(DATEADD(day, -26, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'fee-type' AND Name = N'Stamp Duty'), 216000, @UE), (@L4, CAST(DATEADD(day, -26, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'fee-type' AND Name = N'Registration Fee'), 39600, @UE), (@L4, CAST(DATEADD(day, -20, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'fee-type' AND Name = N'Scanning Fee'), 500, @UE);
INSERT INTO dbo.LegalDeedTracking (LandId, StatusDate, IgrStatusId, DeedLocationId, TrackingUrl, Remarks, CreatedBy) VALUES
  (@L4, CAST(DATEADD(day, -20, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'igr-status' AND Name = N'Registered — deed pending'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'deed-location' AND Name = N'In registration office'), N'https://wbregistration.gov.in/', N'Registered; original with the office for scanning.', @UE),
  (@L4, CAST(DATEADD(day, -12, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'igr-status' AND Name = N'Ready for delivery'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'deed-location' AND Name = N'In registration office'), NULL, N'IGR shows ready for collection.', @UE),
  (@L4, CAST(DATEADD(day, -10, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'igr-status' AND Name = N'Delivered'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'deed-location' AND Name = N'With advocate'), NULL, N'Collected by the advocate.', @UE),
  (@L4, CAST(DATEADD(day, -8, GETDATE()) AS DATE), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'igr-status' AND Name = N'Delivered'), (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'deed-location' AND Name = N'In company locker / vault'), NULL, N'Original kept in the head-office locker.', @UE);
INSERT INTO dbo.LegalPostRegTask (LandId, TaskNo, Task, Status) VALUES
  (@L4, 1, N'Registered deed verification', N'Completed'), (@L4, 2, N'Mutation application', N'Application Submitted'), (@L4, 3, N'Updated Khatian / RoR', N'Not Started'),
  (@L4, 4, N'Updated land records', N'Not Started'), (@L4, 5, N'Land tax / revenue update', N'Under Processing'), (@L4, 6, N'Ownership record update', N'Not Started'),
  (@L4, 7, N'Project mapping eligibility', N'Completed');

-- 4. Payments: consideration history, advance, schedule (one instalment overdue), a later valuation, the final payment.
DECLARE @adv INT = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Advance'), @pp INT = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Purchase Payment'), @fin INT = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'txn-type' AND Name = N'Final Payment'), @rtgs INT = (SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'payment-mode' AND Name = N'RTGS');
UPDATE dbo.LegalLand SET ConsDate = CAST(DATEADD(month, -7, GETDATE()) AS DATE) WHERE LandId = @L3;
UPDATE dbo.LegalLand SET ConsDate = CAST(DATEADD(day, -60, GETDATE()) AS DATE) WHERE LandId = @L4;
INSERT INTO dbo.LegalConsiderationRevision (LandId, RevisionDate, NewTotal, NewRate, Reason, CreatedBy)
  SELECT LandId, ConsDate, ConsTotalAmount, ConsRate, N'Consideration agreed', @UE FROM dbo.LegalLand WHERE ConsTotalAmount IS NOT NULL;
INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payee, TransactionRef, Remarks, CreatedBy)
  SELECT LandId, ConsDate, @adv, ConsAdvanceAmount, ConsPaymentModeId, N'Bimal Sarkar & Kamal Sarkar', N'RTGS-UTIB-88120', N'Advance on agreement', @UE FROM dbo.LegalLand WHERE ConsAdvanceAmount > 0;
INSERT INTO dbo.LegalPayment (LandId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payee, TransactionRef, Remarks, CreatedBy) VALUES
  (@L3, CAST(DATEADD(month, -3, GETDATE()) AS DATE), @pp, 1500000, @rtgs, N'Bimal Sarkar & Kamal Sarkar', N'RTGS-UTIB-90433', N'Second instalment', @UE),
  (@L4, CAST(DATEADD(day, -21, GETDATE()) AS DATE), @fin, 2600000, @rtgs, N'Bimal Sarkar & Kamal Sarkar', N'RTGS-UTIB-91007', N'Balance before registration', @UE);
INSERT INTO dbo.LegalPaymentSchedule (LandId, DueDate, Amount, TxnTypeId, Remarks, CreatedBy) VALUES
  (@L3, CAST(DATEADD(month, -7, GETDATE()) AS DATE), 500000, @adv, N'On agreement', @UE),
  (@L3, CAST(DATEADD(month, -3, GETDATE()) AS DATE), 1500000, @pp, N'Second instalment', @UE),
  (@L3, CAST(DATEADD(day, -10, GETDATE()) AS DATE), 1500000, @pp, N'Third instalment', @UE),
  (@L3, CAST(DATEADD(day, 20, GETDATE()) AS DATE), 1300000, @fin, N'Balance at registration', @UE);
INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, IsActive, CreatedBy)
  VALUES (@L3, CAST(DATEADD(day, -15, GETDATE()) AS DATE), 8, @KATHA, 650000, 5200000, 4950000, N'WB Registration market value search', 1, @UE);

COMMIT;
PRINT 'Migration 690: Legal presentation data loaded (10 enquiries, 4 lands).';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;
