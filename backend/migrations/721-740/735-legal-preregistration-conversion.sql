-- Legal: pre-registration land classification & conversion (functional update spec).
--  1. Land classification master (LegalLandType) gets: "conversion assessment required" and the default conversion
--     requirement (configurable — never a hard-coded rule); Shali, Doba, Pukur and Other are added beside Sali / Bastu / Danga.
--  2. Every parcel carries its classification assessment: current (LandTypeId) and proposed classification, proposed land
--     use, conversion required (Yes / No / Under Assessment / Legal Review Required), conversion stage (Pre-registration /
--     Post-registration / Not Applicable), remarks, and the Legal Officer's approval (Pending / Approved / Returned / Rejected).
--  3. LegalPreRegConversion: the conversion that must be completed BEFORE registration, per parcel — application, office,
--     assignee, target, status workflow, hearing, query / response, fees, order and its legal verification.
--  4. Post-registration conversions (LegalMutation, Kind = Conversion) name their parcel and stage; a parcel assessed as
--     "conversion after registration" gets its post-registration conversion task. Mutation stays separate.
IF COL_LENGTH('dbo.LegalLandType', 'ConversionAssessmentRequired') IS NULL
  ALTER TABLE dbo.LegalLandType ADD ConversionAssessmentRequired BIT NOT NULL CONSTRAINT DF_LegalLandType_Assess DEFAULT 1,
    DefaultConversionRequirement NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalLandType_Default DEFAULT N'Assess case by case', Remarks NVARCHAR(500) NULL;
GO
UPDATE dbo.LegalLandType SET ConversionAssessmentRequired = 0, DefaultConversionRequirement = N'Not required' WHERE LandTypeCode = N'BASTU';
UPDATE dbo.LegalLandType SET DefaultConversionRequirement = N'Assess case by case' WHERE LandTypeCode <> N'BASTU' AND DefaultConversionRequirement = N'Assess case by case';
INSERT INTO dbo.LegalLandType (LandTypeCode, LandTypeName, ConversionNeeded, Description, IsActive, ConversionAssessmentRequired, DefaultConversionRequirement)
SELECT v.c, v.n, 1, v.d, 1, 1, N'Assess case by case' FROM (VALUES
  (N'SHALI', N'Shali (paddy land)', N'Agricultural paddy land'), (N'DOBA', N'Doba (low-lying / water-logged)', N'Low land that holds water'),
  (N'PUKUR', N'Pukur (pond)', N'Water body — filling / conversion is restricted'), (N'OTHER', N'Other', N'Any other recorded class')) v(c, n, d)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLandType x WHERE x.LandTypeCode = v.c);
GO
IF COL_LENGTH('dbo.LegalLandParcel', 'ConversionRequired') IS NULL
  ALTER TABLE dbo.LegalLandParcel ADD ProposedLandTypeId INT NULL, ProposedLandUse NVARCHAR(200) NULL,
    ConversionRequired NVARCHAR(30) NULL, ConversionStage NVARCHAR(30) NULL, AssessmentRemarks NVARCHAR(1000) NULL,
    AssessedBy INT NULL, AssessedAt DATETIME2 NULL, AssessmentStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalLandParcel_Assess DEFAULT N'Pending';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalLandParcel_Conversion')
  ALTER TABLE dbo.LegalLandParcel ADD CONSTRAINT CK_LegalLandParcel_Conversion CHECK (
    (ConversionRequired IS NULL OR ConversionRequired IN (N'Yes', N'No', N'Under Assessment', N'Legal Review Required'))
    AND (ConversionStage IS NULL OR ConversionStage IN (N'Pre-registration', N'Post-registration', N'Not Applicable'))
    AND AssessmentStatus IN (N'Pending', N'Approved', N'Returned', N'Rejected'));
GO
IF OBJECT_ID('dbo.LegalPreRegConversion', 'U') IS NULL
  CREATE TABLE dbo.LegalPreRegConversion (
    ConversionId INT IDENTITY(1,1) CONSTRAINT PK_LegalPreRegConversion PRIMARY KEY,
    LandId INT NOT NULL, ParcelId INT NOT NULL,
    ApplicationNo NVARCHAR(60) NULL, ApplicationDate DATE NULL, OfficeName NVARCHAR(200) NULL, AssignedUserId INT NULL, TargetDate DATE NULL,
    ConversionStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalPreRegConversion_St DEFAULT N'Conversion Required',
    HearingDate DATE NULL, QueryDate DATE NULL, QueryDetails NVARCHAR(1000) NULL, ResponseDate DATE NULL, QueryResponse NVARCHAR(1000) NULL,
    FeeAmount DECIMAL(18,2) NULL, FeeRef NVARCHAR(100) NULL, OrderNo NVARCHAR(100) NULL, OrderDate DATE NULL, CompletionDate DATE NULL,
    ApplicationFileId INT NULL, OrderFileId INT NULL,
    VerificationStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalPreRegConversion_Ver DEFAULT N'Not Submitted',
    SubmittedBy INT NULL, SubmittedAt DATETIME2 NULL, VerifiedBy INT NULL, VerifiedAt DATETIME2 NULL, VerifyRemarks NVARCHAR(1000) NULL,
    Remarks NVARCHAR(1000) NULL, IsActive BIT NOT NULL CONSTRAINT DF_LegalPreRegConversion_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPreRegConversion_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalPreRegConversion_St CHECK (ConversionStatus IN (N'Assessment Pending', N'Conversion Required', N'Application Preparation', N'Application Submitted',
      N'Query Received', N'Hearing Pending', N'Under Process', N'Order Received', N'Submitted for Verification', N'Verified', N'Returned for Correction', N'Rejected', N'Not Applicable – Approved')),
    CONSTRAINT CK_LegalPreRegConversion_Ver CHECK (VerificationStatus IN (N'Not Submitted', N'Pending', N'Verified', N'Returned')));
GO
IF COL_LENGTH('dbo.LegalMutation', 'ConversionStage') IS NULL ALTER TABLE dbo.LegalMutation ADD ParcelId INT NULL, ConversionStage NVARCHAR(30) NULL;
GO
UPDATE dbo.LegalMutation SET ConversionStage = N'Post-registration' WHERE Kind = N'Conversion' AND ConversionStage IS NULL;
GO
-- Existing parcels: the classification's default suggests the requirement (still to be approved by a Legal Officer).
UPDATE p SET ConversionRequired = CASE t.DefaultConversionRequirement WHEN N'Not required' THEN N'No' ELSE N'Under Assessment' END,
  ConversionStage = CASE t.DefaultConversionRequirement WHEN N'Not required' THEN N'Not Applicable' ELSE NULL END
FROM dbo.LegalLandParcel p JOIN dbo.LegalLandType t ON t.LandTypeId = p.LandTypeId WHERE p.ConversionRequired IS NULL;
GO
