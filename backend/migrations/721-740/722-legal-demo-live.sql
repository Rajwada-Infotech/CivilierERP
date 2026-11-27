-- DEV SERVER ONLY (changed 2026-11-27): as first written this ran on every server EXCEPT dev, and on production —
-- which never got the 720 demo, so the TR-ENQ guard below would not stop it — it would have deleted every Legal record
-- and entered Legal master. Both batches now return unless they run on the dev server (CTO / Civilier), like 720.
-- (Originally:) Legal module: clear the sample / test data on every server except dev, then load the TEST RESIDENCE demo set
-- (same data as 720) so every Legal page, stage and feature can be seen and learned.
--   Batch 1 removes every Legal record and the entered masters (locations, offices, persons, advocates, RS / LR
--   registers, Approval Control, land types, files). Reference lists stay: lookups, area units, deed / document
--   types, checklists, law references, rules, status reasons, succession rules, workflow steps, verification
--   activity setup, instalment templates, portal links.
--   Batch 2 loads the demo under the TEST RESIDENCE project (created if it does not exist).
-- Dev (CTO / Civilier) is skipped: it already has the demo from 720. One transaction per batch.
SET NOCOUNT ON;
IF @@SERVERNAME <> N'CTO' OR DB_NAME() <> N'Civilier' RETURN; -- dev server only (never live data)
IF EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%') RETURN;
SET XACT_ABORT OFF;
BEGIN TRAN;
EXEC sp_set_session_context N'legal_reset', 1;
DECLARE @keep TABLE (t SYSNAME PRIMARY KEY);
INSERT INTO @keep VALUES (N'LegalActivityDependency'), (N'LegalActivityReminderRule'), (N'LegalActivityTemplate'), (N'LegalAreaUnit'),
  (N'LegalChecklistItem'), (N'LegalChecklistTemplate'), (N'LegalDeedType'), (N'LegalDocumentType'), (N'LegalInstalmentTemplate'),
  (N'LegalLawReference'), (N'LegalLookupValue'), (N'LegalPortalLink'), (N'LegalPortalApi'), (N'LegalRegistrationOfficeType'),
  (N'LegalRegistryOfficeSla'), (N'LegalRuleConfig'), (N'LegalStatusReason'), (N'LegalSuccessionRule'), (N'LegalWorkflowStep'),
  (N'LegalTaskType'), (N'LegalReminderSla');
IF COL_LENGTH('dbo.LegalPortalLink', 'OfficeId') IS NOT NULL EXEC (N'UPDATE dbo.LegalPortalLink SET OfficeId = NULL');
IF COL_LENGTH('dbo.LegalLand', 'EnquiryId') IS NOT NULL EXEC (N'UPDATE dbo.LegalLand SET EnquiryId = NULL');
IF COL_LENGTH('dbo.LegalLandEnquiry', 'LandId') IS NOT NULL EXEC (N'UPDATE dbo.LegalLandEnquiry SET LandId = NULL');
IF COL_LENGTH('dbo.LegalRsPlot', 'LandId') IS NOT NULL EXEC (N'UPDATE dbo.LegalRsPlot SET LandId = NULL');
DECLARE @left TABLE (t SYSNAME PRIMARY KEY);
INSERT INTO @left SELECT name FROM sys.tables WHERE name LIKE N'Legal%' AND name NOT IN (SELECT t FROM @keep);
DECLARE @pass INT = 0, @t SYSNAME, @sql NVARCHAR(400), @err NVARCHAR(2000);
WHILE EXISTS (SELECT 1 FROM @left) AND @pass < 20
BEGIN
  SET @pass += 1;
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT t FROM @left;
  OPEN c; FETCH NEXT FROM c INTO @t;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SAVE TRAN s1;
    BEGIN TRY
      SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@t); EXEC (@sql);
      DELETE FROM @left WHERE t = @t;
    END TRY
    BEGIN CATCH
      IF XACT_STATE() = -1 BEGIN SET @err = ERROR_MESSAGE(); ROLLBACK; THROW 51010, @err, 1; END
      ROLLBACK TRAN s1;
    END CATCH
    FETCH NEXT FROM c INTO @t;
  END
  CLOSE c; DEALLOCATE c;
END
IF EXISTS (SELECT 1 FROM @left)
BEGIN
  SELECT @err = N'Legal clean-up stopped, still referenced: ' + STRING_AGG(t, N', ') FROM @left;
  ROLLBACK; THROW 51011, @err, 1;
END
EXEC sp_set_session_context N'legal_reset', 0;
COMMIT;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
IF @@SERVERNAME <> N'CTO' OR DB_NAME() <> N'Civilier' RETURN; -- dev server only (never live data)
-- All demo data belongs to the TEST RESIDENCE project; it is created (under the same company as the first project) if missing.
IF NOT EXISTS (SELECT 1 FROM dbo.enterprise WHERE name = N'TEST RESIDENCE' AND business_type = 'P')
  INSERT INTO dbo.enterprise (name, business_identity, business_type, short_name, status, currency, city, state, country, fiscal_year_start, entity_type, discontinue, enterprise_id, company_id, project_type_id, date_of_entry)
  SELECT N'TEST RESIDENCE', N'TESTPRJ', 'P', N'TSTRSD', N'Planning', N'INR', N'Kolkata', N'West Bengal', N'India', N'April', N'Construction', 0, x.enterprise_id, x.company_id, x.project_type_id, CAST(GETDATE() AS DATE)
  FROM (SELECT 1 k) one LEFT JOIN (SELECT TOP 1 enterprise_id, company_id, project_type_id FROM dbo.enterprise WHERE business_type = 'P' ORDER BY id) x ON 1 = 1;
DECLARE @P INT = (SELECT TOP 1 id FROM dbo.enterprise WHERE name = N'TEST RESIDENCE' AND business_type = 'P');
IF @P IS NULL RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%') RETURN;
IF OBJECT_ID('dbo.LegalVerificationDocument', 'U') IS NULL RETURN; -- needs migrations 715–719

BEGIN TRAN;
EXEC sp_set_session_context N'legal_reset', 1;

-- ── People (existing users, picked in id order) ─────────────────────────────────────────────────
DECLARE @U TABLE (n INT, id INT);
INSERT INTO @U SELECT ROW_NUMBER() OVER (ORDER BY id), id FROM dbo.users;
DECLARE @uAdmin INT = (SELECT id FROM @U WHERE n = 1), @uEntry INT = ISNULL((SELECT id FROM @U WHERE n = 5), (SELECT id FROM @U WHERE n = 1)),
        @uVer INT = ISNULL((SELECT id FROM @U WHERE n = 6), (SELECT id FROM @U WHERE n = 1)), @uApp INT = ISNULL((SELECT id FROM @U WHERE n = 2), (SELECT id FROM @U WHERE n = 1)),
        @uRev INT = ISNULL((SELECT id FROM @U WHERE n = 7), (SELECT id FROM @U WHERE n = 1)), @uSearch INT = ISNULL((SELECT id FROM @U WHERE n = 8), (SELECT id FROM @U WHERE n = 1)),
        @uLegalAdmin INT = ISNULL((SELECT id FROM @U WHERE n = 3), (SELECT id FROM @U WHERE n = 1)), @uL2 INT = ISNULL((SELECT id FROM @U WHERE n = 9), (SELECT id FROM @U WHERE n = 1));
DECLARE @today DATE = CAST(GETDATE() AS DATE), @yr INT = YEAR(GETDATE());
DECLARE @fy NVARCHAR(9) = CASE WHEN MONTH(GETDATE()) >= 4 THEN CONCAT(@yr, N'-', RIGHT(@yr + 1, 2)) ELSE CONCAT(@yr - 1, N'-', RIGHT(@yr, 2)) END;

-- Lookups by category / name
DECLARE @L TABLE (c NVARCHAR(40), nm NVARCHAR(100), id INT);
INSERT INTO @L SELECT Category, Name, LookupId FROM dbo.LegalLookupValue;
DECLARE @KATHA INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA'), @DEC INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'DEC');

-- ── Demo files (stored in the database like every Legal upload) ─────────────────────────────────
DECLARE @F TABLE (k NVARCHAR(20), id INT);
INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) OUTPUT N'pdf', INSERTED.FileId INTO @F
  VALUES (N'TR-demo-document.pdf', N'application/pdf', 448, N'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggODg+PnN0cmVhbQpCVCAvRjEgMjAgVGYgNjAgNzYwIFRkIChDaXZpbGllckVSUCBMZWdhbCAtIGRlbW8gZG9jdW1lbnQpIFRqIDAgLTMwIFRkIChTYW1wbGUgZmlsZSBmb3IgdGVzdGluZykgVGogRVQKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj5lbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+PgolJUVPRg==', @uEntry);
INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) OUTPUT N'deed', INSERTED.FileId INTO @F
  VALUES (N'TR-registered-deed.pdf', N'application/pdf', 448, N'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggODg+PnN0cmVhbQpCVCAvRjEgMjAgVGYgNjAgNzYwIFRkIChDaXZpbGllckVSUCBMZWdhbCAtIGRlbW8gZG9jdW1lbnQpIFRqIDAgLTMwIFRkIChTYW1wbGUgZmlsZSBmb3IgdGVzdGluZykgVGogRVQKZW5kc3RyZWFtIGVuZG9iago1IDAgb2JqPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj5lbmRvYmoKdHJhaWxlcjw8L1Jvb3QgMSAwIFI+PgolJUVPRg==', @uEntry);
INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) OUTPUT N'photo', INSERTED.FileId INTO @F
  VALUES (N'TR-site-photo.png', N'image/png', 146, N'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAWUlEQVR4nO3PUQkAIBTAwJfTJMYxqiH8OITBAtxmn/V1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBH91007e+/m0AAAAASUVORK5CYII=', @uEntry);
INSERT INTO dbo.LegalMasterFile (FileName, MimeType, FileSize, FileBase64, UploadedBy) OUTPUT N'map', INSERTED.FileId INTO @F
  VALUES (N'TR-mouza-map.png', N'image/png', 146, N'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAWUlEQVR4nO3PUQkAIBTAwJfTJMYxqiH8OITBAtxmn/V1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBH91007e+/m0AAAAASUVORK5CYII=', @uEntry);
DECLARE @fPdf INT = (SELECT id FROM @F WHERE k = N'pdf'), @fDeed INT = (SELECT id FROM @F WHERE k = N'deed'), @fPhoto INT = (SELECT id FROM @F WHERE k = N'photo'), @fMap INT = (SELECT id FROM @F WHERE k = N'map');

-- ── Location masters ────────────────────────────────────────────────────────────────────────────
INSERT INTO dbo.LegalDistrict (DistrictName, DistrictCode, State, CreatedBy) VALUES (N'North 24 Parganas', N'N24P', N'West Bengal', @uAdmin), (N'Kolkata', N'KOL', N'West Bengal', @uAdmin);
DECLARE @dN24 INT = (SELECT DistrictId FROM dbo.LegalDistrict WHERE DistrictName = N'North 24 Parganas'), @dKol INT = (SELECT DistrictId FROM dbo.LegalDistrict WHERE DistrictName = N'Kolkata');
INSERT INTO dbo.LegalSubDivision (DistrictId, SubDivisionName, CreatedBy) VALUES (@dN24, N'Bidhannagar', @uAdmin), (@dN24, N'Barasat Sadar', @uAdmin);
DECLARE @sdBid INT = (SELECT SubDivisionId FROM dbo.LegalSubDivision WHERE SubDivisionName = N'Bidhannagar'), @sdBar INT = (SELECT SubDivisionId FROM dbo.LegalSubDivision WHERE SubDivisionName = N'Barasat Sadar');
INSERT INTO dbo.LegalBlock (DistrictId, SubDivisionId, BlockName, CreatedBy) VALUES (@dN24, @sdBid, N'Rajarhat', @uAdmin), (@dN24, @sdBar, N'Barasat-II', @uAdmin);
DECLARE @bRaj INT = (SELECT BlockId FROM dbo.LegalBlock WHERE BlockName = N'Rajarhat'), @bBar INT = (SELECT BlockId FROM dbo.LegalBlock WHERE BlockName = N'Barasat-II');
INSERT INTO dbo.LegalPoliceStation (DistrictId, StationName, Phone, Address, CreatedBy) VALUES
  (@dN24, N'Rajarhat PS', N'033 2570 1100', N'Rajarhat Main Road, Kolkata 700135', @uAdmin),
  (@dN24, N'New Town PS', N'033 2324 5100', N'Action Area I, New Town, Kolkata 700156', @uAdmin),
  (@dN24, N'Barasat PS', N'033 2552 3220', N'Taki Road, Barasat 700124', @uAdmin);
DECLARE @psRaj INT = (SELECT PoliceStationId FROM dbo.LegalPoliceStation WHERE StationName = N'Rajarhat PS'), @psBar INT = (SELECT PoliceStationId FROM dbo.LegalPoliceStation WHERE StationName = N'Barasat PS');
INSERT INTO dbo.LegalMunicipality (DistrictId, BodyName, BodyType, WardCount, Phone, Address, CreatedBy) VALUES
  (@dN24, N'Bidhannagar Municipal Corporation', N'Municipal Corporation', 41, N'033 2337 0000', N'DD-36, Sector I, Salt Lake, Kolkata 700064', @uAdmin),
  (@dN24, N'Rajarhat Gram Panchayat', N'Gram Panchayat', 14, N'033 2570 2200', N'Rajarhat Chowmatha, Kolkata 700135', @uAdmin);
DECLARE @muBMC INT = (SELECT MunicipalityId FROM dbo.LegalMunicipality WHERE BodyName = N'Bidhannagar Municipal Corporation'), @muGP INT = (SELECT MunicipalityId FROM dbo.LegalMunicipality WHERE BodyName = N'Rajarhat Gram Panchayat');
INSERT INTO dbo.LegalMouza (MouzaName, JLNo, District, SubDivision, Block, PoliceStation, Pincode, Remarks, DistrictId, SubDivisionId, BlockId, PoliceStationId, CreatedBy) VALUES
  (N'Rajarhat', N'105', N'North 24 Parganas', N'Bidhannagar', N'Rajarhat', N'Rajarhat PS', N'700135', N'Main road frontage; mixed Sali and Bastu land', @dN24, @sdBid, @bRaj, @psRaj, @uAdmin),
  (N'Chandpur', N'31', N'North 24 Parganas', N'Bidhannagar', N'Rajarhat', N'Rajarhat PS', N'700135', N'Canal-side agricultural belt', @dN24, @sdBid, @bRaj, @psRaj, @uAdmin),
  (N'Kadampukur', N'27', N'North 24 Parganas', N'Barasat Sadar', N'Barasat-II', N'Barasat PS', N'700126', N'Near Kadampukur bus stand', @dN24, @sdBar, @bBar, @psBar, @uAdmin);
DECLARE @mRaj INT = (SELECT MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Rajarhat' AND JLNo = N'105'), @mCha INT = (SELECT MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Chandpur'),
        @mKad INT = (SELECT MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Kadampukur');
INSERT INTO dbo.LegalVillage (DistrictId, VillageName, PoliceStationId, MunicipalityId, MouzaId, Pincode, BlockId, CreatedBy) VALUES
  (@dN24, N'Rajarhat', @psRaj, @muGP, @mRaj, N'700135', @bRaj, @uAdmin),
  (@dN24, N'Chandpur', @psRaj, @muGP, @mCha, N'700135', @bRaj, @uAdmin),
  (@dN24, N'Kadampukur', @psBar, NULL, @mKad, N'700126', @bBar, @uAdmin);
DECLARE @vRaj INT = (SELECT VillageId FROM dbo.LegalVillage WHERE VillageName = N'Rajarhat'), @vKad INT = (SELECT VillageId FROM dbo.LegalVillage WHERE VillageName = N'Kadampukur');
INSERT INTO dbo.LegalLandType (LandTypeCode, LandTypeName, ConversionNeeded, Description, CreatedBy)
  SELECT v.c, v.n, v.cv, v.d, @uAdmin FROM (VALUES (N'SALI', N'Sali (agricultural)', 1, N'Paddy land — conversion needed before building'),
    (N'BASTU', N'Bastu (homestead)', 0, N'Homestead land — no conversion needed'), (N'DANGA', N'Danga (high land)', 1, N'High land — conversion needed')) v(c, n, cv, d)
  WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLandType x WHERE x.LandTypeCode = v.c);
DECLARE @ltSali INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'SALI'), @ltBastu INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'BASTU');

