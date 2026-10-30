-- 592 · Legal module sample data: two or three demo records in every section, so each screen can be tried.
--   Setup:  sub-divisions, blocks, police stations, municipalities, a Mouza, villages, RS / LR records,
--           registration offices, portal links, approval workflows, task types, reminder rules,
--           buyers, sellers, owners, customers, witnesses, advocates and deed parties.
--   Land:   three enquiries (one converted), two land properties with parties, RS / LR records and
--           pipeline progress, one past hold.
--   Deeds:  two registration searches, two deed dossiers with parties, documents and an approval task.
-- Every row is added only if it is not there yet, and looked up by its name / number (no fixed ids),
-- so the script is safe to run on any database. Demo people carry "(Demo)" in their remarks.
SET NOCOUNT ON;
GO

DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @n24 INT = (SELECT DistrictId FROM dbo.LegalDistrict WHERE DistrictName = N'North 24 Parganas');
DECLARE @s24 INT = (SELECT DistrictId FROM dbo.LegalDistrict WHERE DistrictName = N'South 24 Parganas');
DECLARE @kol INT = (SELECT DistrictId FROM dbo.LegalDistrict WHERE DistrictName = N'Kolkata');

-- ── Locations ─────────────────────────────────────────────────────────────────────────────────────
INSERT INTO dbo.LegalSubDivision (DistrictId, SubDivisionName, CreatedBy)
SELECT v.d, v.n, @u FROM (VALUES (@n24, N'Bidhannagar'), (@n24, N'Barasat Sadar'), (@s24, N'Baruipur')) v (d, n)
WHERE v.d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalSubDivision x WHERE x.DistrictId = v.d AND x.SubDivisionName = v.n);

INSERT INTO dbo.LegalBlock (DistrictId, SubDivisionId, BlockName, CreatedBy)
SELECT v.d, (SELECT SubDivisionId FROM dbo.LegalSubDivision s WHERE s.DistrictId = v.d AND s.SubDivisionName = v.sd), v.n, @u
FROM (VALUES (@n24, N'Bidhannagar', N'Rajarhat'), (@n24, N'Barasat Sadar', N'Barasat-I'), (@s24, N'Baruipur', N'Sonarpur')) v (d, sd, n)
WHERE v.d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalBlock x WHERE x.DistrictId = v.d AND x.BlockName = v.n);

INSERT INTO dbo.LegalPoliceStation (DistrictId, StationName, Phone, Address, CreatedBy)
SELECT v.d, v.n, v.p, v.a, @u FROM (VALUES
    (@n24, N'Rajarhat Police Station', N'033 2573 1234', N'Rajarhat Main Road, Kolkata 700135'),
    (@n24, N'New Town Police Station', N'033 2324 5678', N'Action Area II, New Town, Kolkata 700161'),
    (@s24, N'Sonarpur Police Station', N'033 2434 9012', N'Sonarpur Station Road, Kolkata 700150')
) v (d, n, p, a)
WHERE v.d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalPoliceStation x WHERE x.DistrictId = v.d AND x.StationName = v.n);

INSERT INTO dbo.LegalMunicipality (DistrictId, BodyName, BodyType, WardCount, Phone, Address, CreatedBy)
SELECT v.d, v.n, v.t, v.w, v.p, v.a, @u FROM (VALUES
    (@n24, N'Bidhannagar Municipal Corporation', N'Municipal Corporation', 41, N'033 2337 4100', N'Salt Lake Sector I, Kolkata 700064'),
    (@s24, N'Rajpur Sonarpur Municipality', N'Municipality', 35, N'033 2477 2201', N'Harinavi, Kolkata 700148'),
    (@kol, N'Kolkata Municipal Corporation', N'Municipal Corporation', 144, N'033 2286 1000', N'5 S.N. Banerjee Road, Kolkata 700013')
) v (d, n, t, w, p, a)
WHERE v.d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalMunicipality x WHERE x.DistrictId = v.d AND x.BodyName = v.n);

INSERT INTO dbo.LegalMouza (MouzaName, JLNo, District, DistrictId, SubDivision, SubDivisionId, Block, BlockId, PoliceStation, PoliceStationId, Pincode, Remarks, CreatedBy)
SELECT N'Sonarpur', N'45', N'South 24 Parganas', @s24, N'Baruipur', s.SubDivisionId, N'Sonarpur', b.BlockId, N'Sonarpur Police Station', p.PoliceStationId, N'700150', N'(Demo)', @u
FROM (SELECT 1 AS one) o
LEFT JOIN dbo.LegalSubDivision s ON s.DistrictId = @s24 AND s.SubDivisionName = N'Baruipur'
LEFT JOIN dbo.LegalBlock b ON b.DistrictId = @s24 AND b.BlockName = N'Sonarpur'
LEFT JOIN dbo.LegalPoliceStation p ON p.DistrictId = @s24 AND p.StationName = N'Sonarpur Police Station'
WHERE @s24 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalMouza WHERE MouzaName = N'Sonarpur' AND JLNo = N'45');

-- The existing Rajarhat Mouza gets its sub-division, block and police station picks.
UPDATE m SET SubDivisionId = s.SubDivisionId, SubDivision = s.SubDivisionName, BlockId = b.BlockId, Block = b.BlockName,
             PoliceStationId = p.PoliceStationId, PoliceStation = p.StationName
