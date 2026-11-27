-- Legal demo: CS / RS / LR record searches (724) filled on the TEST RESIDENCE enquiries.
--   Enquiries whose registry offices are all searched: every record year recorded (one record found in each) and
--   the record searches completed, so they stay ready for Land Conversion.
--   Enquiries still being searched: the found record years only, the rest left to search.
-- Runs wherever the TEST RESIDENCE demo exists, once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%') RETURN;
IF COL_LENGTH('dbo.LegalEnquiryOfficeSearch', 'ManualAdd') IS NULL RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch s JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = s.EnquiryId
           WHERE e.EnquiryNo LIKE N'TR-ENQ-%' AND s.OfficeType IN (N'CS Record', N'RS Record', N'LR Record')) RETURN;

BEGIN TRAN;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%' AND CreatedBy IS NOT NULL);
DECLARE @E TABLE (EnquiryId INT PRIMARY KEY, done BIT, rs NVARCHAR(60), lr NVARCHAR(60), rk NVARCHAR(60), lk NVARCHAR(60));
INSERT INTO @E
SELECT e.EnquiryId,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending'
                         AND o.OfficeType NOT IN (N'CS Record', N'RS Record', N'LR Record')) THEN 0 ELSE 1 END,
       LEFT(e.RsDagNo, 60), LEFT(e.LrDagNo, 60), LEFT(e.RsKhatianNo, 60), LEFT(e.LrKhatianNo, 60)
FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo LIKE N'TR-ENQ-%' AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected';

-- The three record timelines (as the page would create them)
INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate)
SELECT x.EnquiryId, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear, DATEADD(day, t.SlaDays, CAST(GETDATE() AS DATE))
FROM @E x JOIN dbo.LegalRegistrationOfficeType t ON t.TypeName IN (N'CS Record', N'RS Record', N'LR Record') AND t.IsActive = 1
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = x.EnquiryId AND o.OfficeType = t.TypeName);

-- The record found in each survey
DECLARE @F TABLE (t NVARCHAR(60), y INT, src NVARCHAR(200));
INSERT INTO @F VALUES (N'CS Record', 1928, N'CS Khatian (Cadastral Survey) — Collectorate record room'),
                      (N'RS Record', 1962, N'RS Khatian — BL&LRO Rajarhat, certified copy'),
                      (N'LR Record', 1992, N'LR RoR — Banglarbhumi');
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, RequestedAt, CompletedBy, CompletedAt)
SELECT x.EnquiryId, f.t, f.y, N'Found', o.SlaDays, o.DueDate,
       CASE f.t WHEN N'CS Record' THEN N'CS Khatian ' + CAST(40 + x.EnquiryId % 50 AS NVARCHAR(10))
                WHEN N'RS Record' THEN N'RS Khatian ' + ISNULL(x.rk, N'—') + N' / Dag ' + ISNULL(x.rs, N'—')
                ELSE N'LR Khatian ' + ISNULL(x.lk, N'—') + N' / Dag ' + ISNULL(x.lr, N'—') END,
       DATEFROMPARTS(f.y, 6, 30),
       CASE f.t WHEN N'CS Record' THEN N'Gopal Sarkar (recorded raiyat)' WHEN N'RS Record' THEN N'Haren Sarkar' ELSE N'Nitai Sarkar' END,
       N'Holder, area and class match the enquiry plot', f.src, @u, SYSUTCDATETIME(), @u, SYSUTCDATETIME()
FROM @E x JOIN @F f ON 1 = 1 JOIN dbo.LegalEnquiryOfficeSearch o ON o.EnquiryId = x.EnquiryId AND o.OfficeType = f.t;

-- Searched enquiries: every other year not found, and the record searches completed
;WITH n AS (SELECT TOP (300) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i FROM sys.all_objects)
INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, CalendarYear, Status, SlaDays, DueDate, Details, SiteName, RequestedBy, RequestedAt, CompletedBy, CompletedAt)
SELECT o.EnquiryId, o.OfficeType, o.FromYear + n.i, N'Not Found', o.SlaDays, o.DueDate, N'No other record for this plot', N'Searched in one range', @u, SYSUTCDATETIME(), @u, SYSUTCDATETIME()
FROM @E x JOIN dbo.LegalEnquiryOfficeSearch o ON o.EnquiryId = x.EnquiryId AND o.OfficeType IN (N'CS Record', N'RS Record', N'LR Record')
JOIN n ON o.FromYear + n.i <= YEAR(GETDATE())
WHERE x.done = 1 AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.CalendarYear = o.FromYear + n.i);
UPDATE o SET Status = N'Completed', CompletedBy = @u, CompletedAt = SYSUTCDATETIME(), Remarks = N'Record found and matched; other years searched'
FROM dbo.LegalEnquiryOfficeSearch o JOIN @E x ON x.EnquiryId = o.EnquiryId
WHERE x.done = 1 AND o.OfficeType IN (N'CS Record', N'RS Record', N'LR Record');
COMMIT;