-- Registration offices (by office type)
INSERT INTO dbo.LegalRegistrationOffice (OfficeCode, OfficeName, OfficeType, State, District, Jurisdiction, Address, Phone, Email, DistrictId, OfficeTypeId, CreatedBy)
SELECT v.code, v.nm, t.TypeName, N'West Bengal', N'North 24 Parganas', v.j, v.a, v.ph, v.em, @dN24, t.OfficeTypeId, @uAdmin
FROM (VALUES (N'ADSR-RJH', N'ADSR Rajarhat', N'ADSR', N'Rajarhat and New Town mouzas', N'Rajarhat Chowmatha, Kolkata 700135', N'033 2570 3300', N'adsr.rajarhat@wb.gov.in'),
             (N'DSR-BRS', N'DSR Barasat', N'DSR', N'North 24 Parganas district', N'Collectorate Building, Barasat 700124', N'033 2552 1010', N'dsr.barasat@wb.gov.in'),
             (N'RA-KOL', N'Registrar of Assurances, Kolkata', N'RA Calcutta', N'Whole of West Bengal (old records)', N'5 Government Place North, Kolkata 700001', N'033 2248 1111', N'ra.kolkata@wb.gov.in'),
             (N'BLRO-RJH', N'BL&LRO Rajarhat', N'BLRO', N'Rajarhat block land records', N'Rajarhat Block Office, Kolkata 700135', N'033 2570 4400', N'blro.rajarhat@wb.gov.in')) v(code, nm, tp, j, a, ph, em)
JOIN dbo.LegalRegistrationOfficeType t ON t.TypeName = v.tp;
DECLARE @oADSR INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'ADSR-RJH'), @oDSR INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'DSR-BRS'),
        @oRA INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'RA-KOL'), @oBLRO INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'BLRO-RJH');
UPDATE dbo.LegalPortalLink SET OfficeId = @oADSR WHERE OfficeId IS NULL;

-- RS / LR registers
INSERT INTO dbo.LegalRsKhatian (MouzaId, KhatianNo, HolderName, GuardianName, HolderAddress, Share, Remarks, CreatedBy) VALUES
  (@mRaj, N'94', N'Nitai Sarkar', N'Late Haren Sarkar', N'Rajarhat, North 24 Parganas', N'1.00', N'RS 1956 holder', @uEntry),
  (@mRaj, N'97', N'Haripada Ghosh', N'Late Satish Ghosh', N'Rajarhat, North 24 Parganas', N'1.00', N'RS 1956 holder', @uEntry),
  (@mKad, N'84', N'Abdul Rahman', N'Late Karim Rahman', N'Kadampukur, North 24 Parganas', N'1.00', N'RS 1956 holder', @uEntry);
INSERT INTO dbo.LegalRsPlot (MouzaId, PlotNo, RsKhatianId, LandClass, Area, AreaUnitId, ProjectId, ParcelStatus, Remarks, CreatedBy)
SELECT k.MouzaId, v.plot, k.RsKhatianId, v.cls, v.area, @DEC, @P, v.st, N'Demo RS plot', @uEntry
FROM (VALUES (N'94', N'418', N'Sali', 16.5, N'Acquired'), (N'97', N'425', N'Bastu', 11.5, N'Under acquisition'), (N'84', N'149', N'Sali', 13.2, N'Under acquisition')) v(kh, plot, cls, area, st)
JOIN dbo.LegalRsKhatian k ON k.KhatianNo = v.kh;
INSERT INTO dbo.LegalLrRor (MouzaId, LrKhatianNo, LrPlotNo, RsPlotId, HolderName, GuardianName, LandClass, Area, AreaUnitId, Share, RorDate, CopyType, Source, Remarks, CreatedBy)
SELECT p.MouzaId, v.lk, v.lp, p.RsPlotId, v.h, v.g, p.LandClass, p.Area, @DEC, N'0.50', DATEADD(year, -3, @today), N'Online Copy', N'Banglarbhumi', N'Demo LR RoR', @uEntry
FROM (VALUES (N'418', N'2215', N'1376', N'Bimal Sarkar', N'Late Nitai Sarkar'), (N'418', N'2216', N'1376', N'Kamal Sarkar', N'Late Nitai Sarkar'),
             (N'425', N'2241', N'1389', N'Sukanta Ghosh', N'Haripada Ghosh'), (N'149', N'915', N'588', N'Rafiq Rahman', N'Late Abdul Rahman')) v(rp, lk, lp, h, g)
JOIN dbo.LegalRsPlot p ON p.PlotNo = v.rp;

-- Persons (sellers, buyer, owner, witness), advocates
INSERT INTO dbo.LegalPerson (PersonRole, FullName, GuardianName, Pan, Aadhaar, Phone, Email, Address, IdProofFileId, LandDocTypeId, LandDocNo, LandDocFileId, Remarks, PartyType, DateOfBirth, Gender, CreatedBy)
SELECT v.r, v.n, v.g, v.pan, v.aad, v.ph, v.em, v.ad, @fPdf, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'Sale Deed'), v.dn, @fPdf, N'Demo person', v.pt, v.dob, v.gen, @uEntry
FROM (VALUES (N'Seller', N'Bimal Sarkar', N'Late Nitai Sarkar', N'BSRPS1234K', N'XXXX XXXX 4521', N'9830012345', N'bimal.sarkar@example.com', N'12 Station Road, Rajarhat 700135', N'I-0418/2004', N'Individual', '1968-04-12', N'Male'),
             (N'Seller', N'Kamal Sarkar', N'Late Nitai Sarkar', N'KSRPS5678L', N'XXXX XXXX 7710', N'9830054321', N'kamal.sarkar@example.com', N'12 Station Road, Rajarhat 700135', N'I-0418/2004', N'Individual', '1971-09-03', N'Male'),
             (N'Seller', N'Sukanta Ghosh', N'Haripada Ghosh', N'SGHPG4321M', N'XXXX XXXX 1198', N'9831122334', N'sukanta.ghosh@example.com', N'4 Chowmatha Lane, Rajarhat 700135', N'I-0874/2009', N'Individual', '1975-01-20', N'Male'),
             (N'Seller', N'Rafiq Rahman', N'Late Abdul Rahman', N'RRAAR8765N', N'XXXX XXXX 3302', N'9832200110', N'rafiq.rahman@example.com', N'Kadampukur Bazar, Barasat 700126', N'I-0588/1999', N'Individual', '1965-11-30', N'Male'),
             (N'Buyer', N'Rajwada Developers Pvt Ltd', NULL, N'AABCR1234D', NULL, N'03340001234', N'legal@rajwada.example.com', N'Salt Lake Sector V, Kolkata 700091', NULL, N'Company', NULL, NULL),
             (N'Owner', N'Nitai Sarkar', N'Late Haren Sarkar', NULL, NULL, N'9830000001', NULL, N'Rajarhat 700135', N'RS-94', N'Individual', '1935-02-01', N'Male'),
             (N'Witness', N'Tapas Mondal', N'Late Gour Mondal', N'TMNGM2468P', N'XXXX XXXX 8809', N'9874455667', N'tapas.mondal@example.com', N'Rajarhat 700135', NULL, N'Individual', '1980-07-15', N'Male')) v(r, n, g, pan, aad, ph, em, ad, dn, pt, dob, gen);
DECLARE @pBimal INT = (SELECT PersonId FROM dbo.LegalPerson WHERE FullName = N'Bimal Sarkar'), @pKamal INT = (SELECT PersonId FROM dbo.LegalPerson WHERE FullName = N'Kamal Sarkar'),
        @pSukanta INT = (SELECT PersonId FROM dbo.LegalPerson WHERE FullName = N'Sukanta Ghosh'), @pRafiq INT = (SELECT PersonId FROM dbo.LegalPerson WHERE FullName = N'Rafiq Rahman'),
        @pBuyer INT = (SELECT PersonId FROM dbo.LegalPerson WHERE FullName = N'Rajwada Developers Pvt Ltd'), @pNitai INT = (SELECT PersonId FROM dbo.LegalPerson WHERE FullName = N'Nitai Sarkar');
INSERT INTO dbo.LegalAdvocate (AdvocateName, EnrolmentNo, BarCouncil, Practice, CourtOfPractice, Pan, Phone, Email, Address, EnrolmentFileId, FeeTerms, CreatedBy) VALUES
  (N'Adv. Sumana Roy', N'WB/1234/2005', N'Bar Council of West Bengal', N'Property / Conveyancing', N'Barasat District Court', N'ARSPR1111Q', N'9830098300', N'sumana.roy@example.com', N'Barasat Court Chamber 12', @fPdf, N'₹25,000 per title report', @uAdmin),
  (N'Adv. Arijit Basu', N'WB/5678/2010', N'Bar Council of West Bengal', N'Civil', N'Calcutta High Court', N'ABASU2222R', N'9831198311', N'arijit.basu@example.com', N'Old Post Office Street, Kolkata 700001', @fPdf, N'₹5,000 per hearing', @uAdmin);
DECLARE @adv1 INT = (SELECT AdvocateId FROM dbo.LegalAdvocate WHERE EnrolmentNo = N'WB/1234/2005'), @adv2 INT = (SELECT AdvocateId FROM dbo.LegalAdvocate WHERE EnrolmentNo = N'WB/5678/2010');

-- Approval Control
INSERT INTO dbo.LegalApprovalAuthority (Stage, ApproverId, Remarks, CreatedBy)
SELECT v.s, v.u, N'Demo role', @uAdmin FROM (VALUES (N'Verifier', @uVer), (N'Approver', @uApp), (N'L1 Approver', @uApp), (N'L2 Approver', @uL2), (N'Legal Reviewer', @uRev),
  (N'Amendment Approver', @uApp), (N'Legal Admin', @uLegalAdmin), (N'Search Executive', @uSearch)) v(s, u)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalApprovalAuthority a WHERE a.Stage = v.s AND a.ApproverId = v.u);

-- ── Enquiries (TEST RESIDENCE) ──────────────────────────────────────────────────────────────────
DECLARE @E TABLE (k INT, no NVARCHAR(30), loc NVARCHAR(200), m INT, jl NVARCHAR(10), rd NVARCHAR(30), ld NVARCHAR(30), rk NVARCHAR(30), lk NVARCHAR(30),
  area DECIMAL(10,2), price DECIMAL(18,2), st NVARCHAR(40), ago INT, src NVARCHAR(40), contact NVARCHAR(100), phone NVARCHAR(15));
INSERT INTO @E VALUES
  (1, N'TR-ENQ-0001', N'Test Residence phase 2 — east corner', @mRaj, N'105', N'441', N'1410', N'221', N'2290', 6, 3600000, N'New', 2, N'Broker', N'Prasanta Halder', N'9830111222'),
  (2, N'TR-ENQ-0002', N'Behind Rajarhat bus depot', @mRaj, N'105', N'452', N'1433', N'226', N'2302', 4, 2600000, N'Under Review', 20, N'Direct Owner', N'Sukanta Ghosh', N'9831122334'),
  (3, N'TR-ENQ-0003', N'Canal-side plot, Chandpur', @mCha, N'31', N'233', N'702', N'119', N'1264', 8, 4800000, N'Interested', 35, N'Reference', N'Gopal Das', N'9874001122'),
  (4, N'TR-ENQ-0004', N'Kadampukur bus stand, east side', @mKad, N'27', N'157', N'602', N'88', N'941', 5, 3100000, N'On Hold', 12, N'Website', N'Rina Das', N'9831455566'),
  (5, N'TR-ENQ-0005', N'Low land near Kadampukur bheri', @mKad, N'27', N'171', N'630', N'95', N'977', 12, 2400000, N'Rejected', 25, N'Walk-in', N'Moslem Ali', N'9832277788'),
  (6, N'TR-ENQ-0006', N'Rajarhat main road, north plot', @mRaj, N'105', N'418', N'1376', N'94', N'2215', 5, 3000000, N'Converted to Land Record', 60, N'Direct Owner', N'Bimal Sarkar', N'9830012345'),
  (7, N'TR-ENQ-0007', N'Chowmatha junction plot, Rajarhat', @mRaj, N'105', N'425', N'1389', N'97', N'2241', 7, 4200000, N'Converted to Land Record', 90, N'Broker', N'Sukanta Ghosh', N'9831122334'),
  (8, N'TR-ENQ-0008', N'Kadampukur canal road', @mKad, N'27', N'149', N'588', N'84', N'915', 8, 4800000, N'Converted to Land Record', 120, N'Reference', N'Rafiq Rahman', N'9832200110'),
  (9, N'TR-ENQ-0009', N'Kadampukur market back plot', @mKad, N'27', N'140', N'571', N'80', N'902', 6, 3600000, N'Converted to Land Record', 160, N'Broker', N'Rafiq Rahman', N'9832200110');
INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId, ContactPerson, ContactNumber, ExpectedPrice,
    AssignedUserId, EnquiryStatus, InitialDocFileId, InitialNotes, IsActive, CreatedBy, CreatedAt, GpsLatitude, GpsLongitude, EnquiryByName, FinYear, ProjectId,
    RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, RegistryOfficeType, DeedArea)
SELECT e.no, DATEADD(day, -e.ago, @today), (SELECT id FROM @L WHERE c = N'enquiry-source' AND nm = e.src), e.loc, @dN24, e.m, e.jl, e.area, @KATHA, e.contact, e.phone, e.price,
  @uEntry, e.st, @fPdf, CONCAT(N'Demo enquiry (', e.st, N'): ', e.loc, N'. Seller says title is clear; papers shared on WhatsApp.'), 1, @uEntry, DATEADD(day, -e.ago, SYSUTCDATETIME()),
  22.6200 + e.k / 1000.0, 88.4500 + e.k / 1000.0, e.contact, @fy, @P, e.rd, e.ld, e.rk, e.lk, N'ADSR', e.area - 0.25
FROM @E e;
INSERT INTO dbo.LegalEnquiryRsRecord (EnquiryId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, Area, AreaUnitId, Share, Remarks, CreatedBy)
SELECT q.EnquiryId, e.m, e.rk, e.rd, N'Nitai Sarkar', e.area, @KATHA, N'1.00', N'RS record from the seller''s papers', @uEntry FROM @E e JOIN dbo.LegalLandEnquiry q ON q.EnquiryNo = e.no;
INSERT INTO dbo.LegalEnquiryLrRecord (EnquiryId, MouzaId, LrKhatianNo, LrDagNo, MatchingRsRecordId, RecordedHolder, Area, AreaUnitId, Share, Remarks, CreatedBy)
SELECT q.EnquiryId, e.m, e.lk, e.ld, r.RsRecordId, e.contact, e.area, @KATHA, N'1.00', N'LR record from Banglarbhumi', @uEntry
FROM @E e JOIN dbo.LegalLandEnquiry q ON q.EnquiryNo = e.no JOIN dbo.LegalEnquiryRsRecord r ON r.EnquiryId = q.EnquiryId;
-- Office timelines and year-by-year deed search (found years + the rest Not Found) for the converted / advanced enquiries.
INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeType, OfficeId, SlaDays, DueDate, Status, OfficeTypeId, FromYear)
SELECT q.EnquiryId, t.TypeName, CASE t.TypeName WHEN N'ADSR' THEN @oADSR WHEN N'DSR' THEN @oDSR WHEN N'RA Calcutta' THEN @oRA WHEN N'BLRO' THEN @oBLRO END,
  t.SlaDays, DATEADD(day, t.SlaDays, q.EnquiryDate), N'Pending', t.OfficeTypeId, t.FromYear
FROM dbo.LegalLandEnquiry q JOIN @E e ON e.no = q.EnquiryNo JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1;
;WITH y AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < @yr)
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, RequestedAt, CompletedBy, CompletedAt)
SELECT o.EnquiryId, o.OfficeType, o.OfficeId, y.Y,
  CASE WHEN o.OfficeType = N'ADSR' AND y.Y IN (2004, 2011) THEN N'Found' ELSE N'Not Found' END, o.SlaDays, o.DueDate,
  CASE WHEN o.OfficeType = N'ADSR' AND y.Y = 2004 THEN CONCAT(N'I-', e.rd, N'/2004') WHEN o.OfficeType = N'ADSR' AND y.Y = 2011 THEN CONCAT(N'I-', e.ld, N'/2011') END,
  CASE WHEN o.OfficeType = N'ADSR' AND y.Y IN (2004, 2011) THEN DATEFROMPARTS(y.Y, 3, 15) END,
  CASE WHEN o.OfficeType = N'ADSR' AND y.Y = 2004 THEN N'Nitai Sarkar → Bimal & Kamal Sarkar' WHEN o.OfficeType = N'ADSR' AND y.Y = 2011 THEN CONCAT(N'Previous owner → ', e.contact) END,
  CASE WHEN o.OfficeType = N'ADSR' AND y.Y IN (2004, 2011) THEN N'Deed index matched the RS / LR Dag.' END,
  N'WB Registration (wbregistration.gov.in)', @uSearch, SYSUTCDATETIME(), @uSearch, SYSUTCDATETIME()
FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry q ON q.EnquiryId = o.EnquiryId JOIN @E e ON e.no = q.EnquiryNo CROSS JOIN y
WHERE e.k IN (3, 6, 7, 8, 9) OR (e.k = 2 AND o.OfficeType IN (N'ADSR', N'BLRO'))
OPTION (MAXRECURSION 400);
UPDATE o SET Status = N'Completed', CompletedBy = @uSearch, CompletedAt = SYSUTCDATETIME(),
  Remarks = CONCAT(N'1956–', @yr, N' searched; ', CASE WHEN o.OfficeType = N'ADSR' THEN N'2 deeds found' ELSE N'nothing found' END, N'.')
FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry q ON q.EnquiryId = o.EnquiryId JOIN @E e ON e.no = q.EnquiryNo
WHERE e.k IN (3, 6, 7, 8, 9) OR (e.k = 2 AND o.OfficeType IN (N'ADSR', N'BLRO'));

-- ── Lands (from the converted enquiries) ────────────────────────────────────────────────────────
DECLARE @LD TABLE (k INT, code NVARCHAR(30), wf NVARCHAR(40), vs NVARCHAR(20), ls NVARCHAR(40), lt INT, rkId INT, rpId INT, lrId INT);
INSERT INTO @LD (k, code, wf, vs, ls, lt) VALUES
  (6, N'TR/00001/2026-27', N'Draft (Verification Pending)', N'Draft', N'Identified', NULL),
  (7, N'TR/00002/2026-27', N'Deed Process', N'Verified', N'Agreement Done', NULL),
  (8, N'TR/00003/2026-27', N'Deed Registration', N'Verified', N'Agreement Done', NULL),
  (9, N'TR/00004/2026-27', N'Registered', N'Verified', N'Registered', NULL);
UPDATE d SET lt = CASE WHEN d.k IN (6, 8) THEN @ltSali ELSE @ltBastu END FROM @LD d;
INSERT INTO dbo.LegalLand (LandCode, LandName, ProjectId, DistrictId, VillageId, PoliceStationId, MunicipalityId, MouzaId, LandTypeId, Area, AreaUnitId, OwnerId, LandStatus,
    LandDocTypeId, LandDocNo, LandDocFileId, Remarks, IsActive, CreatedBy, CreatedAt, SubDivisionId, BlockId, LocationTypeId, LocationAddress,
    NorthBoundary, SouthBoundary, EastBoundary, WestBoundary, GpsLatitude, GpsLongitude, MapFileId, EnquiryId, WorkflowStatus, IsOnHold, IsCancelled, EntryType,
    PossessionStatus, AcquisitionDate, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, AcquisitionType, VerificationStatus, L1Status, L2Status,
    OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent, SellerContact)
SELECT d.code, e.loc, @P, @dN24, CASE WHEN e.m = @mKad THEN @vKad ELSE @vRaj END, CASE WHEN e.m = @mKad THEN @psBar ELSE @psRaj END, CASE WHEN e.m = @mKad THEN NULL ELSE @muBMC END,
  e.m, d.lt, e.area, @KATHA, CASE e.k WHEN 6 THEN @pBimal WHEN 7 THEN @pSukanta ELSE @pRafiq END, d.ls,
  (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = N'Sale Deed'), CONCAT(N'I-', e.rd, N'/2004'), @fPdf, N'Demo land — Test Residence', 1, @uEntry, DATEADD(day, -e.ago + 5, SYSUTCDATETIME()),
  CASE WHEN e.m = @mKad THEN @sdBar ELSE @sdBid END, CASE WHEN e.m = @mKad THEN @bBar ELSE @bRaj END, (SELECT id FROM @L WHERE c = N'location-type' AND nm = N'Road-side'),
  CONCAT(e.loc, N', North 24 Parganas, West Bengal'), N'Plot of Haren Mondal', N'12 ft municipal road', N'Canal reserve', N'Plot of Gopal Das',
  22.6200 + e.k / 1000.0, 88.4500 + e.k / 1000.0, @fMap, q.EnquiryId, d.wf, 0, 0, N'New Acquisition',
  CASE WHEN d.k = 9 THEN N'In Possession' ELSE N'Not in Possession' END, CASE WHEN d.k = 9 THEN DATEADD(day, -20, @today) END,
  e.rd, e.ld, e.rk, e.lk, N'Purchase', d.vs, N'Pending', N'Pending',
  N'Joint', N'Purchase', CASE WHEN d.k = 6 THEN N'Pending' ELSE N'Verified' END, CASE WHEN d.k = 6 THEN N'Pending' ELSE N'Has authority' END,
  CASE WHEN d.k = 6 THEN N'Pending' ELSE N'All owners consented' END, e.phone
FROM @LD d JOIN @E e ON e.k = d.k JOIN dbo.LegalLandEnquiry q ON q.EnquiryNo = e.no;
UPDATE q SET LandId = l.LandId FROM dbo.LegalLandEnquiry q JOIN dbo.LegalLand l ON l.EnquiryId = q.EnquiryId WHERE l.LandCode LIKE N'TR/%';
DECLARE @l1 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00001/2026-27'), @l2 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00002/2026-27'),
        @l3 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00003/2026-27'), @l4 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00004/2026-27');
-- Link the register rows to the lands
UPDATE l SET RsKhatianId = k.RsKhatianId, RsPlotId = p.RsPlotId, LrRorId = r.LrRorId
FROM dbo.LegalLand l JOIN dbo.LegalRsPlot p ON p.PlotNo = l.RsDagNo JOIN dbo.LegalRsKhatian k ON k.RsKhatianId = p.RsKhatianId
OUTER APPLY (SELECT TOP 1 LrRorId FROM dbo.LegalLrRor x WHERE x.RsPlotId = p.RsPlotId ORDER BY x.LrRorId) r WHERE l.LandCode LIKE N'TR/%';

-- Every land: owners, RS / LR records, parties, ownership history, restrictions, checks
DECLARE @lands TABLE (LandId INT, k INT);
INSERT INTO @lands SELECT l.LandId, d.k FROM dbo.LegalLand l JOIN @LD d ON d.code = l.LandCode;
INSERT INTO dbo.LegalOwnershipRecord (LandId, PersonId, OwnershipTypeId, RelationshipTypeId, SharePct, ValidFrom, PreviousPersonId, TransferDocFileId, VerificationStatus, VerifiedBy, VerifiedAt,
    VerificationRemarks, CreatedBy, OwnerName, OwnerGuardian, PreviousOwnerName)
SELECT x.LandId, v.p, (SELECT id FROM @L WHERE c = N'ownership-type' AND nm = N'Joint'), (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = N'Son'), 50, '2004-05-10', @pNitai, @fPdf,
  N'Verified', @uVer, SYSUTCDATETIME(), N'Matched with LR RoR and the 2004 deed', @uEntry, v.n, N'Late Nitai Sarkar', N'Nitai Sarkar'
FROM @lands x CROSS JOIN (VALUES (@pBimal, N'Bimal Sarkar'), (@pKamal, N'Kamal Sarkar')) v(p, n);
INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordDate, RecordedHolder, LandTypeId, Area, AreaUnitId, Share, CopyTypeId, Source, DocFileId, VerificationStatus, Remarks,
    CreatedBy, VerifiedBy, VerifiedAt, RsKhatianId, RsPlotId)
SELECT l.LandId, l.MouzaId, l.RsKhatianNo, l.RsDagNo, '1956-06-30', N'Nitai Sarkar', l.LandTypeId, l.Area, l.AreaUnitId, N'1.00', (SELECT id FROM @L WHERE c = N'copy-type' AND nm = N'Certified Copy'),
  N'BL&LRO Rajarhat', @fPdf, N'Verified', N'RS 1956 record', @uEntry, @uVer, SYSUTCDATETIME(), l.RsKhatianId, l.RsPlotId FROM dbo.LegalLand l JOIN @lands x ON x.LandId = l.LandId;
INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, MatchingRsRecordId, GuardianName, RorDate, RecordedHolder, LandTypeId, Area, AreaUnitId, Share, CopyTypeId, Source, DocFileId,
    VerificationStatus, Remarks, CreatedBy, VerifiedBy, VerifiedAt, LrRorId)
SELECT l.LandId, l.MouzaId, l.LrKhatianNo, l.LrDagNo, r.RsRecordId, N'Late Nitai Sarkar', DATEADD(year, -3, @today), N'Bimal Sarkar & Kamal Sarkar', l.LandTypeId, l.Area, l.AreaUnitId, N'0.50 each',
  (SELECT id FROM @L WHERE c = N'copy-type' AND nm = N'Online Copy'), N'Banglarbhumi', @fPdf, N'Verified', N'LR RoR matches RS', @uEntry, @uVer, SYSUTCDATETIME(), l.LrRorId
FROM dbo.LegalLand l JOIN @lands x ON x.LandId = l.LandId JOIN dbo.LegalLandRsRecord r ON r.LandId = l.LandId;
INSERT INTO dbo.LegalLandParty (LandId, PersonId, LandRole, RelationshipTypeId, SharePct, Remarks, CreatedBy)
SELECT x.LandId, v.p, v.r, (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = v.rel), v.s, N'Demo party', @uEntry
FROM @lands x CROSS JOIN (VALUES (@pBimal, N'Seller', N'Self', 50), (@pKamal, N'Seller', N'Brother', 50), (@pBuyer, N'Buyer', N'Other', NULL), (@pNitai, N'Previous Owner', N'Father', NULL)) v(p, r, rel, s);
INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, PreviousOwnerId, NewOwnerId, DeedNo, RegistrationOfficeId, RegistrationDate, TransferArea, AreaUnitId, TransferSharePct,
    TransferValue, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy, PreviousOwnerName, PreviousOwnerGuardian, NewOwnerName, NewOwnerGuardian, DocTypeId, DocumentNo, DeedTypeId)
SELECT x.LandId, (SELECT id FROM @L WHERE c = N'transfer-type' AND nm = v.t), v.d, v.pp, v.np, v.deed, @oADSR, v.d, l.Area, l.AreaUnitId, 100, v.val, @fPdf, N'Verified', @uVer, SYSUTCDATETIME(),
  v.rem, @uEntry, v.pn, v.pg, v.nn, v.ng, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = v.dt), v.deed, (SELECT DeedTypeId FROM dbo.LegalDeedType WHERE DeedTypeCode = v.dtc)
FROM @lands x JOIN dbo.LegalLand l ON l.LandId = x.LandId
CROSS JOIN (VALUES (N'Sale', '1962-02-11', NULL, @pNitai, N'I-0221/1962', 4500, N'Haren Sarkar', NULL, N'Nitai Sarkar', N'Late Haren Sarkar', N'Sale Deed', N'SALE', N'First purchase recorded in RS'),
                   (N'Inheritance', '2004-05-10', @pNitai, @pBimal, N'I-0418/2004', NULL, N'Nitai Sarkar', N'Late Haren Sarkar', N'Bimal Sarkar & Kamal Sarkar', N'Late Nitai Sarkar', N'Partition Deed', N'GIFT', N'Inherited by two sons in equal shares')) v(t, d, pp, np, deed, val, pn, pg, nn, ng, dt, dtc, rem);
INSERT INTO dbo.LegalInheritance (LandId, DeceasedPersonId, DateOfDeath, DeathCertFileId, HeirCertFileId, SupportingType, SupportingFileId, MutationRecordNo, VerificationStatus, VerifiedBy, VerifiedAt,
    Remarks, CreatedBy, DeceasedName, DeceasedGuardian, DisputePending, FamilyTreeFileId, SuccessionLaw, ShareDecision, ShareDecisionBy, ShareDecisionAt, ShareDecisionRemarks)
SELECT x.LandId, @pNitai, '2003-11-02', @fPdf, @fPdf, N'Succession Certificate', @fPdf, N'MR/RJH/2004/118', N'Verified', @uVer, SYSUTCDATETIME(), N'Two sons are the only heirs', @uEntry,
  N'Nitai Sarkar', N'Late Haren Sarkar', 0, @fPdf, N'Hindu Succession Act, 1956', N'Equal shares', @uRev, SYSUTCDATETIME(), N'50 : 50 as per the succession certificate'