FROM dbo.LegalMouza m
JOIN dbo.LegalSubDivision s ON s.DistrictId = m.DistrictId AND s.SubDivisionName = N'Bidhannagar'
JOIN dbo.LegalBlock b ON b.DistrictId = m.DistrictId AND b.BlockName = N'Rajarhat'
JOIN dbo.LegalPoliceStation p ON p.DistrictId = m.DistrictId AND p.StationName = N'Rajarhat Police Station'
WHERE m.MouzaName = N'Rajarhat' AND m.BlockId IS NULL;

INSERT INTO dbo.LegalVillage (DistrictId, VillageName, BlockId, PoliceStationId, MunicipalityId, MouzaId, Pincode, CreatedBy)
SELECT v.d, v.n,
       (SELECT BlockId FROM dbo.LegalBlock WHERE DistrictId = v.d AND BlockName = v.b),
       (SELECT PoliceStationId FROM dbo.LegalPoliceStation WHERE DistrictId = v.d AND StationName = v.ps),
       (SELECT MunicipalityId FROM dbo.LegalMunicipality WHERE DistrictId = v.d AND BodyName = v.mu),
       (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = v.mz),
       v.pin, @u
FROM (VALUES
    (@n24, N'Jatragachi', N'Rajarhat', N'New Town Police Station', N'Bidhannagar Municipal Corporation', N'Rajarhat', N'700161'),
    (@n24, N'Bishnupur', N'Rajarhat', N'Rajarhat Police Station', N'Bidhannagar Municipal Corporation', N'Rajarhat', N'700135'),
    (@s24, N'Kamrabad', N'Sonarpur', N'Sonarpur Police Station', N'Rajpur Sonarpur Municipality', N'Sonarpur', N'700150')
) v (d, n, b, ps, mu, mz, pin)
WHERE v.d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalVillage x WHERE x.DistrictId = v.d AND x.VillageName = v.n);
GO

-- ── Land record registers (RS Khatian / RS Plot / LR RoR) ─────────────────────────────────────────
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @dec INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'DEC');
DECLARE @raj INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Rajarhat');
DECLARE @son INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Sonarpur');
DECLARE @jad INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Jadavpur');

INSERT INTO dbo.LegalRsKhatian (MouzaId, KhatianNo, HolderName, GuardianName, Share, Remarks, CreatedBy)
SELECT v.m, v.k, v.h, v.g, v.s, N'(Demo)', @u FROM (VALUES
    (@raj, N'R-112', N'Subhash Ghosh', N'Late Haripada Ghosh', N'1/1'),
    (@son, N'S-87', N'Kalipada Naskar', N'Late Gopal Naskar', N'1/2'),
    (@jad, N'J-301', N'Nirmala Dey', N'Ashok Dey', N'1/1')
) v (m, k, h, g, s)
WHERE v.m IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalRsKhatian x WHERE x.MouzaId = v.m AND x.KhatianNo = v.k);

INSERT INTO dbo.LegalRsPlot (MouzaId, PlotNo, RsKhatianId, LandClass, Area, AreaUnitId, ParcelStatus, Remarks, CreatedBy)
SELECT v.m, v.p, (SELECT RsKhatianId FROM dbo.LegalRsKhatian WHERE MouzaId = v.m AND KhatianNo = v.k), v.c, v.a, @dec, v.st, N'(Demo)', @u
FROM (VALUES
    (@raj, N'1205', N'R-112', N'Bastu', 12.5, N'Under Negotiation'),
    (@son, N'640', N'S-87', N'Sali', 33.0, N'Identified'),
    (@jad, N'2210', N'J-301', N'Bastu', 4.0, N'Registered')
) v (m, p, k, c, a, st)
WHERE v.m IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalRsPlot x WHERE x.MouzaId = v.m AND x.PlotNo = v.p);

INSERT INTO dbo.LegalLrRor (MouzaId, LrKhatianNo, LrPlotNo, RsPlotId, HolderName, GuardianName, LandClass, Area, AreaUnitId, Share, RorDate, CopyType, Source, Remarks, CreatedBy)
SELECT v.m, v.k, v.p, (SELECT RsPlotId FROM dbo.LegalRsPlot WHERE MouzaId = v.m AND PlotNo = v.rs), v.h, v.g, v.c, v.a, @dec, N'1/1', v.d, N'Certified Copy', N'BL&LRO office', N'(Demo)', @u
FROM (VALUES
    (@raj, N'2051', N'1871', N'1205', N'Anirban Ghosh', N'Subhash Ghosh', N'Bastu', 12.5, CAST('2025-11-12' AS DATE)),
    (@son, N'990', N'1102', N'640', N'Kalipada Naskar', N'Gopal Naskar', N'Sali', 33.0, CAST('2026-02-03' AS DATE))
) v (m, k, p, rs, h, g, c, a, d)
WHERE v.m IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLrRor x WHERE x.MouzaId = v.m AND x.LrKhatianNo = v.k AND x.LrPlotNo = v.p);
GO

-- ── Registration & workflow setup ─────────────────────────────────────────────────────────────────
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @l1 INT = ISNULL((SELECT TOP 1 RId FROM dbo.Role WHERE RName = N'admin'), (SELECT MIN(RId) FROM dbo.Role));
DECLARE @l2 INT = ISNULL((SELECT TOP 1 RId FROM dbo.Role WHERE RName = N'super_admin'), (SELECT MAX(RId) FROM dbo.Role));

