-- 630: Bring existing data to the new numbering (data fix only, no sample rows).
--  1. Enquiries without a financial year get it from their enquiry date (April–March, e.g. 2026-27).
--  2. Old-style Land IDs (LND-2026-00001) become <district code>/<running no>/<financial year>, e.g. KOL/00001/2026-27.
--     Year = the enquiry's financial year, else the land's created date. Numbered in created order, after any
--     ID already in the new format. Lands already in the new format (contain '/') are left alone, so it is safe to re-run.
IF COL_LENGTH('dbo.LegalLandEnquiry', 'FinYear') IS NOT NULL
  EXEC(N'
    UPDATE dbo.LegalLandEnquiry
    SET FinYear = CAST(YEAR(EnquiryDate) - CASE WHEN MONTH(EnquiryDate) < 4 THEN 1 ELSE 0 END AS NVARCHAR(4)) + N''-''
                + RIGHT(CAST(YEAR(EnquiryDate) - CASE WHEN MONTH(EnquiryDate) < 4 THEN 1 ELSE 0 END + 1 AS NVARCHAR(4)), 2)
    WHERE FinYear IS NULL AND EnquiryDate IS NOT NULL;

    ;WITH src AS (
      SELECT l.LandId, l.CreatedAt,
             LEFT(UPPER(COALESCE(NULLIF(LTRIM(RTRIM(d.DistrictCode)), N''''), LEFT(d.DistrictName, 3), N''LND'')), 10) + N''/'' AS Pre,
             N''/'' + COALESCE(e.FinYear,
               CAST(YEAR(l.CreatedAt) - CASE WHEN MONTH(l.CreatedAt) < 4 THEN 1 ELSE 0 END AS NVARCHAR(4)) + N''-''
               + RIGHT(CAST(YEAR(l.CreatedAt) - CASE WHEN MONTH(l.CreatedAt) < 4 THEN 1 ELSE 0 END + 1 AS NVARCHAR(4)), 2)) AS Fy
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = l.EnquiryId
      WHERE l.LandCode NOT LIKE N''%/%''
    ), numbered AS (
      SELECT s.LandId, s.Pre, s.Fy,
             ROW_NUMBER() OVER (PARTITION BY s.Pre, s.Fy ORDER BY s.CreatedAt, s.LandId)
             + ISNULL(m.MaxNo, 0) AS No
      FROM src s
      OUTER APPLY (SELECT MAX(TRY_CAST(SUBSTRING(x.LandCode, LEN(p.Pre) + 1, LEN(x.LandCode) - LEN(p.Pre) - LEN(p.Fy)) AS INT)) AS MaxNo
                   FROM (SELECT s.Pre AS Pre, s.Fy AS Fy) p
                   JOIN dbo.LegalLand x ON x.LandCode LIKE p.Pre + N''%'' AND RIGHT(x.LandCode, LEN(p.Fy)) = p.Fy) m
    )
    UPDATE l SET LandCode = n.Pre + RIGHT(N''00000'' + CAST(n.No AS NVARCHAR(10)), 5) + n.Fy
    FROM dbo.LegalLand l JOIN numbered n ON n.LandId = l.LandId;
  ');
