-- Land Enquiry: GPS latitude / longitude of the plot, to open it on a map and carry it to the land on conversion.
IF COL_LENGTH('dbo.LegalLandEnquiry', 'GpsLatitude') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD GpsLatitude DECIMAL(10,7) NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'GpsLongitude') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD GpsLongitude DECIMAL(10,7) NULL;
GO