INSERT INTO dbo.LegalRegistrationOffice (OfficeCode, OfficeName, OfficeType, State, District, Jurisdiction, Address, Phone, Email, CreatedBy)
SELECT v.c, v.n, v.t, N'West Bengal', v.d, v.j, v.a, v.p, NULL, @u FROM (VALUES
    (N'ADSR-BDN', N'A.D.S.R. Bidhannagar', N'ADSR', N'North 24 Parganas', N'Rajarhat, New Town, Salt Lake', N'Salt Lake Sector II, Kolkata 700091', N'033 2358 1100'),
    (N'ADSR-SNP', N'A.D.S.R. Sonarpur', N'ADSR', N'South 24 Parganas', N'Sonarpur, Rajpur', N'Sonarpur Station Road, Kolkata 700150', N'033 2434 1100'),
    (N'DSR-ALP', N'D.S.R. Alipore', N'DSR', N'South 24 Parganas', N'South 24 Parganas district', N'Alipore Judges Court Road, Kolkata 700027', N'033 2479 1100')
) v (c, n, t, d, j, a, p)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalRegistrationOffice x WHERE x.OfficeCode = v.c);

INSERT INTO dbo.LegalPortalLink (OfficeId, ServiceType, LinkLabel, Url, LastTestedDate, FallbackInstructions, CreatedBy)
SELECT (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = v.o), v.s, v.l, v.url, CAST(SYSDATETIME() AS DATE), v.f, @u FROM (VALUES
    (N'ADSR-BDN', N'Deed Search', N'WB Registration — deed search', N'https://wbregistration.gov.in', N'If the site is down, ask the ADSR office for a search slip.'),
    (N'ADSR-SNP', N'Market Value', N'WB Registration — market value', N'https://wbregistration.gov.in', N'Use the office''s printed MV table.'),
    (NULL, N'Land Record / RoR', N'Banglarbhumi — RoR & plot information', N'https://banglarbhumi.gov.in', N'Get a certified copy from the BL&LRO office.')
) v (o, s, l, url, f)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalPortalLink x WHERE x.LinkLabel = v.l);

IF @l1 IS NOT NULL
INSERT INTO dbo.LegalApprovalWorkflow (WorkflowName, L1RoleId, L1SlaDays, L2RoleId, L2SlaDays, EscalationRoleId, EffectiveFrom, SeparationOfDuties, AllowDelegation, CreatedBy)
SELECT v.n, @l1, v.s1, @l2, v.s2, @l2, CAST('2026-01-01' AS DATE), 1, v.dl, @u FROM (VALUES
    (N'Standard sale deed (L1 / L2)', 2, 3, 0),
    (N'Fast track — gift & POA', 1, 2, 1)
) v (n, s1, s2, dl)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalApprovalWorkflow x WHERE x.WorkflowName = v.n);

DECLARE @tpl INT = (SELECT TOP 1 TemplateId FROM dbo.LegalChecklistTemplate ORDER BY TemplateId);
IF @tpl IS NOT NULL
INSERT INTO dbo.LegalTaskType (TaskTypeCode, TaskTypeName, DeedTypeId, ChecklistTemplateId, WorkflowId, Jurisdiction, Description, CreatedBy)
SELECT v.c, v.n, (SELECT DeedTypeId FROM dbo.LegalDeedType WHERE DeedTypeCode = v.dt), @tpl,
       (SELECT WorkflowId FROM dbo.LegalApprovalWorkflow WHERE WorkflowName = v.w), N'West Bengal', v.d, @u
FROM (VALUES
    (N'NEW-SALE', N'New sale deed registration', N'SALE', N'Standard sale deed (L1 / L2)', N'Land purchase by sale deed.'),
    (N'NEW-GIFT', N'Gift deed registration', N'GIFT', N'Fast track — gift & POA', N'Gift of land within family.')
) v (c, n, dt, w, d)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalTaskType x WHERE x.TaskTypeCode = v.c)
  AND EXISTS (SELECT 1 FROM dbo.LegalDeedType WHERE DeedTypeCode = v.dt)
  AND EXISTS (SELECT 1 FROM dbo.LegalApprovalWorkflow WHERE WorkflowName = v.w);

INSERT INTO dbo.LegalReminderSla (AppliesTo, RemindEveryDays, EscalateAfterDays, RecipientRoleId, EscalationRoleId, WorkingDaysOnly, CreatedBy)
SELECT v.a, v.r, v.e, NULL, @l2, 1, @u FROM (VALUES (N'Pending Documents', 2, 7), (N'L1 Pending', 1, 3), (N'Awaiting Registered Deed', 3, 15)) v (a, r, e)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalReminderSla x WHERE x.AppliesTo = v.a);
GO

-- ── Parties ───────────────────────────────────────────────────────────────────────────────────────
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @ror INT = (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeCode = N'ROR');
DECLARE @deed INT = (SELECT TOP 1 DocTypeId FROM dbo.LegalDocumentType WHERE DocTypeCode = N'PARENT-DEED');

INSERT INTO dbo.LegalPerson (PersonRole, PartyType, FullName, GuardianName, DateOfBirth, Gender, Pan, Phone, Email, Address, LandDocTypeId, LandDocNo, Remarks, CreatedBy)
SELECT v.r, v.t, v.n, v.g, v.dob, v.sx, v.pan, v.ph, v.em, v.ad,
       CASE WHEN v.r = N'Witness' THEN NULL WHEN v.dn IS NULL THEN NULL WHEN v.dn LIKE N'I-%' THEN @deed ELSE @ror END,
       CASE WHEN v.r = N'Witness' THEN NULL ELSE v.dn END, N'(Demo)', @u
