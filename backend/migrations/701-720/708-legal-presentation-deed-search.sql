-- Legal presentation data: real Deed Registry Search results for the demo enquiries (706 loaded them without any).
--   Converted enquiries (ENQ-DEMO-0004–0008): every office searched 1956 → this year and completed (a land can only be
--     converted after that); ADSR found the earlier sale deed I-2210/2004, every other year "not found".
--   ENQ-DEMO-0002 (Under Review): ADSR done (1 deed found), BLRO done (nothing found), DSR half way (1956–1990), RA Calcutta not started.
--   ENQ-DEMO-0001 / 0003: just raised — timelines open, nothing searched yet.
-- Only the ENQ-DEMO- enquiries are touched.
IF OBJECT_ID('dbo.LegalEnquiryDeedSearch', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'ENQ-DEMO-%')
BEGIN
  SET NOCOUNT ON;
  DECLARE @U INT = COALESCE((SELECT TOP 1 u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE r.RName LIKE N'%Super%' AND ISNULL(u.discontinue, 0) = 0 ORDER BY u.id), (SELECT TOP 1 id FROM dbo.users ORDER BY id));
  DECLARE @Y INT = YEAR(GETDATE());
  DECLARE @Site NVARCHAR(100) = N'WB Registration (wbregistration.gov.in)';
  DECLARE @Enq TABLE (id INT, no NVARCHAR(30), d DATE, converted BIT);
  INSERT @Enq SELECT EnquiryId, EnquiryNo, EnquiryDate, CASE WHEN LandId IS NULL THEN 0 ELSE 1 END FROM dbo.LegalLandEnquiry
    WHERE EnquiryNo LIKE N'ENQ-DEMO-%' AND (LandId IS NOT NULL OR EnquiryNo = N'ENQ-DEMO-0002');

  -- Start clean for these enquiries.
  DELETE s FROM dbo.LegalEnquiryDeedSearch s JOIN @Enq e ON e.id = s.EnquiryId;
  DELETE o FROM dbo.LegalEnquiryOfficeSearch o JOIN @Enq e ON e.id = o.EnquiryId;

  -- One timeline per office type of the state (as saving an enquiry does), with the first office of that type.
  INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, OfficeId, SlaDays, FromYear, DueDate)
  SELECT e.id, t.OfficeTypeId, t.TypeName, (SELECT TOP 1 r.OfficeId FROM dbo.LegalRegistrationOffice r WHERE r.OfficeType = t.TypeName ORDER BY r.OfficeId),
         t.SlaDays, t.FromYear, DATEADD(DAY, t.SlaDays, e.d)
  FROM @Enq e JOIN dbo.LegalLandEnquiry q ON q.EnquiryId = e.id LEFT JOIN dbo.LegalDistrict dd ON dd.DistrictId = q.DistrictId
  JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1 AND (t.StateName IS NULL OR t.StateName = dd.State);

  -- Year results: [enquiry filter] office, up to which year, found year / deed
  ;WITH yrs AS (SELECT 1956 AS Y UNION ALL SELECT Y + 1 FROM yrs WHERE Y < @Y)
  INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
  SELECT o.EnquiryId, o.OfficeType, o.OfficeId, yrs.Y,
         CASE WHEN f.Y = yrs.Y THEN N'Found' ELSE N'Not Found' END, o.SlaDays, o.DueDate,
         CASE WHEN f.Y = yrs.Y THEN f.DeedNo END, CASE WHEN f.Y = yrs.Y THEN DATEFROMPARTS(yrs.Y, 5, 10) END,
         CASE WHEN f.Y = yrs.Y THEN f.Parties END, CASE WHEN f.Y = yrs.Y THEN N'Deed index matched the RS / LR Dag.' END,
         @Site, @U, @U, DATEADD(DAY, -1, o.DueDate)
  FROM dbo.LegalEnquiryOfficeSearch o JOIN @Enq e ON e.id = o.EnquiryId
  CROSS JOIN yrs
  OUTER APPLY (SELECT CASE WHEN o.OfficeType = N'ADSR' THEN (CASE WHEN e.converted = 1 THEN 2004 ELSE 2009 END) END AS Y,
                      CASE WHEN e.converted = 1 THEN N'I-2210/2004' ELSE N'I-0874/2009' END AS DeedNo,
                      CASE WHEN e.converted = 1 THEN N'Haripada Sarkar → Bimal Sarkar & Kamal Sarkar' ELSE N'Haripada Ghosh → Sukanta Ghosh' END AS Parties) f
  WHERE e.converted = 1
     OR (o.OfficeType IN (N'ADSR', N'BLRO'))
     OR (o.OfficeType = N'DSR' AND yrs.Y <= 1990)
  OPTION (MAXRECURSION 400);

  -- Completed offices: all of a converted enquiry's; ADSR and BLRO of ENQ-DEMO-0002.
  UPDATE o SET Status = N'Completed', CompletedBy = @U, CompletedAt = DATEADD(DAY, -1, o.DueDate),
         Remarks = N'1956–' + CAST(@Y AS NVARCHAR(4)) + N' searched; ' +
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.Status = N'Found') THEN N'1 deed found.' ELSE N'nothing found.' END
  FROM dbo.LegalEnquiryOfficeSearch o JOIN @Enq e ON e.id = o.EnquiryId
  WHERE e.converted = 1 OR o.OfficeType IN (N'ADSR', N'BLRO');
  -- ENQ-DEMO-0002's open offices are still within their time: due a week from now.
  UPDATE o SET DueDate = CAST(DATEADD(DAY, 7, GETDATE()) AS DATE)
  FROM dbo.LegalEnquiryOfficeSearch o JOIN @Enq e ON e.id = o.EnquiryId WHERE e.converted = 0 AND o.Status = N'Pending';
END
GO
