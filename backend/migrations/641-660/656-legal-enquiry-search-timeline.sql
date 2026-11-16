-- 656: The Deed Registry Search timeline starts when the land enquiry is saved. The enquiry names its registration
-- office type (ADSR, DSR, RA Calcutta, BLRO); its due date = enquiry date + that office's time limit. Until a search
-- result is recorded the enquiry waits on the Pending tab of Deed Registry Search; past the due date it is overdue
-- (dashboard warning + notification). Schema only.
IF COL_LENGTH('dbo.LegalLandEnquiry', 'RegistryOfficeType') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD RegistryOfficeType NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'DeedSearchDue') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD DeedSearchDue DATE NULL;
IF COL_LENGTH('dbo.LegalLandEnquiry', 'DeedSearchAlertOn') IS NULL ALTER TABLE dbo.LegalLandEnquiry ADD DeedSearchAlertOn DATE NULL;
GO
