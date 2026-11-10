-- Deed Registration Office: District picked from the District master (State follows the district), instead of typed text.
-- The State / District text columns stay — older screens read them — and are now filled from the picked district.
IF COL_LENGTH('dbo.LegalRegistrationOffice', 'DistrictId') IS NULL
  ALTER TABLE dbo.LegalRegistrationOffice ADD DistrictId INT NULL
    CONSTRAINT FK_LegalRegistrationOffice_District FOREIGN KEY REFERENCES dbo.LegalDistrict(DistrictId);
GO
-- Existing offices: link the district whose name matches the typed one.
UPDATE o SET o.DistrictId = d.DistrictId, o.State = ISNULL(d.State, o.State)
FROM dbo.LegalRegistrationOffice o
JOIN dbo.LegalDistrict d ON LTRIM(RTRIM(d.DistrictName)) = LTRIM(RTRIM(o.District))
WHERE o.DistrictId IS NULL;
GO
