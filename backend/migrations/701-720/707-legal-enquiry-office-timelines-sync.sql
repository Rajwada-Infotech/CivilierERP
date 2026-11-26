-- Deed Registry Search: every open enquiry gets its office timelines (one per office type of its state that applies to
-- enquiries) — enquiries loaded straight into the database (706) never went through "save", which creates them.
-- Also removes a pending, untouched timeline whose type does not apply (as saving an enquiry does).
IF OBJECT_ID('dbo.LegalEnquiryOfficeSearch', 'U') IS NOT NULL
BEGIN
  DELETE o FROM dbo.LegalEnquiryOfficeSearch o
  JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId AND e.LandId IS NULL
  LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
  WHERE o.Status = N'Pending'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch r WHERE r.EnquiryId = o.EnquiryId AND r.OfficeType = o.OfficeType)
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalRegistrationOfficeType t WHERE t.OfficeTypeId = o.OfficeTypeId AND t.IsActive = 1 AND t.OnEnquiry = 1
                    AND (t.StateName IS NULL OR t.StateName = d.State));
  INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate)
  SELECT e.EnquiryId, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear, DATEADD(day, t.SlaDays, e.EnquiryDate)
  FROM dbo.LegalLandEnquiry e
  LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
  JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1 AND (t.StateName IS NULL OR t.StateName = d.State)
  WHERE e.LandId IS NULL AND e.IsActive = 1 AND e.EnquiryStatus <> N'Rejected'
    AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch x WHERE x.EnquiryId = e.EnquiryId AND x.OfficeType = t.TypeName);
END
GO