FROM (VALUES
    (N'Owner', N'Individual', N'Anirban Ghosh', N'Subhash Ghosh', CAST('1978-04-12' AS DATE), N'Male', N'AGHPG4521K', N'9830012345', N'anirban.demo@example.com', N'12 Rajarhat Main Road, Kolkata 700135', N'LR-2051'),
    (N'Owner', N'Individual', N'Suman Ghosh', N'Subhash Ghosh', CAST('1982-09-03' AS DATE), N'Male', N'BSGPG7310L', N'9830023456', NULL, N'12 Rajarhat Main Road, Kolkata 700135', N'LR-2051'),
    (N'Owner', N'Individual', N'Kalipada Naskar', N'Gopal Naskar', CAST('1965-01-20' AS DATE), N'Male', N'CKNPN1184M', N'9831034567', NULL, N'Kamrabad, Sonarpur, Kolkata 700150', N'LR-990'),
    (N'Seller', N'Individual', N'Anirban Ghosh', N'Subhash Ghosh', CAST('1978-04-12' AS DATE), N'Male', N'AGHPG4521K', N'9830012345', N'anirban.demo@example.com', N'12 Rajarhat Main Road, Kolkata 700135', N'I-1504-2015'),
    (N'Seller', N'Individual', N'Kalipada Naskar', N'Gopal Naskar', CAST('1965-01-20' AS DATE), N'Male', N'CKNPN1184M', N'9831034567', NULL, N'Kamrabad, Sonarpur, Kolkata 700150', N'I-1606-2001'),
    (N'Buyer', N'Company', N'Rajwada Infra Developers Pvt Ltd', NULL, NULL, NULL, N'AAHCR5521Q', N'03340012345', N'legal.demo@example.com', N'Sector V, Salt Lake, Kolkata 700091', NULL),
    (N'Buyer', N'Individual', N'Priya Sen', N'Arup Sen', CAST('1990-06-15' AS DATE), N'Female', N'DPSPS9021B', N'9874045678', N'priya.demo@example.com', N'Garia, Kolkata 700084', NULL),
    (N'Customer', N'Individual', N'Rahul Mukherjee', N'Tapan Mukherjee', CAST('1988-12-01' AS DATE), N'Male', N'ERMPM3345C', N'9874056789', N'rahul.demo@example.com', N'Behala, Kolkata 700034', NULL),
    (N'Customer', N'Individual', N'Sreya Banerjee', N'Debasis Banerjee', CAST('1993-03-27' AS DATE), N'Female', N'FSBPB6678D', N'9874067890', N'sreya.demo@example.com', N'Dum Dum, Kolkata 700028', NULL),
    (N'Witness', N'Individual', N'Tapas Roy', N'Late Nitai Roy', CAST('1970-08-08' AS DATE), N'Male', N'GTRPR2211E', N'9830078901', NULL, N'Baguiati, Kolkata 700059', NULL),
    (N'Witness', N'Individual', N'Mousumi Das', N'Pradip Das', CAST('1985-11-19' AS DATE), N'Female', N'HMDPD4432F', N'9830089012', NULL, N'Kestopur, Kolkata 700102', NULL)
) v (r, t, n, g, dob, sx, pan, ph, em, ad, dn)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalPerson x WHERE x.PersonRole = v.r AND (x.Pan = v.pan OR x.FullName = v.n));

INSERT INTO dbo.LegalAdvocate (AdvocateName, EnrolmentNo, BarCouncil, Practice, CourtOfPractice, Pan, Phone, Email, Address, FeeTerms, CreatedBy)
SELECT v.n, v.e, N'Bar Council of West Bengal', v.p, v.c, v.pan, v.ph, v.em, v.a, v.f, @u FROM (VALUES
    (N'Adv. Debjani Chatterjee', N'WB/1123/2008', N'Property / Conveyancing', N'Barasat District Court', N'JDCPC5512G', N'9830091234', N'debjani.demo@example.com', N'Barasat Court Chamber 14', N'₹15,000 per deed, title search extra'),
    (N'Adv. Sandip Halder', N'WB/2241/2012', N'Revenue / Land Reforms', N'Alipore Judges Court', N'KSHPH7719H', N'9830092345', NULL, N'Alipore Court Chamber 7', N'₹8,000 per mutation matter')
) v (n, e, p, c, pan, ph, em, a, f)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalAdvocate x WHERE x.EnrolmentNo = v.e);

INSERT INTO dbo.LegalParty (PartyType, LegalName, GuardianName, Pan, Phone, Email, Address, VerificationStatus, PrivacyClass, CreatedBy)
SELECT v.t, v.n, v.g, v.pan, v.ph, NULL, v.a, v.vs, N'Normal', @u FROM (VALUES
    (N'Individual', N'Nirmala Dey', N'Ashok Dey', N'LNDPD8812J', N'9831045678', N'Jadavpur, Kolkata 700032', N'Verified'),
    (N'Company', N'Rajwada Infra Developers Pvt Ltd', NULL, N'AAHCR5521Q', N'03340012345', N'Sector V, Salt Lake, Kolkata 700091', N'Verified'),
    (N'Individual', N'Kalipada Naskar', N'Gopal Naskar', N'CKNPN1184M', N'9831034567', N'Kamrabad, Sonarpur, Kolkata 700150', N'Unverified')
) v (t, n, g, pan, ph, a, vs)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalParty x WHERE x.LegalName = v.n);
GO

-- ── Land Management: enquiries, land properties, parties, RS / LR records, pipeline ───────────────
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @dec INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'DEC');
DECLARE @kat INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA');
DECLARE @raj INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Rajarhat');
DECLARE @son INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Sonarpur');
DECLARE @jad INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Jadavpur');
DECLARE @bastu INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'BASTU');
DECLARE @sali INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'SALI');
DECLARE @cert INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'copy-type' AND Name = N'Certified Copy');
DECLARE @online INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'copy-type' AND Name = N'Online Copy');
DECLARE @urban INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'location-type' AND Name = N'Urban');
DECLARE @rural INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'location-type' AND Name = N'Rural');
DECLARE @proj INT = (SELECT TOP 1 id FROM dbo.enterprise WHERE business_type = 'P' ORDER BY id);
DECLARE @yr NVARCHAR(4) = CAST(YEAR(SYSDATETIME()) AS NVARCHAR(4));