FROM @lands x;
INSERT INTO dbo.LegalInheritanceHeir (LandId, InheritanceId, PersonId, RelationshipTypeId, SharePct, Remarks, CreatedBy, HeirName, HeirGuardian, HeirRole, BranchOf, Relinquished)
SELECT i.LandId, i.InheritanceId, v.p, (SELECT id FROM @L WHERE c = N'relationship-type' AND nm = N'Son'), 50, N'Class I heir', @uEntry, v.n, N'Late Nitai Sarkar', N'Son', N'Nitai Sarkar', 0
FROM dbo.LegalInheritance i JOIN @lands x ON x.LandId = i.LandId CROSS JOIN (VALUES (@pBimal, N'Bimal Sarkar'), (@pKamal, N'Kamal Sarkar')) v(p, n);
INSERT INTO dbo.LegalPartition (LandId, PartitionType, PartitionDate, PartiesInvolved, ShareDetails, NewReferences, DeedFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT LandId, N'Family Settlement', '2006-08-20', N'Bimal Sarkar, Kamal Sarkar', N'East half to Bimal, west half to Kamal', N'LR Khatian split 2215 / 2216', @fPdf, N'Verified', @uVer, SYSUTCDATETIME(), N'Registered family settlement', @uEntry FROM @lands;
INSERT INTO dbo.LegalPropertyRestriction (LandId, Category, RestrictionType, ApplicableLaw, PermissionRequired, PermissionFileId, PermissionRef, IssuingAuthority, Status, Remarks, CreatedBy)
SELECT LandId, N'Ceiling restriction', N'Urban land ceiling check', N'WB Land Reforms Act, 1955 s.14M', N'No', @fPdf, N'ULC/NOC/2026/' + CAST(LandId AS NVARCHAR(10)), N'BL&LRO Rajarhat', N'Not restricted', N'Holding below ceiling', @uEntry FROM @lands;
INSERT INTO dbo.LegalOwnershipCheck (LandId, RecordId, CheckItem, Result, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT r.LandId, r.RecordId, v.ci, N'Verified', @uVer, SYSUTCDATETIME(), N'Checked against originals', @uEntry
FROM dbo.LegalOwnershipRecord r JOIN @lands x ON x.LandId = r.LandId CROSS JOIN (VALUES (N'Identity document checked'), (N'Ownership share checked')) v(ci);
INSERT INTO dbo.LegalDueDiligence (LandId, CheckItem, Result, ReviewedBy, ReviewedAt, Findings, DocFileId, CreatedBy)
SELECT x.LandId, v.c, CASE WHEN x.k = 6 AND v.c = N'Encumbrance Search' THEN N'Pending' ELSE N'Clear' END, @uVer, SYSUTCDATETIME(), v.f, @fPdf, @uEntry
FROM @lands x CROSS JOIN (VALUES (N'Title Search', N'Title continuous since 1962'), (N'Encumbrance Search', N'No encumbrance in 13 years'), (N'Court Case Verification', N'One disposed case only'),
                                 (N'RS/LR Record Mapping', N'RS 418 → LR 1376 matched')) v(c, f);
INSERT INTO dbo.LegalVerificationCheck (LandId, CheckType, SearchDate, PeriodFrom, PeriodTo, SearchSource, Result, DocFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT LandId, N'Encumbrance Search', DATEADD(day, -15, @today), DATEFROMPARTS(@yr - 13, 1, 1), @today, N'ADSR Rajarhat EC', N'Not Found', @fPdf, N'Verified', @uVer, SYSUTCDATETIME(), N'No charge found', @uEntry FROM @lands;
INSERT INTO dbo.LegalDiligenceArea (LandId, Area, Status, Remarks, CheckedBy, CheckedAt)
SELECT x.LandId, v.a, CASE WHEN x.k = 6 THEN N'Pending' ELSE N'Verified' END, v.r, @uVer, SYSUTCDATETIME() FROM @lands x
CROSS JOIN (VALUES (N'ownership', N'Both co-owners verified'), (N'inheritance', N'Succession certificate on file'), (N'title', N'Chain continuous; RS / LR match'), (N'documents', N'Deed and RoR on file')) v(a, r);
INSERT INTO dbo.LegalRiskAssessment (LandId, RiskLevel, AutoFlags, Remarks, FileId, AssessedBy)
SELECT LandId, CASE WHEN k = 6 THEN N'Medium' ELSE N'Low' END, N'["old_case_disposed"]', N'Clean title; one disposed civil case', @fPdf, @uRev FROM @lands;

-- Legal records, cases, mortgage, advocates, opinion, clearance
INSERT INTO dbo.LegalCase (LandId, CaseNumber, CaseTypeId, CourtName, FilingDate, Plaintiff, Defendant, CaseSubject, AdvocateId, LegalStatusId, NextHearingDate, CaseResult, DocFileId, VerificationStatus,
    VerifiedBy, VerifiedAt, Remarks, CreatedBy, StayType, StayDetails, LawyerRemarks, ClearedBy, ClearedAt, ClearRemarks)
SELECT LandId, CONCAT(N'T.S. ', 100 + k, N'/2015'), (SELECT id FROM @L WHERE c = N'case-type' AND nm = N'Boundary Dispute'), N'Civil Judge (Jr. Div.), Barasat', '2015-03-10', N'Gopal Das', N'Nitai Sarkar (heirs)',
  N'Boundary on the west side', @adv2, (SELECT id FROM @L WHERE c = N'legal-status' AND nm = N'Disposed'), NULL, N'Dismissed — boundary as per RS map', @fPdf, N'Verified', @uVer, SYSUTCDATETIME(),
  N'Disposed in 2018', @uEntry, N'None', N'No stay in force', N'No effect on title', @uRev, SYSUTCDATETIME(), N'Disposed; cleared' FROM @lands;
INSERT INTO dbo.LegalCaseHearing (LandId, CaseId, HearingDate, Purpose, Outcome, NextDate, DocFileId, Remarks, CreatedBy)
SELECT c.LandId, c.CaseId, v.d, v.p, v.o, NULL, @fPdf, N'Demo hearing', @uEntry FROM dbo.LegalCase c JOIN @lands x ON x.LandId = c.LandId
CROSS JOIN (VALUES ('2016-07-12', N'Evidence', N'Plaintiff evidence closed'), ('2018-01-22', N'Judgment', N'Suit dismissed')) v(d, p, o);
INSERT INTO dbo.LegalLandLegalRecord (LandId, RecordType, CaseNumber, CourtAuthority, PartiesInvolved, FilingDate, OrderDate, RecordStatus, Description, RelatedPerson, DocumentRef, DocFileId,
    VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT LandId, N'Legal Opinion', NULL, N'Adv. Sumana Roy', N'Rajwada Developers / Sarkar brothers', DATEADD(day, -40, @today), DATEADD(day, -38, @today), N'In Force', N'Title opinion: clear and marketable',
  N'Bimal Sarkar', CONCAT(N'OP/', LandId), @fPdf, N'Verified', @uVer, SYSUTCDATETIME(), N'Opinion on file', @uEntry FROM @lands;
INSERT INTO dbo.LegalMortgage (LandId, LenderName, BorrowerName, MortgageTypeId, LoanAccountRef, LoanAmount, OutstandingAmount, LoanStartDate, LoanEndDate, RegistrationDetails, ChargeDetails,
    ReleaseDocFileId, ClearanceDate, MortgageStatus, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy, LoanType, LoanStatus, MortgageDeedNo, MortgageRegDate, LoanClosureDate,
    BankNocDetails, AgreementFileId, MortgageDeedFileId, EncumbranceCertFileId, EncumbranceCertDate, AttachmentOrder, CheckedOn, CheckRemarks)
SELECT LandId, N'State Bank of India, Rajarhat', N'Bimal Sarkar', (SELECT id FROM @L WHERE c = N'mortgage-type' AND nm = N'Equitable Mortgage'), N'SBI/RJH/HL/88231', 800000, 0, '2012-04-01', '2022-03-31',
  N'Deposit of title deeds', N'Charge on RS Dag ' + RsDagNo, @fPdf, '2022-04-15', N'Loan Closed', N'Verified', @uVer, SYSUTCDATETIME(), N'Loan closed; NOC received', @uEntry, N'Home loan', N'Closed',
  N'MD/2012/411', '2012-04-05', '2022-03-31', N'NOC dated 15-04-2022', @fPdf, @fPdf, @fPdf, DATEADD(day, -15, @today), N'None', DATEADD(day, -15, @today), N'EC shows release' FROM dbo.LegalLand l WHERE LandId IN (SELECT LandId FROM @lands);
INSERT INTO dbo.LegalAdvocateAssignment (LandId, AdvocateId, Purpose, AssignedDate, DueDate, AssignmentStatus, Remarks, CreatedBy)
SELECT LandId, @adv1, N'Title Verification', DATEADD(day, -45, @today), DATEADD(day, -30, @today), CASE WHEN k = 6 THEN N'In Progress' ELSE N'Completed' END, N'Title search and opinion', @uEntry FROM @lands;
INSERT INTO dbo.LegalOpinion (OpinionNo, LandId, AdvocateId, OpinionDate, ReviewedFrom, ReviewedTo, Findings, IdentifiedRisks, MissingDocuments, Recommendations, Conditions, FinalOpinion, DocFileId,
    SignatureRef, OpinionStatus, ApprovedBy, ApprovedAt, CreatedBy)
SELECT CONCAT(N'TR-OP-', RIGHT(N'000' + CAST(k AS NVARCHAR(3)), 4)), LandId, @adv1, DATEADD(day, -32, @today), '1956-01-01', @today, N'Title continuous since 1962; heirs recorded; no encumbrance.',
  N'Old boundary suit (disposed)', N'None', N'Proceed with purchase', N'Original mother deed to be shown at registration', N'Title clear and marketable', @fPdf, N'SR/2026/' + CAST(k AS NVARCHAR(3)),
  CASE WHEN k = 6 THEN N'Under Review' ELSE N'Approved' END, CASE WHEN k = 6 THEN NULL ELSE @uRev END, CASE WHEN k = 6 THEN NULL ELSE SYSUTCDATETIME() END, @uEntry FROM @lands;
INSERT INTO dbo.LegalClearance (ClearanceNo, LandId, OpinionId, Decision, DecidedBy, DecidedAt, Conditions, ConditionsMet, BlockingIssues, Remarks, CreatedBy)
SELECT CONCAT(N'TR-CLR-', RIGHT(N'000' + CAST(x.k AS NVARCHAR(3)), 4)), x.LandId, o.OpinionId, CASE WHEN x.k = 6 THEN N'Pending Decision' ELSE N'Cleared with Conditions' END, @uRev, SYSUTCDATETIME(),
  N'Original mother deed at registration', CASE WHEN x.k = 9 THEN 1 ELSE 0 END, NULL, N'Legal clearance', @uEntry FROM @lands x JOIN dbo.LegalOpinion o ON o.LandId = x.LandId;
INSERT INTO dbo.LegalReview (LandId, Status, AdvocateId, ReviewerUserId, AssignedOn, CompletedOn, Opinion, Observations, AdditionalDocs, Recommendation, FileId, CreatedBy)
SELECT LandId, CASE WHEN k = 6 THEN N'In Progress' ELSE N'Legally Cleared' END, @adv1, @uRev, DATEADD(day, -12, @today), CASE WHEN k = 6 THEN NULL ELSE DATEADD(day, -10, @today) END,
  N'Title clear and marketable', N'Heirs recorded properly', N'None', N'Cleared for registration', @fPdf, @uRev FROM @lands;

-- Commercial: purchase transaction, agreement, consents, payments, expenses, valuation, tax, photo, documents
INSERT INTO dbo.LegalLandTransaction (TransactionNo, LandId, TxnType, BuyerName, BuyerId, SellerNames, TxnArea, AreaUnitId, RatePerUnit, TotalValue, AdvanceAmount, AgreementDate,
    ExpectedRegistrationDate, PaymentTerms, BrokerName, BrokerCommission, AdvocateFees, OtherExpenses, AgreementFileId, TxnStatus, Remarks, CreatedBy)
SELECT CONCAT(N'TR-TXN-', RIGHT(N'000' + CAST(x.k AS NVARCHAR(3)), 4)), x.LandId, N'Purchase', N'Rajwada Developers Pvt Ltd', @pBuyer, N'Bimal Sarkar, Kamal Sarkar', l.Area, l.AreaUnitId, 600000,
  l.Area * 600000, 500000, DATEADD(day, -50, @today), DATEADD(day, 20, @today), N'10% advance, balance in 3 instalments before registration', N'Prasanta Halder', 50000, 25000, 15000, @fPdf,
  CASE x.k WHEN 6 THEN N'Negotiation' WHEN 9 THEN N'Registered' ELSE N'Payment in Progress' END, N'Demo purchase', @uEntry FROM @lands x JOIN dbo.LegalLand l ON l.LandId = x.LandId;
INSERT INTO dbo.LegalAgreement (AgreementNo, LandId, TransactionId, AgreementType, AgreedArea, AreaUnitId, AgreedRate, TotalValue, AdvanceAmount, PaymentSchedule, AgreementDate, ExpectedRegistrationDate,
    ExpiryDate, Terms, BrokerDetails, AdvocateId, AgreementFileId, BuyerSignature, SellerSignature, AgreementStatus, ApprovedBy, ApprovedAt, Remarks, CreatedBy)
SELECT CONCAT(N'TR-AGR-', RIGHT(N'000' + CAST(x.k AS NVARCHAR(3)), 4)), x.LandId, t.TransactionId, N'Agreement for Sale', t.TxnArea, t.AreaUnitId, t.RatePerUnit, t.TotalValue, t.AdvanceAmount,
  N'Advance + 3 instalments', t.AgreementDate, t.ExpectedRegistrationDate, DATEADD(month, 6, t.AgreementDate), N'Vacant possession at registration; seller clears khajna', N'Prasanta Halder, 2%', @adv1, @fPdf,
  N'Signed', CASE WHEN x.k = 6 THEN N'Pending' ELSE N'Signed' END, CASE WHEN x.k = 6 THEN N'Awaiting Signature' ELSE N'Signed' END, @uApp, SYSUTCDATETIME(), N'Demo agreement', @uEntry
FROM @lands x JOIN dbo.LegalLandTransaction t ON t.LandId = x.LandId;
INSERT INTO dbo.LegalPartyApproval (LandId, AgreementId, PartyName, PersonId, PartyRole, OwnershipSharePct, ConsentStatus, RecordedBy, RecordedAt, ApprovalDate, SignatureFileId, IdVerification, Remarks, CreatedBy)
SELECT a.LandId, a.AgreementId, v.n, v.p, N'Seller', 50, CASE WHEN x.k = 6 THEN N'Signature Pending' ELSE N'Approved' END, @uEntry, SYSUTCDATETIME(), DATEADD(day, -48, @today), @fPdf, N'Verified', N'Co-owner consent', @uEntry
FROM dbo.LegalAgreement a JOIN @lands x ON x.LandId = a.LandId CROSS JOIN (VALUES (@pBimal, N'Bimal Sarkar'), (@pKamal, N'Kamal Sarkar')) v(p, n);
INSERT INTO dbo.LegalPayment (LandId, TransactionId, PaymentDate, TxnTypeId, Amount, PaymentModeId, Payer, Payee, BankRef, TransactionRef, ReceiptNo, ReceiptFileId, VerificationStatus, VerifiedBy, VerifiedAt,
    Remarks, CreatedBy, PaymentStatus)
SELECT t.LandId, t.TransactionId, v.d, (SELECT id FROM @L WHERE c = N'txn-type' AND nm = v.tt), v.a, (SELECT id FROM @L WHERE c = N'payment-mode' AND nm = N'RTGS'), N'Rajwada Developers Pvt Ltd',
  N'Bimal Sarkar & Kamal Sarkar', N'HDFC0000123', CONCAT(N'RTGS-', t.TransactionId, N'-', v.n), CONCAT(N'RCPT-', t.TransactionId, N'-', v.n), @fPdf, N'Verified', @uApp, SYSUTCDATETIME(), v.r, @uEntry, N'Paid'
FROM dbo.LegalLandTransaction t JOIN @lands x ON x.LandId = t.LandId
CROSS JOIN (VALUES (1, DATEADD(day, -50, @today), N'Advance', 500000, N'Advance on agreement'), (2, DATEADD(day, -20, @today), N'Purchase Payment', 1000000, N'Second instalment')) v(n, d, tt, a, r)
WHERE x.k <> 6 OR v.n = 1;
INSERT INTO dbo.LegalPaymentSchedule (LandId, DueDate, Amount, TxnTypeId, Remarks, CreatedBy, SharePct, Label)
SELECT t.LandId, v.d, t.TotalValue * v.s / 100, (SELECT id FROM @L WHERE c = N'txn-type' AND nm = v.tt), v.r, @uEntry, v.s, v.l
FROM dbo.LegalLandTransaction t JOIN @lands x ON x.LandId = t.LandId
CROSS JOIN (VALUES (DATEADD(day, -50, @today), 10, N'Advance', N'On agreement', N'Advance'), (DATEADD(day, -20, @today), 30, N'Purchase Payment', N'Second instalment', N'Instalment 1'),
                   (DATEADD(day, 10, @today), 30, N'Purchase Payment', N'Third instalment', N'Instalment 2'), (DATEADD(day, 25, @today), 30, N'Final Payment', N'At registration', N'Balance')) v(d, s, tt, r, l);
INSERT INTO dbo.LegalExpense (LandId, TransactionId, ExpenseTypeId, ExpenseDate, Amount, PaidTo, PaymentModeId, ReceiptFileId, Remarks, CreatedBy)
SELECT t.LandId, t.TransactionId, (SELECT id FROM @L WHERE c = N'expense-type' AND nm = v.e), DATEADD(day, -30, @today), v.a, v.p, (SELECT id FROM @L WHERE c = N'payment-mode' AND nm = N'UPI'), @fPdf, v.e, @uEntry
FROM dbo.LegalLandTransaction t JOIN @lands x ON x.LandId = t.LandId CROSS JOIN (VALUES (N'Advocate Fee', 25000, N'Adv. Sumana Roy'), (N'Survey Fee', 8000, N'Bose Survey Works')) v(e, a, p);
INSERT INTO dbo.LegalValuation (LandId, ValuationDate, LandArea, AreaUnitId, MarketRate, EstimatedMarketValue, GovernmentValuation, ValuationSource, ValuationFileId, Surveyor, SurveyDate, SurveyFileId,
    GpsLatitude, GpsLongitude, BoundaryFindings, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT l.LandId, DATEADD(day, -15, @today), l.Area, l.AreaUnitId, 650000, l.Area * 650000, l.Area * 620000, N'WB Registration market value search', @fPdf, N'Bose Survey Works', DATEADD(day, -16, @today), @fPdf,
  l.GpsLatitude, l.GpsLongitude, N'Boundaries match the RS map', N'Verified', @uVer, SYSUTCDATETIME(), N'Valuation for stamp duty', @uEntry FROM dbo.LegalLand l JOIN @lands x ON x.LandId = l.LandId;
INSERT INTO dbo.LegalLandTax (LandId, TaxYear, PaymentDate, Amount, ReceiptNo, PaymentRef, RelatedOwner, ReceiptFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT x.LandId, v.y, v.d, v.a, CONCAT(N'KH/', x.LandId, N'/', v.y), N'BLRO counter', N'Bimal Sarkar', @fPdf, N'Verified', @uVer, SYSUTCDATETIME(), N'Khajna paid', @uEntry
FROM @lands x CROSS JOIN (VALUES (N'2024-25', '2024-06-10', 420), (N'2025-26', '2025-06-12', 440)) v(y, d, a);
INSERT INTO dbo.LegalLandPhoto (LandId, Caption, PhotoFileId, TakenOn, Remarks, CreatedBy)
SELECT LandId, N'Site view from the road', @fPhoto, DATEADD(day, -10, @today), N'Taken during the site visit', @uEntry FROM @lands;
INSERT INTO dbo.LegalLandDocument (DocumentCode, LandId, DocTypeId, RelatedSection, Title, DocumentNo, DocumentDate, IssuingAuthority, CurrentVersionNo, Remarks, CreatedBy, RegistrationDate, RelatedOwner, Description)
SELECT CONCAT(N'TR-DOC-', x.LandId, N'-', v.n), x.LandId, (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeName = v.t), v.s, v.ti, v.no, v.d, v.a, 1, N'Demo document', @uEntry, v.d, N'Bimal Sarkar', v.ti
FROM @lands x CROSS JOIN (VALUES (1, N'Sale Deed', N'Purchase / Sale', N'Parent sale deed', N'I-0418/2004', '2004-05-10', N'ADSR Rajarhat'),
                                 (2, N'LR Khatian', N'Ownership', N'LR Khatian (RoR)', N'2215', '2023-01-05', N'BL&LRO Rajarhat'),
                                 (3, N'Khajna / Land Revenue Receipt', N'Tax', N'Khajna receipt 2025-26', N'KH-2025-26', '2025-06-12', N'BL&LRO Rajarhat')) v(n, t, s, ti, no, d, a);
INSERT INTO dbo.LegalLandDocumentVersion (DocumentId, VersionNo, FileId, UploadRemarks, UploadedBy, ReviewStatus, ReviewedBy, ReviewedAt, ReviewRemarks)
SELECT d.DocumentId, 1, @fPdf, N'Scanned copy', @uEntry, N'Verified', @uVer, SYSUTCDATETIME(), N'Matches original' FROM dbo.LegalLandDocument d JOIN @lands x ON x.LandId = d.LandId;
INSERT INTO dbo.LegalLandDocumentSection (DocumentId, Section) SELECT d.DocumentId, d.RelatedSection FROM dbo.LegalLandDocument d JOIN @lands x ON x.LandId = d.LandId;
INSERT INTO dbo.LegalLandClearance (LandId, Kind, Status, AppliedOn, ApplicationNo, ObtainedOn, CertificateNo, Remarks, FileId, UpdatedBy, UpdatedAt, ExpiryDate)
SELECT x.LandId, v.k, CASE WHEN x.k = 9 THEN N'Approved' WHEN x.k = 6 THEN N'Not Applied' ELSE N'Under Review' END, CASE WHEN x.k = 6 THEN NULL ELSE DATEADD(day, -40, @today) END,
  CONCAT(v.k, N'/RJH/', x.LandId), CASE WHEN x.k = 9 THEN DATEADD(day, -25, @today) END, CASE WHEN x.k = 9 THEN CONCAT(v.k, N'-CERT-', x.LandId) END, CONCAT(v.k, N' clearance'), @fPdf, @uEntry, SYSUTCDATETIME(),
  CASE WHEN x.k = 9 THEN DATEADD(year, 1, @today) END FROM @lands x CROSS JOIN (VALUES (N'LA'), (N'ULC')) v(k);
INSERT INTO dbo.LegalLandClearanceEvent (LandId, Kind, Status, EventDate, RefNo, Remarks, FileId, CreatedBy)
SELECT c.LandId, c.Kind, v.s, v.d, c.ApplicationNo, v.r, @fPdf, @uEntry FROM dbo.LegalLandClearance c JOIN @lands x ON x.LandId = c.LandId AND x.k <> 6
CROSS JOIN (VALUES (N'Application Submitted', DATEADD(day, -40, @today), N'Applied with deed copies'), (N'Query Raised', DATEADD(day, -32, @today), N'Authority asked for RoR'),
                   (N'Query Replied', DATEADD(day, -30, @today), N'RoR submitted')) v(s, d, r);
INSERT INTO dbo.LegalLandClearanceEvent (LandId, Kind, Status, EventDate, RefNo, Remarks, FileId, CreatedBy)
SELECT c.LandId, c.Kind, N'Approved', DATEADD(day, -25, @today), c.CertificateNo, N'Certificate issued', @fPdf, @uEntry FROM dbo.LegalLandClearance c JOIN @lands x ON x.LandId = c.LandId AND x.k = 9;

-- ── Stages: review, approval, deed process, registration, post-registration ─────────────────────
-- Land 1: entered and sent for verification (verifier working on it).
INSERT INTO dbo.LegalLandReview (LandId, VersionNo, Status, ChecksJson, EntrySubmittedBy, EntrySubmittedAt, Remarks)
VALUES (@l1, 1, N'Verifying', N'{"fields":{}}', @uEntry, DATEADD(day, -2, SYSUTCDATETIME()), N'All sections entered — please verify');
-- Lands 2–4: verified and approved earlier.
INSERT INTO dbo.LegalLandReview (LandId, VersionNo, Status, ChecksJson, SubmittedBy, SubmittedAt, DecidedBy, DecidedAt, Remarks, EntrySubmittedBy, EntrySubmittedAt)
SELECT LandId, 1, N'Approved', N'{"fields":{}}', @uVer, DATEADD(day, -15, SYSUTCDATETIME()), @uApp, DATEADD(day, -14, SYSUTCDATETIME()), N'Verified and approved', @uEntry, DATEADD(day, -16, SYSUTCDATETIME())
FROM @lands WHERE k <> 6;
INSERT INTO dbo.LegalLandDecision (LandId, Stage, Action, VersionNo, Reason, DecidedBy, DecidedAt)
SELECT LandId, v.s, v.a, 1, v.r, v.u, DATEADD(day, v.d, SYSUTCDATETIME()) FROM @lands x
CROSS JOIN (VALUES (N'Verification', N'Verified', N'Every field checked', @uVer, -15), (N'Land approval', N'Approve', N'Final legal review approved', @uApp, -14)) v(s, a, r, u, d) WHERE x.k <> 6;
UPDATE dbo.LegalLand SET FinalVerifiedBy = @uVer, FinalVerifiedAt = DATEADD(day, -15, SYSUTCDATETIME()), DeedFileId = @fPdf WHERE LandId IN (@l2, @l3, @l4);
-- FinalRemarks exists only on the dev server (no migration adds it). Naming it directly makes the whole batch fail to
-- compile elsewhere, before the dev-only guard above can return, so it is set through dynamic SQL when it exists.
IF COL_LENGTH('dbo.LegalLand', 'FinalRemarks') IS NOT NULL
  EXEC sp_executesql N'UPDATE dbo.LegalLand SET FinalRemarks = N''All sections verified'' WHERE LandId IN (@a, @b, @c);', N'@a INT, @b INT, @c INT', @l2, @l3, @l4;
INSERT INTO dbo.LegalFinalCheck (LandId, CheckItem, Result, CheckedBy, CheckedAt, Remarks, CreatedBy)
SELECT x.LandId, v.c, CASE WHEN x.k = 9 THEN N'Confirmed' ELSE N'Pending' END, @uVer, SYSUTCDATETIME(), N'Final check', @uEntry FROM @lands x
CROSS JOIN (VALUES (N'Registered deed uploaded and approved'), (N'Ownership transfer recorded'), (N'Mutation application status recorded'), (N'Final checklist completed')) v(c) WHERE x.k <> 6;
-- Deed (deed-process data for lands 2–4)
INSERT INTO dbo.LegalLandDeed (DeedCode, LandId, TransactionId, DeedTypeId, LandDescription, ConsiderationAmount, DeedWriter, DeedWriterDueDate, AdvocateId, RegistrationOfficeId, RegisteredDeedNo,
    RegistrationStatus, Remarks, CreatedBy)
SELECT CONCAT(N'TR-DEED-', x.k), x.LandId, t.TransactionId, (SELECT DeedTypeId FROM dbo.LegalDeedType WHERE DeedTypeCode = N'SALE'), CONCAT(l.Area, N' katha at RS Dag ', l.RsDagNo, N', Mouza ', m.MouzaName),
  t.TotalValue, N'Sanjib Paul (licensed deed writer)', DATEADD(day, 5, @today), @adv1, @oADSR, CASE WHEN x.k = 9 THEN N'I-1504-08812/2026' END,
  CASE x.k WHEN 7 THEN N'Draft Under Review' WHEN 8 THEN N'Appointment Scheduled' ELSE N'Completed' END, N'Demo deed', @uEntry
FROM @lands x JOIN dbo.LegalLand l ON l.LandId = x.LandId JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId JOIN dbo.LegalLandTransaction t ON t.LandId = x.LandId WHERE x.k <> 6;
INSERT INTO dbo.LegalDeedDraft (LandId, DeedId, VersionNo, DraftDate, DraftFileId, ChangeNotes, ReviewStatus, ReviewedBy, ReviewedAt, ReviewRemarks, CreatedBy)
SELECT d.LandId, d.DeedId, v.n, DATEADD(day, v.d, @today), @fPdf, v.c, v.s, @uRev, SYSUTCDATETIME(), v.r, @uEntry FROM dbo.LegalLandDeed d JOIN @lands x ON x.LandId = d.LandId
CROSS JOIN (VALUES (1, -12, N'First draft', N'Correction Required', N'Boundary names to fix'), (2, -8, N'Boundaries corrected', N'Approved', N'Approved')) v(n, d, c, s, r);
INSERT INTO dbo.LegalDeedDraftCheck (LandId, DraftId, CheckItem, Result, CheckedBy, CheckedAt, Remarks, CreatedBy)
SELECT dr.LandId, dr.DraftId, v.c, N'Correct', @uRev, SYSUTCDATETIME(), N'Checked', @uEntry FROM dbo.LegalDeedDraft dr JOIN @lands x ON x.LandId = dr.LandId
CROSS JOIN (VALUES (N'Seller details correct'), (N'Land area correct'), (N'RS Khatian and Dag correct'), (N'Consideration amount correct')) v(c) WHERE dr.VersionNo = 2;
INSERT INTO dbo.LegalStampDuty (LandId, DeedId, GovtMarketValue, ConsiderationValue, ValuationBasis, StampDuty, RegistrationFee, ScanningFee, OtherCharges, TotalPayable, CalculationDate, CalculationSource,
    SupportingFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT d.LandId, d.DeedId, d.ConsiderationAmount * 1.05, d.ConsiderationAmount, N'Market value (higher than consideration)', d.ConsiderationAmount * 1.05 * 0.06, d.ConsiderationAmount * 1.05 * 0.011, 500, 200,
  d.ConsiderationAmount * 1.05 * 0.071 + 700, DATEADD(day, -6, @today), N'WB Registration duty calculator', @fPdf, N'Verified', @uVer, SYSUTCDATETIME(), N'6% stamp duty + 1.1% fee', @uEntry
FROM dbo.LegalLandDeed d JOIN @lands x ON x.LandId = d.LandId WHERE x.k IN (8, 9);
INSERT INTO dbo.LegalRegPayment (LandId, DeedId, FeeTypeId, Amount, PaymentDate, PaymentRef, ReceiptFileId, VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT s.LandId, s.DeedId, (SELECT id FROM @L WHERE c = N'fee-type' AND nm = v.f), CASE v.f WHEN N'Stamp Duty' THEN s.StampDuty ELSE s.RegistrationFee END, DATEADD(day, -5, @today), CONCAT(N'GRIPS-', s.DeedId, N'-', v.f),
  @fPdf, N'Verified', @uVer, SYSUTCDATETIME(), N'Paid on GRIPS', @uEntry FROM dbo.LegalStampDuty s CROSS JOIN (VALUES (N'Stamp Duty'), (N'Registration Fee')) v(f);
INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy)
SELECT s.LandId, DATEADD(day, -6, @today), (SELECT id FROM @L WHERE c = N'fee-type' AND nm = N'Stamp Duty'), s.StampDuty, N'Duty as per market value', @uEntry FROM dbo.LegalStampDuty s;
INSERT INTO dbo.LegalRegAppointment (LandId, DeedId, RegistrationOfficeId, AppointmentDate, AppointmentTime, TokenNo, BuyerAttendance, SellerAttendance, WitnessDetails, AppointmentStatus, SlipFileId, Remarks, CreatedBy)
SELECT d.LandId, d.DeedId, @oADSR, CASE WHEN x.k = 9 THEN DATEADD(day, -20, @today) ELSE DATEADD(day, 6, @today) END, N'11:30', CONCAT(N'TKN-', d.DeedId),
  CASE WHEN x.k = 9 THEN N'Present' ELSE N'Pending' END, CASE WHEN x.k = 9 THEN N'Present' ELSE N'Pending' END, N'Tapas Mondal (witness)', CASE WHEN x.k = 9 THEN N'Completed' ELSE N'Scheduled' END,
  @fPdf, N'e-appointment', @uEntry FROM dbo.LegalLandDeed d JOIN @lands x ON x.LandId = d.LandId WHERE x.k IN (8, 9);
INSERT INTO dbo.LegalRegAttempt (LandId, DeedId, AppointmentId, AttemptDate, Result, RegisteredDeedNo, FailureReason, Remarks, CreatedBy)
SELECT a.LandId, a.DeedId, a.AppointmentId, a.AppointmentDate, N'Successful', N'I-1504-08812/2026', NULL, N'Registered on first attempt', @uEntry FROM dbo.LegalRegAppointment a JOIN @lands x ON x.LandId = a.LandId WHERE x.k = 9;
INSERT INTO dbo.LegalRegisteredDeed (LandId, DeedId, RegisteredDeedNo, RegistrationDate, RegistrationOfficeId, DeedFileId, ReceiptFileId, CertifiedCopyStatus, ApprovalStatus, ApprovedBy, ApprovedAt, ApprovalRemarks, CreatedBy)
SELECT d.LandId, d.DeedId, N'I-1504-08812/2026', DATEADD(day, -20, @today), @oADSR, @fDeed, @fPdf, N'Applied', N'Approved', @uApp, SYSUTCDATETIME(), N'Registered deed checked', @uEntry
FROM dbo.LegalLandDeed d WHERE d.LandId = @l4;
-- Deed Process land: L1 approved, waiting for final approval; drafting stage and drafter.
UPDATE dbo.LegalLand SET DeedTargetDate = DATEADD(day, 5, @today), DeedStage = N'Under Review', DeedDrafterId = @uEntry, L1Status = N'Approved', L1ReviewerId = @uApp,
  L1ReviewedAt = DATEADD(day, -1, SYSUTCDATETIME()), L1Remarks = N'Documents in order' WHERE LandId = @l2;
-- Deed Registration land: approved; consideration and duty; applied.
UPDATE dbo.LegalLand SET DeedTargetDate = DATEADD(day, -4, @today), DeedStage = N'Ready for Approval', DeedDrafterId = @uEntry, DeedCompletedAt = DATEADD(day, -6, SYSUTCDATETIME()),
  DeedApprovalRequestedAt = DATEADD(day, -7, SYSUTCDATETIME()), DeedApprovalRequestedBy = @uEntry, DeedApprovalStatus = N'Approved', DeedApprovalNote = N'Final deed approved',
  L1Status = N'Approved', L1ReviewerId = @uApp, L1ReviewedAt = DATEADD(day, -7, SYSUTCDATETIME()), L1Remarks = N'OK', L2Status = N'Approved', L2ApproverId = @uL2, L2ApprovedAt = DATEADD(day, -6, SYSUTCDATETIME()), L2Remarks = N'OK',
  ConsTotalAmount = Area * 600000, ConsRate = 600000, ConsRateUnitId = @KATHA, ConsAdvanceAmount = 500000, ConsPaymentModeId = (SELECT id FROM @L WHERE c = N'payment-mode' AND nm = N'RTGS'),
  ConsRemarks = N'₹6 lakh per katha; balance at registration', ConsDate = DATEADD(day, -50, @today), RegAppliedBy = @uApp, RegAppliedAt = DATEADD(day, -3, SYSUTCDATETIME()) WHERE LandId = @l3;
-- Registered land: every step done; deed tracked to the locker.
UPDATE dbo.LegalLand SET DeedTargetDate = DATEADD(day, -30, @today), DeedStage = N'Ready for Approval', DeedDrafterId = @uEntry, DeedCompletedAt = DATEADD(day, -32, SYSUTCDATETIME()),
  DeedApprovalRequestedAt = DATEADD(day, -33, SYSUTCDATETIME()), DeedApprovalRequestedBy = @uEntry, DeedApprovalStatus = N'Approved', DeedApprovalNote = N'Final deed approved',
  L1Status = N'Approved', L1ReviewerId = @uApp, L1ReviewedAt = DATEADD(day, -35, SYSUTCDATETIME()), L1Remarks = N'OK', L2Status = N'Approved', L2ApproverId = @uL2, L2ApprovedAt = DATEADD(day, -34, SYSUTCDATETIME()), L2Remarks = N'OK',
  ConsTotalAmount = Area * 600000, ConsRate = 600000, ConsRateUnitId = @KATHA, ConsAdvanceAmount = 1000000, ConsPaymentModeId = (SELECT id FROM @L WHERE c = N'payment-mode' AND nm = N'Cheque'),
  ConsRemarks = N'Balance paid before registration', ConsDate = DATEADD(day, -60, @today), RegAppliedBy = @uApp, RegAppliedAt = DATEADD(day, -30, SYSUTCDATETIME()),
  RegFinalDate = DATEADD(day, -20, @today), RegOfficeId = @oADSR, RegModeId = (SELECT id FROM @L WHERE c = N'registration-mode' AND nm = N'Physical (at office)'), RegDeedNo = N'I-1504-08812/2026',
  RegDeedFileId = @fDeed, RegCompletedBy = @uL2, RegCompletedAt = DATEADD(day, -19, SYSUTCDATETIME()), IgrTrackingUrl = N'https://wbregistration.gov.in/',
  IgrStatusId = (SELECT id FROM @L WHERE c = N'igr-status' AND nm = N'Delivered'), DeedLocationId = (SELECT id FROM @L WHERE c = N'deed-location' AND nm = N'In company locker / vault') WHERE LandId = @l4;
INSERT INTO dbo.LegalConsiderationRevision (LandId, RevisionDate, OldTotal, NewTotal, OldRate, NewRate, ValuationId, Reason, CreatedBy)
SELECT l.LandId, l.ConsDate, NULL, l.ConsTotalAmount, NULL, l.ConsRate, v.ValuationId, N'Consideration agreed', @uEntry FROM dbo.LegalLand l JOIN dbo.LegalValuation v ON v.LandId = l.LandId WHERE l.LandId IN (@l3, @l4);
INSERT INTO dbo.LegalDeedTracking (LandId, StatusDate, IgrStatusId, DeedLocationId, TrackingUrl, Remarks, CreatedBy)
SELECT @l4, DATEADD(day, v.d, @today), (SELECT id FROM @L WHERE c = N'igr-status' AND nm = v.s), (SELECT id FROM @L WHERE c = N'deed-location' AND nm = v.loc), N'https://wbregistration.gov.in/', v.r, @uEntry
FROM (VALUES (-20, N'Registered — deed pending', N'In registration office', N'Registered; original with the office'), (-12, N'Ready for delivery', N'In registration office', N'Ready for collection'),
             (-10, N'Delivered', N'With advocate', N'Collected by the advocate'), (-8, N'Delivered', N'In company locker / vault', N'Kept in the head-office locker')) v(d, s, loc, r);
INSERT INTO dbo.LegalSettlement (LandId, TransactionId, AgreementValue, TotalReceived, TotalPaid, RemainingBalance, BrokerCommission, AdvocateFees, RegistrationCharges, OtherExpenses, Refunds, SettlementDate,
    SettlementStatus, ApprovedBy, ApprovedAt, Remarks, CreatedBy)
SELECT t.LandId, t.TransactionId, t.TotalValue, 0, t.TotalValue, 0, 50000, 25000, 280000, 15000, 0, DATEADD(day, -15, @today), N'Approved', @uApp, SYSUTCDATETIME(), N'All paid', @uEntry
FROM dbo.LegalLandTransaction t WHERE t.LandId = @l4;
-- Post-registration: tasks, mutation (approved, with hearing and new record), conversion (pending), queries
INSERT INTO dbo.LegalPostRegTask (LandId, TaskNo, Task, Status, RefNo, DueDate, Remarks, FileId, UpdatedBy, UpdatedAt, AssignedUserId, CompletedBy, CompletedAt)
SELECT @l4, v.n, v.t, v.s, v.ref, DATEADD(day, v.due, @today), v.r, @fPdf, @uEntry, SYSUTCDATETIME(), @uEntry, CASE WHEN v.s = N'Completed' THEN @uEntry END, CASE WHEN v.s = N'Completed' THEN SYSUTCDATETIME() END
FROM (VALUES (1, N'Registered deed verification', N'Completed', N'I-1504-08812/2026', -15, N'Checked'), (2, N'Mutation application', N'Completed', N'MUT/RJH/2026/311', -10, N'Mutation approved'),
             (3, N'Updated Khatian / RoR', N'Under Processing', N'RoR/2026/77', 10, N'Waiting for the new RoR'), (4, N'Updated land records', N'Not Started', NULL, 20, NULL),
             (5, N'Land tax / revenue update', N'Under Processing', N'KH/2026-27', -2, N'Overdue — follow up at BLRO'), (6, N'Ownership record update', N'Not Started', NULL, 30, NULL),
             (7, N'Project mapping eligibility', N'Completed', N'TR-MAP', -5, N'Mapped to Test Residence')) v(n, t, s, ref, due, r);
INSERT INTO dbo.LegalMutation (LandId, RegisteredDeedId, ApplicationNo, ApplicationDate, OfficeName, MouzaId, DagNo, PreviousKhatian, PreviousOwner, NewOwner, ApplicationStatus, DecidedBy, DecidedAt,
    HearingDate, OrderNo, OrderDate, DocFileId, OrderFileId, Remarks, CreatedBy, CaseNo, Kind, ApplicantName, AssignedUserId, DueDate, Fee, PaymentRef, PaymentDate, CompletionDate, ReportFileId)
SELECT @l4, rd.RegisteredId, N'MUT/RJH/2026/311', DATEADD(day, -18, @today), N'BL&LRO Rajarhat', l.MouzaId, l.LrDagNo, l.LrKhatianNo, N'Bimal Sarkar & Kamal Sarkar', N'Rajwada Developers Pvt Ltd',
  N'Approved', @uApp, DATEADD(day, -10, SYSUTCDATETIME()), DATEADD(day, -12, @today), N'MO/RJH/2026/88', DATEADD(day, -10, @today), @fPdf, @fPdf, N'Mutation approved', @uEntry, N'MC-311/2026',
  N'Mutation', N'Rajwada Developers Pvt Ltd', @uEntry, DATEADD(day, -8, @today), 1200, N'GRIPS-MUT-311', DATEADD(day, -18, @today), DATEADD(day, -10, @today), @fPdf
FROM dbo.LegalLand l JOIN dbo.LegalRegisteredDeed rd ON rd.LandId = l.LandId WHERE l.LandId = @l4;
INSERT INTO dbo.LegalMutation (LandId, ApplicationNo, ApplicationDate, OfficeName, MouzaId, DagNo, PreviousKhatian, ApplicationStatus, HearingDate, DocFileId, Remarks, CreatedBy, Kind, ApplicantName,
    AssignedUserId, DueDate, Fee, PaymentRef, PaymentDate, CurrentClass, RequestedClass, InspectionDate, ReportFileId)
SELECT @l4, N'CNV/RJH/2026/42', DATEADD(day, -6, @today), N'BL&LRO Rajarhat (conversion cell)', l.MouzaId, l.LrDagNo, l.LrKhatianNo, N'Hearing Scheduled', DATEADD(day, 9, @today), @fPdf,
  N'Sali to Bastu for the housing project', @uEntry, N'Conversion', N'Rajwada Developers Pvt Ltd', @uEntry, DATEADD(day, 60, @today), 15000, N'GRIPS-CNV-42', DATEADD(day, -6, @today),
  N'Sali', N'Bastu', DATEADD(day, 3, @today), @fPdf FROM dbo.LegalLand l WHERE l.LandId = @l4;
DECLARE @mut INT = (SELECT MutationId FROM dbo.LegalMutation WHERE ApplicationNo = N'MUT/RJH/2026/311'), @cnv INT = (SELECT MutationId FROM dbo.LegalMutation WHERE ApplicationNo = N'CNV/RJH/2026/42');
INSERT INTO dbo.LegalMutationHearing (LandId, MutationId, HearingDate, ObjectionRaised, Outcome, NextDate, DocFileId, Remarks, CreatedBy)
VALUES (@l4, @mut, DATEADD(day, -12, @today), N'No', N'No objection; order reserved', NULL, @fPdf, N'Hearing held', @uEntry);
INSERT INTO dbo.LegalMutationRecord (LandId, MutationId, NewLrKhatianNo, NewLrDagNo, RecordedHolder, NewSharePct, LandTypeId, UpdatedArea, AreaUnitId, RorDate, MutationOrderNo, MutationOrderDate, RorFileId,
    VerificationStatus, VerifiedBy, VerifiedAt, Remarks, CreatedBy)
SELECT @l4, @mut, N'3301', l.LrDagNo, N'Rajwada Developers Pvt Ltd', 100, l.LandTypeId, l.Area, l.AreaUnitId, DATEADD(day, -9, @today), N'MO/RJH/2026/88', DATEADD(day, -10, @today), @fPdf, N'Verified', @uVer,
  SYSUTCDATETIME(), N'New RoR in company name', @uEntry FROM dbo.LegalLand l WHERE l.LandId = @l4;
INSERT INTO dbo.LegalApplicationQuery (LandId, MutationId, QueryDate, QueryText, ResponseDate, ResponseText, FileId, CreatedBy) VALUES
  (@l4, @mut, DATEADD(day, -15, @today), N'Submit the registered deed copy', DATEADD(day, -14, @today), N'Certified copy submitted', @fPdf, @uEntry),
  (@l4, @cnv, DATEADD(day, -3, @today), N'Site plan with road access needed', NULL, NULL, @fMap, @uEntry);
-- One amendment waiting for the Amendment Approver on the registered land
INSERT INTO dbo.LegalLandAmendment (LandId, AmendmentNo, AmendType, Reason, ChangesJson, ReferenceNo, Status, RequestedBy, RequestedAt, VersionNo)
VALUES (@l4, 1, N'Khatian correction', N'New LR Khatian after mutation', N'[{"field":"LrKhatianNo","label":"LR Khatian number","from":"2215","to":"3301"}]', N'MO/RJH/2026/88', N'Pending', @uEntry, DATEADD(day, -1, SYSUTCDATETIME()), 2);

-- ── Legal verification workspaces (V2.1) ────────────────────────────────────────────────────────
-- 2: in progress (every activity has work; entries for every activity type); 1: just started; 3: final review pending;
-- 7, 8, 9: legally approved (their lands passed Land Approval).
DECLARE @VW TABLE (k INT, no NVARCHAR(30), st NVARCHAR(30), ago INT);
INSERT INTO @VW VALUES (1, N'LV-TR-00001', N'In Progress', 1), (2, N'LV-TR-00002', N'In Progress', 18), (3, N'LV-TR-00003', N'Ready for Review', 30),
  (7, N'LV-TR-00007', N'Verified', 80), (8, N'LV-TR-00008', N'Verified', 110), (9, N'LV-TR-00009', N'Verified', 150);
INSERT INTO dbo.LegalVerification (VerificationNo, EnquiryId, ProjectId, Status, StartDate, TargetDate, LeadUserId, Remarks, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
SELECT w.no, q.EnquiryId, @P, w.st, DATEADD(day, -w.ago, @today), DATEADD(day, 60 - w.ago, @today), @uVer, N'Demo verification', @uEntry, DATEADD(day, -w.ago, SYSUTCDATETIME()), @uEntry, SYSUTCDATETIME()
FROM @VW w JOIN @E e ON e.k = w.k JOIN dbo.LegalLandEnquiry q ON q.EnquiryNo = e.no;
INSERT INTO dbo.LegalVerificationActivity (VerificationId, TemplateId, ActivityNo, ActivityName, IsMandatory, Status, VerifyStatus, Department, Priority, ExpectedDays, StartDate, DueDate, CreatedBy, CreatedAt,
    AssignedUserId, VerifierUserId, UpdatedBy, UpdatedAt)
SELECT v.VerificationId, t.TemplateId, t.ActivityNo, t.ActivityName, t.IsMandatory, N'Not Started', N'Not Reviewed', t.Department, N'Normal', t.DefaultDays, NULL,
  CASE WHEN t.DefaultDays IS NULL THEN NULL ELSE DATEADD(day, t.DefaultDays, v.StartDate) END, @uEntry, SYSUTCDATETIME(),
  CASE WHEN t.Department = N'Search' THEN @uSearch ELSE @uEntry END, @uVer, @uEntry, SYSUTCDATETIME()
FROM dbo.LegalVerification v JOIN @VW w ON w.no = v.VerificationNo JOIN dbo.LegalActivityTemplate t ON t.IsActive = 1 AND t.Stage = N'Verification';
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, NewStatus, ChangedBy, ChangedAt)
SELECT a.ActivityId, N'Created', N'Not Started', @uEntry, v.CreatedAt FROM dbo.LegalVerificationActivity a JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId JOIN @VW w ON w.no = v.VerificationNo;
-- Approved / final-review workspaces: every activity verified (optional ones N/A).
UPDATE a SET Status = N'Closed', VerifyStatus = CASE WHEN a.IsMandatory = 1 THEN N'Verified' ELSE N'N/A' END,
  Finding = CASE t.ActivityCode WHEN N'ONLINE-SEARCH' THEN N'Found' WHEN N'OFFLINE-SEARCH' THEN N'Not Found in Sources Searched' WHEN N'COURT-SEARCH' THEN N'Not Found in Sources Searched'
    WHEN N'OWNER-MATCH' THEN N'Matched' WHEN N'BANGLA-BHUMI' THEN N'Matched' ELSE N'Found' END,
  StartDate = v.StartDate, CompletedDate = DATEADD(day, 20, v.StartDate), SubmittedBy = a.AssignedUserId, SubmittedAt = DATEADD(day, 19, CAST(v.StartDate AS DATETIME2)),
  ReviewedBy = @uVer, ReviewedAt = DATEADD(day, 20, CAST(v.StartDate AS DATETIME2)), VerifyRemarks = N'Checked with evidence',
  Findings = N'Work done and evidence attached', NaReason = CASE WHEN a.IsMandatory = 0 THEN N'RS record available — Panchayat application not needed' END,
  NaRequestedBy = CASE WHEN a.IsMandatory = 0 THEN @uEntry END, NaRequestedAt = CASE WHEN a.IsMandatory = 0 THEN DATEADD(day, 2, CAST(v.StartDate AS DATETIME2)) END,
  NaApprovedBy = CASE WHEN a.IsMandatory = 0 THEN @uVer END, NaApprovedAt = CASE WHEN a.IsMandatory = 0 THEN DATEADD(day, 3, CAST(v.StartDate AS DATETIME2)) END
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
WHERE v.VerificationNo IN (N'LV-TR-00003', N'LV-TR-00007', N'LV-TR-00008', N'LV-TR-00009');
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, OldStatus, NewStatus, Remarks, ChangedBy, ChangedAt)
SELECT a.ActivityId, x.act, x.os, x.ns, x.r, x.u, a.ReviewedAt FROM dbo.LegalVerificationActivity a JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
CROSS APPLY (VALUES (N'Submitted', N'In Progress', N'Submitted for Review', N'Work and evidence ready', a.AssignedUserId),
                    (CASE WHEN a.VerifyStatus = N'N/A' THEN N'N/A approved' ELSE N'Verification: Verified' END, N'Submitted for Review', N'Closed', ISNULL(a.NaReason, N'Checked with evidence'), @uVer)) x(act, os, ns, r, u)
WHERE v.VerificationNo IN (N'LV-TR-00003', N'LV-TR-00007', N'LV-TR-00008', N'LV-TR-00009');
INSERT INTO dbo.LegalVerificationException (Kind, VerificationId, ActivityId, Reason, Remarks, ApprovedBy, CreatedBy, CreatedAt)
SELECT N'N/A approval', a.VerificationId, a.ActivityId, a.NaReason, N'Approved by the verifier', @uVer, @uVer, a.NaApprovedAt FROM dbo.LegalVerificationActivity a JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
WHERE a.VerifyStatus = N'N/A' AND v.VerificationNo LIKE N'LV-TR-%';

-- Workspace 2 (in progress): a mix of every work and verification status.
DECLARE @w2 INT = (SELECT VerificationId FROM dbo.LegalVerification WHERE VerificationNo = N'LV-TR-00002');
DECLARE @ACT TABLE (code NVARCHAR(30), st NVARCHAR(30), vs NVARCHAR(20), fnd NVARCHAR(40), pr NVARCHAR(10), rem NVARCHAR(500), hold NVARCHAR(300), nxt NVARCHAR(300));
INSERT INTO @ACT VALUES
  (N'ONLINE-SEARCH', N'Closed', N'Verified', N'Found', N'High', N'Two deeds found (2004, 2011)', NULL, NULL),
  (N'RS-PANCHA', N'In Progress', N'Not Reviewed', NULL, N'Low', N'N/A requested — RS record is available', NULL, NULL),
  (N'BANGLA-BHUMI', N'Closed', N'Verified', N'Matched', N'Normal', N'RS 452 → LR 1433', NULL, NULL),
  (N'PLOT-INFO', N'Report Pending', N'Not Reviewed', NULL, N'Normal', N'Applied at BLRO; report awaited', NULL, NULL),
  (N'OWNER-MATCH', N'Submitted for Review', N'Under Review', N'Mismatched', N'High', N'One LR owner missing in RS — explained by inheritance', NULL, NULL),
  (N'DEED-CHAIN', N'Closed', N'Verified', N'Found', N'High', N'Mother deed 1962 and link deeds identified', NULL, NULL),
  (N'DEED-CHAIN-FINAL', N'Not Started', N'Not Reviewed', NULL, N'High', NULL, NULL, NULL),
  (N'MOUZA-MAP', N'On Hold', N'Not Reviewed', NULL, N'Normal', NULL, N'Updated Dag sketch not issued by BLRO yet', N'Follow up at BLRO on Monday'),
  (N'OWNERSHIP-FLOW', N'In Progress', N'Not Reviewed', N'Additional Documents Required', N'Normal', N'1985 partition deed missing', NULL, NULL),
  (N'OFFLINE-SEARCH', N'Submitted for Review', N'Under Review', N'Not Found in Sources Searched', N'Normal', N'ADSR volume register 1956–2008 checked', NULL, NULL),
  (N'COURT-SEARCH', N'In Progress', N'Returned', N'Case Found', N'Urgent', N'Returned: attach the dismissal order', NULL, NULL),
  (N'LA-ULC', N'Applied', N'Not Reviewed', NULL, N'Normal', N'LA and ULC applied; query on ULC', NULL, NULL),
  (N'KHAJNA', N'Closed', N'Verified', N'Found', N'Low', N'Paid up to 2025-26', NULL, NULL),
  (N'LEGAL-HEIR', N'In Progress', N'Not Reviewed', N'Found', N'Normal', N'Two heirs; succession certificate seen', NULL, NULL),
  (N'MOTHER-DEED-ORIGINAL', N'Not Started', N'Not Reviewed', NULL, N'Normal', NULL, NULL, NULL),
  (N'CERTIFIED-COPY', N'Applied', N'Not Reviewed', NULL, N'Normal', N'Certified copies applied at RA Kolkata', NULL, NULL),
  (N'LAND-SURVEY', N'In Progress', N'Not Reviewed', N'Discrepancy Found', N'Normal', N'Measured 0.12 katha less than required', NULL, NULL);
UPDATE a SET Status = x.st, VerifyStatus = x.vs, Finding = x.fnd, Priority = x.pr, Remarks = x.rem, HoldReason = x.hold, NextAction = x.nxt,
  StartDate = CASE WHEN x.st <> N'Not Started' THEN DATEADD(day, 1, v.StartDate) END, Findings = CASE WHEN x.st <> N'Not Started' THEN CONCAT(N'Work recorded: ', x.rem) END,
  SubmittedBy = CASE WHEN x.vs IN (N'Under Review', N'Verified', N'Returned') THEN a.AssignedUserId END,
  SubmittedAt = CASE WHEN x.vs IN (N'Under Review', N'Verified', N'Returned') THEN DATEADD(day, -3, SYSUTCDATETIME()) END,
  ReviewedBy = CASE WHEN x.vs IN (N'Verified', N'Returned') THEN @uVer END, ReviewedAt = CASE WHEN x.vs IN (N'Verified', N'Returned') THEN DATEADD(day, -2, SYSUTCDATETIME()) END,
  VerifyRemarks = CASE x.vs WHEN N'Verified' THEN N'Checked with evidence' WHEN N'Returned' THEN N'Attach the dismissal order of T.S. 102/2015' END,
  CompletedDate = CASE WHEN x.st = N'Closed' THEN DATEADD(day, -2, @today) END,
  NaReason = CASE WHEN x.code = N'RS-PANCHA' THEN N'RS record available from BLRO — Panchayat application not needed' END,
  NaRequestedBy = CASE WHEN x.code = N'RS-PANCHA' THEN @uEntry END, NaRequestedAt = CASE WHEN x.code = N'RS-PANCHA' THEN DATEADD(day, -1, SYSUTCDATETIME()) END,
  GovSubmissionDate = CASE WHEN x.code IN (N'PLOT-INFO', N'LA-ULC', N'CERTIFIED-COPY') THEN DATEADD(day, -12, @today) END,
  AckDate = CASE WHEN x.code IN (N'PLOT-INFO', N'LA-ULC', N'CERTIFIED-COPY') THEN DATEADD(day, -11, @today) END,
  QueryDate = CASE WHEN x.code = N'LA-ULC' THEN DATEADD(day, -6, @today) END, QueryResponseDate = CASE WHEN x.code = N'LA-ULC' THEN DATEADD(day, -4, @today) END,
  HearingDate = CASE WHEN x.code = N'LA-ULC' THEN DATEADD(day, 8, @today) END,
  DueDate = CASE WHEN x.code IN (N'PLOT-INFO', N'MOUZA-MAP', N'LEGAL-HEIR') THEN DATEADD(day, -3, @today) ELSE a.DueDate END
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId JOIN @ACT x ON x.code = t.ActivityCode JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
WHERE a.VerificationId = @w2;
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, OldStatus, NewStatus, NewFinding, Remarks, ChangedBy, ChangedAt)
SELECT a.ActivityId, CASE WHEN a.VerifyStatus = N'Returned' THEN N'Verification: Returned' WHEN a.VerifyStatus = N'Verified' THEN N'Verification: Verified' WHEN a.Status = N'Submitted for Review' THEN N'Submitted' ELSE N'Updated' END,
  N'Not Started', a.Status, a.Finding, ISNULL(a.VerifyRemarks, a.Remarks), CASE WHEN a.VerifyStatus IN (N'Verified', N'Returned') THEN @uVer ELSE a.AssignedUserId END, DATEADD(day, -2, SYSUTCDATETIME())
FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = @w2 AND a.Status <> N'Not Started';
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, ChangedBy, ChangedAt)
SELECT ActivityId, N'N/A requested', NaReason, NaRequestedBy, NaRequestedAt FROM dbo.LegalVerificationActivity WHERE VerificationId = @w2 AND NaRequestedAt IS NOT NULL;
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, OldAssignee, NewAssignee, Remarks, ChangedBy, ChangedAt)
SELECT a.ActivityId, N'Reassigned', @uSearch, @uEntry, N'Handover: ADSR checked up to 2008; continue with the RA Kolkata volumes', @uLegalAdmin, DATEADD(day, -5, SYSUTCDATETIME())
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE a.VerificationId = @w2 AND t.ActivityCode = N'OFFLINE-SEARCH';
INSERT INTO dbo.LegalActivityComment (ActivityId, Comment, CreatedBy, CreatedAt)
SELECT a.ActivityId, c.txt, c.u, DATEADD(hour, -c.h, SYSUTCDATETIME()) FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
JOIN (VALUES (N'COURT-SEARCH', N'Dismissal order is with Adv. Arijit Basu — collecting tomorrow.', @uEntry, 20), (N'COURT-SEARCH', N'Please attach the certified copy, not the photocopy.', @uVer, 10),
             (N'MOUZA-MAP', N'BLRO says the sketch will be ready next week.', @uEntry, 30)) c(code, txt, u, h) ON c.code = t.ActivityCode
WHERE a.VerificationId = @w2;
INSERT INTO dbo.LegalVerificationException (Kind, VerificationId, ActivityId, Reason, Remarks, Detail, ApprovedBy, CreatedBy, CreatedAt)
SELECT N'Dependency override', @w2, a.ActivityId, N'RS and LR records already seen in the enquiry papers', N'Bangla Bhumi entries completed the same day', N'Open prerequisites: 3. Bangla Bhumi search (Under Review)',
  @uVer, @uVer, DATEADD(day, -3, SYSUTCDATETIME()) FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE a.VerificationId = @w2 AND t.ActivityCode = N'OWNER-MATCH';

-- Entries for every activity of workspace 2 (fields as the screens define them)
DECLARE @EN TABLE (code NVARCHAR(30), j NVARCHAR(MAX));
INSERT INTO @EN VALUES
  (N'ONLINE-SEARCH', CONCAT(N'{"searchBy":"Owner / party name","ownerName":"Haripada Ghosh","fromYear":2009,"toYear":', @yr, N',"office":"ADSR Rajarhat","searchDate":"', CONVERT(char(10), DATEADD(day, -10, @today), 23), N'","result":"Found","deedNo":"I-0874","deedYear":2011,"mouza":"Rajarhat","dag":"452","khatian":"226","executant":"Haripada Ghosh","claimant":"Sukanta Ghosh","property":"4 katha at RS Dag 452","remarks":null,"verifierRemarks":"Index page matched","reportFileId":', @fPdf, N'}')),
  (N'ONLINE-SEARCH', CONCAT(N'{"searchBy":"Mouza / Dag / Khatian","ownerName":null,"fromYear":2009,"toYear":', @yr, N',"office":"DSR Barasat","searchDate":"', CONVERT(char(10), DATEADD(day, -9, @today), 23), N'","result":"Not Found in Sources Searched","deedNo":null,"deedYear":null,"mouza":"Rajarhat","dag":"452","khatian":"226","executant":null,"claimant":null,"property":null,"remarks":null,"verifierRemarks":null,"reportFileId":', @fPdf, N'}')),
  (N'RS-PANCHA', N'{"applicationNo":null,"office":"Rajarhat Gram Panchayat","applicationDate":null,"applicant":"Rajwada Developers Pvt Ltd","mouza":"Rajarhat","dagNo":"452","khatianNo":"226","submittedDocs":null,"expectedDate":null,"reportDate":null,"status":"Not Started","remarks":"Not needed — RS record available","reportFileId":null}'),
  (N'BANGLA-BHUMI', CONCAT(N'{"mouza":"Rajarhat","jlNo":"105","rsDag":"452","rsKhatian":"226","lrDag":"1433","lrKhatian":"2302","recordedOwner":"Sukanta Ghosh","area":4,"classification":"Bastu","searchDate":"', CONVERT(char(10), DATEADD(day, -12, @today), 23), N'","result":"Matched","remarks":null,"recordFileId":', @fPdf, N'}')),
  (N'BANGLA-BHUMI', CONCAT(N'{"mouza":"Rajarhat","jlNo":"105","rsDag":"452","rsKhatian":"226","lrDag":"1434","lrKhatian":"2303","recordedOwner":"Rina Ghosh","area":0.5,"classification":"Bastu","searchDate":"', CONVERT(char(10), DATEADD(day, -12, @today), 23), N'","result":"Partly matched","remarks":"Part of RS 452 recorded under LR 1434 in the sister''s name","recordFileId":', @fPdf, N'}')),
  (N'PLOT-INFO', CONCAT(N'{"applicationNo":"PI/RJH/2026/119","office":"BL&LRO Rajarhat","applicationDate":"', CONVERT(char(10), DATEADD(day, -12, @today), 23), N'","applicant":"Rajwada Developers Pvt Ltd","mouza":"Rajarhat","dagNo":"1433","khatianNo":"2302","submittedDocs":"LR RoR, ID proof","expectedDate":"', CONVERT(char(10), DATEADD(day, 2, @today), 23), N'","reportDate":null,"status":"Applied","remarks":null,"reportFileId":null,"plotArea":null,"classification":null,"recordedOwner":null,"verifierRemarks":null}')),
  (N'OWNER-MATCH', N'{"rsOwner":"Haripada Ghosh","rsKhatian":"226","rsDag":"452","rsArea":4.5,"rsShare":"1.00","lrOwner":"Sukanta Ghosh","lrKhatian":"2302","lrDag":"1433","lrArea":4,"lrShare":"1.00","match":"Name Variation","deedNo":"I-0874/2009","deedDate":"2009-03-15","regOffice":"ADSR Rajarhat","inheritanceDoc":null,"partitionDoc":null,"remarks":"Son of the RS holder; gift deed 2009","fileId":null}'),
  (N'OWNER-MATCH', N'{"rsOwner":"Haripada Ghosh","rsKhatian":"226","rsDag":"452","rsArea":4.5,"rsShare":"1.00","lrOwner":"Rina Ghosh","lrKhatian":"2303","lrDag":"1434","lrArea":0.5,"lrShare":"1.00","match":"Additional Owner","deedNo":null,"deedDate":null,"regOffice":null,"inheritanceDoc":"Succession certificate 2008","partitionDoc":null,"remarks":"Daughter recorded for 0.5 katha by inheritance — her consent needed","fileId":null}'),
  (N'DEED-CHAIN', N'{"chainRole":"Mother Deed","deedNo":"I-0221/1962","deedDate":"1962-02-11","regYear":1962,"regOffice":"ADSR Rajarhat","deedType":"Sale deed","executant":"Haren Sarkar","claimant":"Haripada Ghosh","mouza":"Rajarhat","dag":"452","khatian":"226","area":4.5,"property":"4.5 katha with a tin shed","previousEntryId":null,"copyType":"Certified Copy","status":"Identified","remarks":null,"fileId":null}'),
  (N'DEED-CHAIN-FINAL', N'{"deedRef":"I-0221/1962","sourceReviewed":"Certified Copy","continuity":"Continuous","partiesMatch":"Yes","areaMatch":"Partly","discrepancies":"0.5 katha later recorded in the daughter''s name","remarks":null,"fileId":null}'),
  (N'MOUZA-MAP', CONCAT(N'{"sheetType":"Original Mouza Map","mapRef":"Sheet 3","mouza":"Rajarhat","jlNo":"105","dags":"452","roadAccess":"12 ft road on the south","landLocation":"South-west corner of the sheet","boundary":"Canal on the east","surveyRef":null,"remarks":null,"fileId":', @fMap, N'}')),
  (N'OWNERSHIP-FLOW', N'{"fromOwner":"Haren Sarkar","toOwner":"Haripada Ghosh","transferType":"Purchase/Sale","transferDate":"1962-02-11","transferYear":null,"shareBefore":"1.00","shareAfter":"0","shareReceived":"1.00","areaBefore":4.5,"area":4.5,"areaRetained":0,"dag":"452","khatian":"226","deedNo":"I-0221/1962","deedYear":1962,"regOffice":"ADSR Rajarhat","verification":"Verified","remarks":null,"preparedBy":"Search team","fileId":null}'),
  (N'OWNERSHIP-FLOW', N'{"fromOwner":"Haripada Ghosh","toOwner":"Sukanta Ghosh","transferType":"Gift","transferDate":"2009-03-15","transferYear":null,"shareBefore":"1.00","shareAfter":"0.11","shareReceived":"0.89","areaBefore":4.5,"area":4,"areaRetained":0.5,"dag":"452","khatian":"226","deedNo":"I-0874/2009","deedYear":2009,"regOffice":"ADSR Rajarhat","verification":"Unverified","remarks":null,"preparedBy":"Search team","fileId":null}'),
  (N'OWNERSHIP-FLOW', N'{"fromOwner":"Haripada Ghosh","toOwner":"Rina Ghosh","transferType":"Inheritance","transferDate":null,"transferYear":1985,"shareBefore":"0.11","shareAfter":"0","shareReceived":"0.11","areaBefore":0.5,"area":0.5,"areaRetained":0,"dag":"452","khatian":"226","deedNo":null,"deedYear":null,"regOffice":null,"verification":"Missing Document","remarks":"1985 partition deed not traced","preparedBy":"Search team","fileId":null}'),
  (N'OFFLINE-SEARCH', CONCAT(N'{"officeName":"ADSR Rajarhat","officeLocation":"Rajarhat Chowmatha","searchedBy":"Search team","fromYear":1956,"toYear":2008,"searchDate":"', CONVERT(char(10), DATEADD(day, -7, @today), 23), N'","ownerName":"Haripada Ghosh","propertyRef":"RS 452","deedRef":null,"documentsExamined":"Index II volumes 1956–2008","result":"Not Found in Sources Searched","findings":"No other transfer of RS 452","reportFileId":', @fPdf, N'}')),
  (N'COURT-SEARCH', CONCAT(N'{"court":"Civil Judge (Jr. Div.), Barasat","courtLocation":"Barasat","fromYear":', @yr - 30, N',"toYear":', @yr, N',"searchDate":"', CONVERT(char(10), DATEADD(day, -6, @today), 23), N'","searchBy":"Adv. Arijit Basu","ownerName":"Haripada Ghosh","result":"Case Found","caseNo":"T.S. 102/2015","caseYear":2015,"caseType":"Boundary","plaintiff":"Gopal Das","defendant":"Haripada Ghosh","propertyRef":"RS 452","dag":"452","caseStatus":"Dismissed","judgment":"Suit dismissed on 22-01-2018","remarks":null,"verifierRemarks":null,"reportFileId":', @fPdf, N',"orderFileId":null}')),
  (N'COURT-SEARCH', CONCAT(N'{"court":"District Judge, Barasat","courtLocation":"Barasat","fromYear":', @yr - 30, N',"toYear":', @yr, N',"searchDate":"', CONVERT(char(10), DATEADD(day, -6, @today), 23), N'","searchBy":"Adv. Arijit Basu","ownerName":"Haripada Ghosh","result":"No Record Found in Sources Searched","caseNo":null,"caseYear":null,"caseType":null,"plaintiff":null,"defendant":null,"propertyRef":"RS 452","dag":"452","caseStatus":null,"judgment":null,"remarks":null,"verifierRemarks":null,"reportFileId":', @fPdf, N',"orderFileId":null}')),
  (N'LA-ULC', CONCAT(N'{"clearanceType":"LA (Land Acquisition)","otherType":null,"applicationNo":"LA/N24P/2026/551","applicationDate":"', CONVERT(char(10), DATEADD(day, -12, @today), 23), N'","authority":"Land Acquisition Collector, North 24 Parganas","office":"Barasat","mouza":"Rajarhat","dag":"452","khatian":"226","area":4,"fee":500,"paymentRef":"GRIPS-LA-551","ackDate":"', CONVERT(char(10), DATEADD(day, -11, @today), 23), N'","hearingDate":null,"expectedDate":"', CONVERT(char(10), DATEADD(day, 40, @today), 23), N'","status":"Processing","queryDetails":null,"reportDate":null,"remarks":null,"applicationFileId":', @fPdf, N',"reportFileId":null}')),
  (N'LA-ULC', CONCAT(N'{"clearanceType":"ULC (Urban Land Ceiling)","otherType":null,"applicationNo":"ULC/N24P/2026/208","applicationDate":"', CONVERT(char(10), DATEADD(day, -12, @today), 23), N'","authority":"ULC Authority, Barasat","office":"Barasat","mouza":"Rajarhat","dag":"452","khatian":"226","area":4,"fee":500,"paymentRef":"GRIPS-ULC-208","ackDate":"', CONVERT(char(10), DATEADD(day, -11, @today), 23), N'","hearingDate":"', CONVERT(char(10), DATEADD(day, 8, @today), 23), N'","expectedDate":"', CONVERT(char(10), DATEADD(day, 45, @today), 23), N'","status":"Query Raised","queryDetails":"', CONVERT(char(10), DATEADD(day, -6, @today), 23), N' · family holding statement asked · replied ', CONVERT(char(10), DATEADD(day, -4, @today), 23), N'","reportDate":null,"remarks":null,"applicationFileId":', @fPdf, N',"reportFileId":null}')),
  (N'KHAJNA', CONCAT(N'{"ownerName":"Sukanta Ghosh","mouza":"Rajarhat","dag":"1433","khatian":"2302","lastPaidYear":"2025-26","paymentDate":"2025-06-12","receiptNo":"KH-2025-0881","amount":440,"outstanding":0,"status":"Verified","verifiedOn":"', CONVERT(char(10), DATEADD(day, -8, @today), 23), N'","remarks":null,"fileId":', @fPdf, N'}')),
  (N'LEGAL-HEIR', CONCAT(N'{"deceasedOwner":"Haripada Ghosh (part)","deathDate":"2008-01-14","deathCertFileId":', @fPdf, N',"heirName":"Rina Ghosh","relationship":"Daughter","share":"0.11","successionDoc":"Succession certificate 2008","successionFileId":', @fPdf, N',"farznamaFileId":null,"supportingDeed":null,"ownershipEvent":"Haripada Ghosh → Rina Ghosh (1985)","commissionCheck":"Pending","verification":"Verified","remarks":null}')),
  (N'MOTHER-DEED-ORIGINAL', CONCAT(N'{"motherDeedRef":"I-0221/1962","available":"Yes","holder":"Sukanta Ghosh","checkDate":"', CONVERT(char(10), DATEADD(day, -4, @today), 23), N'","verifiedBy":"Search team","condition":"Fair","remarks":null,"photoFileId":', @fPhoto, N'}')),
  (N'CERTIFIED-COPY', CONCAT(N'{"deedNo":"I-0221","deedYear":1962,"regOffice":"Registrar of Assurances, Kolkata","applicationNo":"CC/RAK/2026/1290","applicationDate":"', CONVERT(char(10), DATEADD(day, -12, @today), 23), N'","applicant":"Rajwada Developers Pvt Ltd","expectedDate":"', CONVERT(char(10), DATEADD(day, 3, @today), 23), N'","receivedDate":null,"fee":350,"status":"Applied","remarks":null,"receiptFileId":', @fPdf, N',"copyFileId":null}')),
  (N'LAND-SURVEY', CONCAT(N'{"surveyType":"Machine Survey","surveyDate":"', CONVERT(char(10), DATEADD(day, -5, @today), 23), N'","surveyor":"Bose Survey Works","company":"Bose Survey Works","mouza":"Rajarhat","dag":"452","khatian":"226","requiredArea":4,"measuredArea":3.88,"boundary":"Boundary pillars found on 3 sides","roadAccess":"12 ft road on the south","discrepancies":"0.12 katha short on the east side","remarks":null,"mapFileId":', @fMap, N',"reportFileId":', @fPdf, N',"sketchFileId":null}'));
INSERT INTO dbo.LegalActivityEntry (ActivityId, DataJson, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
SELECT a.ActivityId, n.j, a.AssignedUserId, DATEADD(day, -5, SYSUTCDATETIME()), a.AssignedUserId, DATEADD(day, -5, SYSUTCDATETIME())
FROM @EN n JOIN dbo.LegalActivityTemplate t ON t.ActivityCode = n.code JOIN dbo.LegalVerificationActivity a ON a.TemplateId = t.TemplateId AND a.VerificationId = @w2;
-- 6A chain: link deed after the mother deed
INSERT INTO dbo.LegalActivityEntry (ActivityId, DataJson, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt)
SELECT a.ActivityId, CONCAT(N'{"chainRole":"Link Deed","deedNo":"I-0874/2009","deedDate":"2009-03-15","regYear":2009,"regOffice":"ADSR Rajarhat","deedType":"Gift deed","executant":"Haripada Ghosh","claimant":"Sukanta Ghosh","mouza":"Rajarhat","dag":"452","khatian":"226","area":4,"property":"4 katha out of 4.5","previousEntryId":',
  x.EntryId, N',"copyType":"Original","status":"Identified","remarks":null,"fileId":null}'), a.AssignedUserId, DATEADD(day, -5, SYSUTCDATETIME()), a.AssignedUserId, DATEADD(day, -5, SYSUTCDATETIME())
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId AND t.ActivityCode = N'DEED-CHAIN'
JOIN dbo.LegalActivityEntry x ON x.ActivityId = a.ActivityId WHERE a.VerificationId = @w2;
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, EntryId, ChangedBy, ChangedAt)
SELECT x.ActivityId, N'Entry added', LEFT(x.DataJson, 120), x.EntryId, x.CreatedBy, x.CreatedAt FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId WHERE a.VerificationId = @w2;
-- A saved flowchart version
INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, OldDataJson, ChangedBy, ChangedAt)
SELECT a.ActivityId, N'Flowchart version', N'Version 1 · 3 transfers · before the 1985 deed is traced',
  (SELECT x.EntryId, JSON_QUERY(x.DataJson) AS data FROM dbo.LegalActivityEntry x WHERE x.ActivityId = a.ActivityId FOR JSON PATH), @uEntry, DATEADD(day, -1, SYSUTCDATETIME())
FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId AND t.ActivityCode = N'OWNERSHIP-FLOW' WHERE a.VerificationId = @w2;

-- Central documents of workspace 2, linked to activities and to an ownership event
DECLARE @WA TABLE (code NVARCHAR(30), id INT);
INSERT INTO @WA SELECT t.ActivityCode, a.ActivityId FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE a.VerificationId = @w2;
INSERT INTO dbo.LegalVerificationDocument (VerificationId, FileId, DocType, DocNo, DocDate, Authority, OwnerRef, DagRef, KhatianRef, CopyType, OriginalAvailable, OriginalHolder, Condition, VerifyStatus,
    VerifiedBy, VerifiedAt, RejectionReason, VersionNo, Remarks, UploadedBy, UploadedAt)
VALUES (@w2, @fPdf, N'Mother Deed', N'I-0221/1962', '1962-02-11', N'ADSR Rajarhat', N'Haren Sarkar → Haripada Ghosh', N'452', N'226', N'Certified Copy', N'Yes', N'Sukanta Ghosh', N'Fair', N'Verified', @uVer, DATEADD(day, -3, SYSUTCDATETIME()), NULL, 1, N'Mother deed', @uEntry, DATEADD(day, -6, SYSUTCDATETIME())),
       (@w2, @fPdf, N'Link Deed', N'I-0874/2009', '2009-03-15', N'ADSR Rajarhat', N'Haripada Ghosh → Sukanta Ghosh', N'452', N'226', N'Original', N'Yes', N'Sukanta Ghosh', N'Good', N'Not Reviewed', NULL, NULL, NULL, 1, N'Gift deed', @uEntry, DATEADD(day, -5, SYSUTCDATETIME())),
       (@w2, @fPdf, N'Court Search Report', N'CSR/2026/44', DATEADD(day, -6, @today), N'Adv. Arijit Basu', N'Haripada Ghosh', N'452', NULL, N'Scan', N'No', NULL, NULL, N'Rejected', @uVer, DATEADD(day, -2, SYSUTCDATETIME()), N'Dismissal order not attached', 1, N'Court search report', @uEntry, DATEADD(day, -6, SYSUTCDATETIME())),
       (@w2, @fPdf, N'Death Certificate', N'DC/N24P/2008/1120', '2008-01-20', N'Rajarhat Gram Panchayat', N'Haripada Ghosh', NULL, NULL, N'Photocopy', N'Yes', N'Rina Ghosh', N'Good', N'Not Reviewed', NULL, NULL, NULL, 1, N'Heir proof', @uEntry, DATEADD(day, -4, SYSUTCDATETIME())),
       (@w2, @fMap, N'Mouza Map', N'Sheet 3', DATEADD(year, -2, @today), N'BL&LRO Rajarhat', NULL, N'452', NULL, N'Scan', N'No', NULL, NULL, N'Verified', @uVer, DATEADD(day, -3, SYSUTCDATETIME()), NULL, 1, N'Original Mouza map', @uEntry, DATEADD(day, -7, SYSUTCDATETIME())),
       (@w2, @fPdf, N'Survey Report', N'BSW/2026/31', DATEADD(day, -5, @today), N'Bose Survey Works', NULL, N'452', NULL, N'Original', N'Yes', N'Company office', N'Good', N'Not Reviewed', NULL, NULL, NULL, 1, N'Machine survey', @uEntry, DATEADD(day, -5, SYSUTCDATETIME()));
-- the mother deed was replaced once: keep version 1 inactive
INSERT INTO dbo.LegalVerificationDocument (VerificationId, FileId, DocType, DocNo, DocDate, Authority, CopyType, VerifyStatus, VersionNo, Remarks, IsActive, UploadedBy, UploadedAt)
VALUES (@w2, @fPdf, N'Mother Deed', N'I-0221/1962', '1962-02-11', N'ADSR Rajarhat', N'Photocopy', N'Rejected', 1, N'Unreadable photocopy (replaced)', 0, @uEntry, DATEADD(day, -9, SYSUTCDATETIME()));
UPDATE d SET VersionNo = 2, PreviousDocId = (SELECT DocId FROM dbo.LegalVerificationDocument WHERE VerificationId = @w2 AND IsActive = 0 AND DocType = N'Mother Deed')
FROM dbo.LegalVerificationDocument d WHERE d.VerificationId = @w2 AND d.IsActive = 1 AND d.DocType = N'Mother Deed';
INSERT INTO dbo.LegalVerificationDocumentLink (DocId, ActivityId, LinkedBy)
SELECT d.DocId, a.id, @uEntry FROM dbo.LegalVerificationDocument d JOIN (VALUES (N'Mother Deed', N'DEED-CHAIN'), (N'Mother Deed', N'MOTHER-DEED-ORIGINAL'), (N'Mother Deed', N'CERTIFIED-COPY'),
  (N'Link Deed', N'DEED-CHAIN'), (N'Court Search Report', N'COURT-SEARCH'), (N'Death Certificate', N'LEGAL-HEIR'), (N'Mouza Map', N'MOUZA-MAP'), (N'Survey Report', N'LAND-SURVEY')) m(dt, code) ON m.dt = d.DocType
JOIN @WA a ON a.code = m.code WHERE d.VerificationId = @w2 AND d.IsActive = 1;
INSERT INTO dbo.LegalVerificationDocumentLink (DocId, EntryId, LinkedBy)
SELECT d.DocId, x.EntryId, @uEntry FROM dbo.LegalVerificationDocument d JOIN @WA a ON a.code = N'OWNERSHIP-FLOW' JOIN dbo.LegalActivityEntry x ON x.ActivityId = a.id
WHERE d.VerificationId = @w2 AND d.IsActive = 1 AND d.DocType = N'Mother Deed' AND JSON_VALUE(x.DataJson, '$.deedNo') = N'I-0221/1962';

-- Final reviews: approved for 7, 8, 9 (version 1 returned earlier for 9), nothing yet for 3 (pending)
DECLARE @chk NVARCHAR(MAX) = N'{"mandatory":{"status":"ok"},"applicable":{"status":"ok"},"na":{"status":"ok"},"documents":{"status":"ok"},"ownership":{"status":"ok"},"chain":{"status":"ok"},"court":{"status":"ok"},"clearance":{"status":"ok"},"succession":{"status":"ok"},"survey":{"status":"ok"},"exceptions":{"status":"ok"},"risks":{"status":"ok"}}';
INSERT INTO dbo.LegalVerificationReview (VerificationId, VersionNo, Decision, Remarks, Risks, ChecklistJson, SnapshotJson, SnapshotHash, ReviewedBy, ReviewedAt)
SELECT v.VerificationId, 1, N'Returned for Correction', N'Court search report missing the order copy', NULL,
  REPLACE(@chk, N'"court":{"status":"ok"}', N'"court":{"status":"issue","note":"order copy missing"}'), s.j, LOWER(CONVERT(CHAR(64), HASHBYTES('SHA2_256', s.j), 2)), @uRev, DATEADD(day, -35, SYSUTCDATETIME())
FROM dbo.LegalVerification v CROSS APPLY (SELECT (SELECT a.ActivityId, a.ActivityName, a.Status, a.VerifyStatus, a.Finding FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId FOR JSON PATH) AS j) s
WHERE v.VerificationNo = N'LV-TR-00009';
INSERT INTO dbo.LegalVerificationReview (VerificationId, VersionNo, Decision, Remarks, Risks, ChecklistJson, SnapshotJson, SnapshotHash, ReviewedBy, ReviewedAt)
SELECT v.VerificationId, CASE WHEN v.VerificationNo = N'LV-TR-00009' THEN 2 ELSE 1 END, N'Verified', N'All activities verified; title clear', N'Old boundary suit (dismissed 2018) — no effect on title',
  @chk, s.j, LOWER(CONVERT(CHAR(64), HASHBYTES('SHA2_256', s.j), 2)), @uRev, DATEADD(day, 25, CAST(v.StartDate AS DATETIME2))
FROM dbo.LegalVerification v CROSS APPLY (SELECT (SELECT a.ActivityId, a.ActivityName, a.Status, a.VerifyStatus, a.Finding FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId FOR JSON PATH) AS j) s
WHERE v.VerificationNo IN (N'LV-TR-00007', N'LV-TR-00008', N'LV-TR-00009');

-- Audit trail entries so the history screens show who did what
INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, Remarks, CreatedAt, UserRole)
SELECT @uEntry, N'Demo data loaded', N'Land Property', LandId, LandId, N'Migration 720 — Test Residence demo', SYSUTCDATETIME(), N'demo' FROM @lands;

EXEC sp_set_session_context N'legal_reset', 0;
COMMIT TRAN;