IF @u IS NOT NULL AND @raj IS NOT NULL AND @son IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE InitialNotes LIKE N'(Demo)%')
BEGIN
  DECLARE @base INT = ISNULL((SELECT MAX(TRY_CAST(RIGHT(EnquiryNo, 5) AS INT)) FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'ENQ-' + @yr + N'-%'), 0);
  INSERT INTO dbo.LegalLandEnquiry (EnquiryNo, EnquiryDate, EnquirySourceId, LandLocation, DistrictId, MouzaId, JLNo, ApproxArea, AreaUnitId, ContactPerson, ContactNumber, ExpectedPrice, AssignedUserId, EnquiryStatus, InitialNotes, CreatedBy)
  SELECT N'ENQ-' + @yr + N'-' + RIGHT('00000' + CAST(@base + v.i AS VARCHAR(5)), 5), v.dt,
         (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'enquiry-source' AND Name = v.src),
         v.loc, (SELECT DistrictId FROM dbo.LegalMouza WHERE MouzaId = v.m), v.m, (SELECT JLNo FROM dbo.LegalMouza WHERE MouzaId = v.m),
         v.a, v.unit, v.cp, v.cn, v.pr, @u, v.st, v.notes, @u
  FROM (VALUES
      (1, CAST('2026-09-02' AS DATE), N'Broker', N'Plot near Rajarhat Chowmatha', @raj, 12.5, @dec, N'Anirban Ghosh', N'9830012345', 9500000, N'Interested', N'(Demo) Bastu land, road frontage 20 ft.'),
      (2, CAST('2026-09-18' AS DATE), N'Direct Owner', N'Kamrabad, behind Sonarpur station', @son, 33.0, @dec, N'Kalipada Naskar', N'9831034567', 6600000, N'Under Review', N'(Demo) Sali land — conversion needed before building.'),
      (3, CAST('2026-10-21' AS DATE), N'Website', N'Jadavpur 8B bus stand lane', @jad, 3.0, @kat, N'Nirmala Dey', N'9831045678', 7200000, N'New', N'(Demo) Small urban plot, owner wants quick sale.')
  ) v (i, dt, src, loc, m, a, unit, cp, cn, pr, st, notes);
END;

-- Two land properties: one converted from the Rajarhat enquiry, one entered directly (Sonarpur).
IF @raj IS NOT NULL AND @son IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo)%')
BEGIN
  DECLARE @lb INT = ISNULL((SELECT MAX(TRY_CAST(RIGHT(LandCode, 5) AS INT)) FROM dbo.LegalLand WHERE LandCode LIKE N'LND-' + @yr + N'-%'), 0);
  DECLARE @enq INT = (SELECT TOP 1 EnquiryId FROM dbo.LegalLandEnquiry WHERE InitialNotes LIKE N'(Demo) Bastu%');
  INSERT INTO dbo.LegalLand (LandCode, LandName, ProjectId, DistrictId, SubDivisionId, BlockId, VillageId, PoliceStationId, MunicipalityId, MouzaId,
                             LandTypeId, LocationTypeId, Area, AreaUnitId, LandStatus, LocationAddress, NorthBoundary, SouthBoundary, EastBoundary, WestBoundary,
                             GpsLatitude, GpsLongitude, EnquiryId, WorkflowStatus, IsOnHold, Remarks, CreatedBy)
  SELECT N'LND-' + @yr + N'-' + RIGHT('00000' + CAST(@lb + v.i AS VARCHAR(5)), 5), v.n, @proj, m.DistrictId, m.SubDivisionId, m.BlockId,
         (SELECT TOP 1 VillageId FROM dbo.LegalVillage WHERE VillageName = v.vil),
         m.PoliceStationId, (SELECT TOP 1 MunicipalityId FROM dbo.LegalMunicipality WHERE BodyName = v.mu), m.MouzaId,
         v.lt, v.loc, v.a, @dec, v.st, v.addr, v.nb, v.sb, v.eb, v.wb, v.lat, v.lng, CASE WHEN v.i = 1 THEN @enq END, NULL, 0, v.rem, @u
  FROM (VALUES
      (1, N'Rajarhat Chowmatha plot', @raj, N'Bishnupur', N'Bidhannagar Municipal Corporation', @bastu, @urban, 12.5, N'Under Negotiation', N'Near Rajarhat Chowmatha, Kolkata 700135',
          N'20 ft PWD road', N'Land of Haren Mondal', N'Pond (Dag 1206)', N'Land of Bimal Das', 22.6205000, 88.4640000, N'(Demo) Converted from the Rajarhat enquiry.'),
      (2, N'Kamrabad agricultural land', @son, N'Kamrabad', N'Rajpur Sonarpur Municipality', @sali, @rural, 33.0, N'Identified', N'Kamrabad, Sonarpur, Kolkata 700150',
          N'Village road', N'Canal', N'Land of Naskar family', N'Land of Sk. Rahim', 22.4430000, 88.4320000, N'(Demo) Entered directly, without an enquiry.')
  ) v (i, n, mz, vil, mu, lt, loc, a, st, addr, nb, sb, eb, wb, lat, lng, rem)
  JOIN dbo.LegalMouza m ON m.MouzaId = v.mz;

  UPDATE e SET EnquiryStatus = N'Converted to Land Record', LandId = l.LandId
  FROM dbo.LegalLandEnquiry e JOIN dbo.LegalLand l ON l.EnquiryId = e.EnquiryId
  WHERE e.EnquiryId = @enq;
END;

DECLARE @l1 INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Converted%');
DECLARE @l2 INT = (SELECT TOP 1 LandId FROM dbo.LegalLand WHERE Remarks LIKE N'(Demo) Entered%');
DECLARE @son2 INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'relationship-type' AND Name = N'Son');
DECLARE @self INT = (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'relationship-type' AND Name = N'Self');

IF @l1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandParty WHERE LandId IN (@l1, @l2))
INSERT INTO dbo.LegalLandParty (LandId, PersonId, LandRole, RelationshipTypeId, SharePct, Remarks, CreatedBy)
SELECT v.l, p.PersonId, v.lr, v.rel, v.sh, N'(Demo)', @u
FROM (VALUES
    (@l1, N'Owner', N'Anirban Ghosh', N'Owner', @self, 60.0),
    (@l1, N'Owner', N'Suman Ghosh', N'Joint Owner', @son2, 40.0),
    (@l1, N'Seller', N'Anirban Ghosh', N'Seller', NULL, NULL),
    (@l1, N'Buyer', N'Rajwada Infra Developers Pvt Ltd', N'Buyer', NULL, NULL),
    (@l2, N'Owner', N'Kalipada Naskar', N'Owner', @self, 100.0),
    (@l2, N'Seller', N'Kalipada Naskar', N'Seller', NULL, NULL)
) v (l, role, n, lr, rel, sh)
JOIN dbo.LegalPerson p ON p.PersonRole = v.role AND p.FullName = v.n
WHERE v.l IS NOT NULL;

IF @l1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandRsRecord WHERE LandId IN (@l1, @l2))
INSERT INTO dbo.LegalLandRsRecord (LandId, MouzaId, RsKhatianNo, RsDagNo, RecordedHolder, LandTypeId, Area, AreaUnitId, Share, RecordDate, CopyTypeId, Source, VerificationStatus, Remarks, CreatedBy)
SELECT v.l, v.m, v.k, v.d, v.h, v.lt, v.a, @dec, N'1/1', v.dt, @cert, N'BL&LRO Rajarhat', v.vs, N'(Demo)', @u FROM (VALUES
    (@l1, @raj, N'R-112', N'1205', N'Subhash Ghosh', @bastu, 12.5, CAST('1962-03-01' AS DATE), N'Verified'),
    (@l2, @son, N'S-87', N'640', N'Gopal Naskar', @sali, 33.0, CAST('1960-07-15' AS DATE), N'Pending')
) v (l, m, k, d, h, lt, a, dt, vs)
WHERE v.l IS NOT NULL;

IF @l1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandLrRecord WHERE LandId IN (@l1, @l2))
INSERT INTO dbo.LegalLandLrRecord (LandId, MouzaId, LrKhatianNo, LrDagNo, MatchingRsRecordId, RecordedHolder, GuardianName, LandTypeId, Area, AreaUnitId, Share, RorDate, CopyTypeId, Source, VerificationStatus, Remarks, CreatedBy)
SELECT v.l, v.m, v.k, v.d, (SELECT TOP 1 RsRecordId FROM dbo.LegalLandRsRecord r WHERE r.LandId = v.l), v.h, v.g, v.lt, v.a, @dec, v.sh, v.dt, @online, N'Banglarbhumi', v.vs, v.rem, @u FROM (VALUES
    (@l1, @raj, N'2051', N'1871', N'Anirban Ghosh', N'Subhash Ghosh', @bastu, 7.5, N'60/100', CAST('2025-11-12' AS DATE), N'Verified', N'(Demo)'),
    (@l1, @raj, N'2052', N'1871', N'Suman Ghosh', N'Subhash Ghosh', @bastu, 5.0, N'40/100', CAST('2025-11-12' AS DATE), N'Pending', N'(Demo) Awaiting certified copy.'),
    (@l2, @son, N'990', N'1102', N'Kalipada Naskar', N'Gopal Naskar', @sali, 33.0, N'1/1', CAST('2026-02-03' AS DATE), N'Needs Correction', N'(Demo) Area on RoR differs from RS record.')
) v (l, m, k, d, h, g, lt, a, sh, dt, vs, rem)
WHERE v.l IS NOT NULL;

-- Pipeline: land 1 has steps 1–3 done and 4 in progress; land 2 skipped the enquiry and is on the property step.
IF @l1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalWorkflowStepState WHERE LandId IN (@l1, @l2))
BEGIN
  INSERT INTO dbo.LegalWorkflowStepState (LandId, StepCode, Status, ResponsibleUserId, Remarks, SkipReason, UpdatedBy)
  SELECT v.l, v.c, v.s, @u, v.r, v.sk, @u FROM (VALUES
      (@l1, N'ENQUIRY', N'Completed', N'(Demo) Converted from enquiry', NULL),
      (@l1, N'PROPERTY', N'Completed', N'(Demo) Property details checked', NULL),
      (@l1, N'PARTIES', N'Completed', N'(Demo) Owners 60 / 40 confirmed', NULL),
      (@l1, N'RECORD_MAPPING', N'In Progress', N'(Demo) One LR record awaiting certified copy', NULL),
      (@l2, N'ENQUIRY', N'Skipped', NULL, N'(Demo) Land offered directly by the owner, no enquiry raised'),
      (@l2, N'PROPERTY', N'In Progress', N'(Demo) Boundaries being confirmed on site', NULL)
  ) v (l, c, s, r, sk)
  WHERE v.l IS NOT NULL;

  INSERT INTO dbo.LegalWorkflowStepHistory (LandId, StepCode, PreviousStatus, NewStatus, Remarks, ChangedBy)
  SELECT LandId, StepCode, NULL, Status, ISNULL(SkipReason, Remarks), @u FROM dbo.LegalWorkflowStepState WHERE LandId IN (@l1, @l2);

  -- A past hold on land 1, already resumed.
  INSERT INTO dbo.LegalHold (LandId, HoldCategory, HoldReason, HoldDate, HeldBy, ExpectedReviewDate, Remarks, ResumedBy, ResumedAt, ResumeRemarks)
  VALUES (@l1, N'Document Missing', N'(Demo) Previous deed copy not available', CAST('2026-10-05' AS DATE), @u, CAST('2026-10-15' AS DATE), NULL, @u, CAST('2026-10-12' AS DATETIME2), N'(Demo) Certified copy received from ADSR');

  INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, NewValue, Remarks)
  SELECT @u, N'Land created', N'Land Property', LandId, LandId, N'{"landCode":"' + LandCode + N'"}', N'(Demo) sample data'
  FROM dbo.LegalLand WHERE LandId IN (@l1, @l2);
  INSERT INTO dbo.LegalRecordAudit (UserId, Action, EntityType, EntityId, LandId, Remarks)
  VALUES (@u, N'Land put on hold', N'Land Property', @l1, @l1, N'(Demo) Previous deed copy not available'),
         (@u, N'Workflow resumed', N'Land Property', @l1, @l1, N'(Demo) Certified copy received from ADSR');

  UPDATE l SET WorkflowStatus = ISNULL((
      SELECT TOP 1 s.StepName FROM dbo.LegalWorkflowStep s
      LEFT JOIN dbo.LegalWorkflowStepState st ON st.StepCode = s.StepCode AND st.LandId = l.LandId
      WHERE s.IsActive = 1 AND ISNULL(st.Status, 'Not Started') NOT IN ('Completed', 'Skipped') ORDER BY s.StepNo), 'Completed')
  FROM dbo.LegalLand l WHERE l.LandId IN (@l1, @l2);
END;
GO

-- ── Deed registration: searches, dossiers, parties, documents, approval task ──────────────────────
DECLARE @u INT = (SELECT MIN(id) FROM dbo.users);
DECLARE @bdn INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'ADSR-BDN');
DECLARE @snp INT = (SELECT OfficeId FROM dbo.LegalRegistrationOffice WHERE OfficeCode = N'ADSR-SNP');
DECLARE @sale INT = (SELECT DeedTypeId FROM dbo.LegalDeedType WHERE DeedTypeCode = N'SALE');
DECLARE @dec INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'DEC');
DECLARE @raj INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Rajarhat');
DECLARE @son INT = (SELECT TOP 1 MouzaId FROM dbo.LegalMouza WHERE MouzaName = N'Sonarpur');
DECLARE @proj INT = (SELECT TOP 1 id FROM dbo.enterprise WHERE business_type = 'P' ORDER BY id);
DECLARE @l1role INT = ISNULL((SELECT TOP 1 RId FROM dbo.Role WHERE RName = N'admin'), (SELECT MIN(RId) FROM dbo.Role));

IF @u IS NOT NULL AND @bdn IS NOT NULL AND @snp IS NOT NULL AND @sale IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.LegalSearchSession WHERE Notes LIKE N'(Demo)%')
BEGIN
  INSERT INTO dbo.LegalSearchSession (SessionNumber, RegistrationDate, OfficeId, SourceType, SearchStatus, MouzaId, RsPlotNo, LrPlotNo, RsKhatianNo, LrKhatianNo, PartyName, DeedNo, DeedYear, PropertyDescription, EvidenceRef, EvidenceAmount, Notes, PerformedBy, PerformedAt, CreatedBy)
  VALUES
    (N'SRCH-DEMO-0001', CAST('2026-10-08' AS DATE), @bdn, N'Online Portal', N'Match Found', @raj, N'1205', N'1871', N'R-112', N'2051', N'Anirban Ghosh', N'I-1504', 2015, N'Bastu, 12.5 dec, Rajarhat', N'GRIPS-DEMO-8812', 150, N'(Demo) Parent deed found.', @u, SYSUTCDATETIME(), @u),
    (N'SRCH-DEMO-0002', CAST('2026-10-20' AS DATE), @snp, N'Office Visit', N'No Match', @son, N'640', N'1102', N'S-87', N'990', N'Kalipada Naskar', NULL, NULL, N'Sali, 33 dec, Sonarpur', NULL, NULL, N'(Demo) No registered deed in the last 30 years.', @u, SYSUTCDATETIME(), @u);

  INSERT INTO dbo.LegalSearchCandidate (SessionId, CandidateRef, DeedNo, DeedYear, DeedDate, OfficeId, PartySummary, PropertySummary, VerificationStatus, VerificationNotes, VerifiedBy, VerifiedAt, CreatedBy)
  SELECT s.SessionId, v.r, v.dn, v.dy, v.dd, @bdn, v.ps, v.pr, v.vs, v.vn, @u, SYSUTCDATETIME(), @u
  FROM dbo.LegalSearchSession s
  CROSS JOIN (VALUES
      (N'CAND-1', N'I-1504', 2015, CAST('2015-05-10' AS DATE), N'Subhash Ghosh → Anirban Ghosh', N'RS Dag 1205, 12.5 dec', N'Accepted', N'(Demo) Matches RS / LR records'),
      (N'CAND-2', N'I-0877', 2009, CAST('2009-02-02' AS DATE), N'Haren Mondal → Bimal Das', N'RS Dag 1206 (neighbouring plot)', N'Rejected', N'(Demo) Different plot')
  ) v (r, dn, dy, dd, ps, pr, vs, vn)
  WHERE s.SessionNumber = N'SRCH-DEMO-0001';

  INSERT INTO dbo.LegalDeedDossier (DossierNumber, SearchSessionId, CandidateId, DeedNumber, DeedYear, DeedDate, RegistrationOfficeId, DeedTypeId, TransactionType, ProjectId, MouzaId,
                                    RsDag, LrDag, RsKhatian, LrKhatian, PurchasedArea, AreaUnitId, PropertyDescription, ConsiderationAmount, MarketValue, StampDutyAmount, RegistrationFee,
                                    AssignedOwnerId, NextAction, NextActionOwnerId, TargetCompletionDate, VerificationStatus, ApprovalStatus, OverallStatus, CreatedBy)
  SELECT v.no, s.SessionId, (SELECT TOP 1 CandidateId FROM dbo.LegalSearchCandidate c WHERE c.SessionId = s.SessionId AND c.VerificationStatus = N'Accepted'),
         v.dn, v.dy, v.dd, v.o, @sale, N'Purchase', @proj, v.m, v.rd, v.ld, v.rk, v.lk, v.a, @dec, v.descr, v.c, v.mv, v.sd, v.rf,
         @u, v.na, @u, v.tgt, v.vs, v.aps, v.os, @u
  FROM (VALUES
      (N'DOS-DEMO-0001', N'SRCH-DEMO-0001', N'I-2207', 2026, CAST('2026-10-18' AS DATE), @bdn, @raj, N'1205', N'1871', N'R-112', N'2051', 12.5, N'Bastu land at Rajarhat Chowmatha', 9200000, 9800000, 588000, 98000,
          N'L1 review of registered deed', CAST('2026-11-10' AS DATE), N'Accepted', N'Pending', N'L1 Pending'),
      (N'DOS-DEMO-0002', N'SRCH-DEMO-0002', NULL, NULL, NULL, @snp, @son, N'640', N'1102', N'S-87', N'990', 33.0, N'Sali land at Kamrabad, Sonarpur', 6400000, 6600000, NULL, NULL,
          N'Collect RoR certified copy', CAST('2026-11-30' AS DATE), N'Pending', N'Pending', N'Pending Documents')
  ) v (no, sess, dn, dy, dd, o, m, rd, ld, rk, lk, a, descr, c, mv, sd, rf, na, tgt, vs, aps, os)
  JOIN dbo.LegalSearchSession s ON s.SessionNumber = v.sess;

  INSERT INTO dbo.LegalDossierParty (DossierId, PartyId, PartyRole, IsPrimary, Remarks)
  SELECT d.DossierId, p.PartyId, v.r, 1, N'(Demo)'
  FROM (VALUES
      (N'DOS-DEMO-0001', N'Nirmala Dey', N'Seller / Landowner'),
      (N'DOS-DEMO-0001', N'Rajwada Infra Developers Pvt Ltd', N'Buyer (Company)'),
      (N'DOS-DEMO-0002', N'Kalipada Naskar', N'Seller / Landowner'),
      (N'DOS-DEMO-0002', N'Rajwada Infra Developers Pvt Ltd', N'Buyer (Company)')
  ) v (dos, n, r)
  JOIN dbo.LegalDeedDossier d ON d.DossierNumber = v.dos
  JOIN dbo.LegalParty p ON p.LegalName = v.n;

  INSERT INTO dbo.LegalDossierDocument (DossierId, DocTypeId, VersionNo, FileName, DocumentStatus, RequirementType, Applicability, ReviewNotes, ResponsibleUserId, DueDate, CreatedBy)
  SELECT d.DossierId, t.DocTypeId, 1, v.f, v.s, N'Required', N'Applicable', v.rn, @u, v.due, @u
  FROM (VALUES
      (N'DOS-DEMO-0001', N'REG-DEED', N'I-2207-2026.pdf', N'Accepted', N'(Demo) Registered deed verified', NULL),
      (N'DOS-DEMO-0001', N'PARENT-DEED', N'I-1504-2015.pdf', N'Accepted', N'(Demo)', NULL),
      (N'DOS-DEMO-0001', N'STAMP-FEE', N'GRIPS-receipt.pdf', N'Accepted', N'(Demo)', NULL),
      (N'DOS-DEMO-0002', N'ROR', NULL, N'Requested', N'(Demo) Certified copy applied at BL&LRO', CAST('2026-11-15' AS DATE)),
      (N'DOS-DEMO-0002', N'SELLER-ID', NULL, N'Requested', N'(Demo)', CAST('2026-11-08' AS DATE))
  ) v (dos, code, f, s, rn, due)
  JOIN dbo.LegalDeedDossier d ON d.DossierNumber = v.dos
  JOIN dbo.LegalDocumentType t ON t.DocTypeCode = v.code;

  INSERT INTO dbo.LegalApprovalTask (DossierId, ApprovalStage, AssignedRoleId, AssignedUserId, Status, Comments)
  SELECT DossierId, N'L1', @l1role, @u, N'Pending', N'(Demo) Review registered deed I-2207 / 2026'
  FROM dbo.LegalDeedDossier WHERE DossierNumber = N'DOS-DEMO-0001';
END;
GO

PRINT '592-legal-demo-data applied successfully.';
GO
