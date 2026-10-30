-- 590-legal-location-party-land-masters.sql
-- Legal module, more Setup masters:
--   Locations:     District, Municipality (local body), Police Station, Village
--   Land records:  Land Type, Land (the parcel: location, RS / LR records, area, owner, documents)
--   Parties:       Buyer, Seller, Owner, Customer, Witness (one LegalPerson table, kept apart by PersonRole), Advocate
--   Documents:     LegalMasterFile — every document uploaded on a master (base64, like CRM booking documents)
-- Table definitions mirror backend/routes/legal/masterConfig.js. PAN and Aadhaar are unique per role when
-- entered. Seeds: the 23 districts of West Bengal and the common land types. Idempotent: everything is guarded.

-- Uploaded documents (ID proofs, land record copies, enrolment certificates). Rows are never overwritten:
-- replacing a document on a record points it at a new file and the old one stays as evidence.
IF OBJECT_ID('dbo.LegalMasterFile', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalMasterFile (
    FileId     INT IDENTITY(1,1) CONSTRAINT PK_LegalMasterFile PRIMARY KEY,
    FileName   NVARCHAR(200) NOT NULL,
    MimeType   NVARCHAR(100) NOT NULL,
    FileSize   INT           NOT NULL,
    FileBase64 NVARCHAR(MAX) NOT NULL,
    UploadedBy INT           NULL,
    UploadedAt DATETIME2     NOT NULL CONSTRAINT DF_LegalMasterFile_UploadedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LegalMasterFile_UploadedBy FOREIGN KEY (UploadedBy) REFERENCES dbo.users(id)
  );
END
GO

-- District: Districts the company's land and registration offices sit in.
IF OBJECT_ID('dbo.LegalDistrict', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalDistrict (
    DistrictId INT IDENTITY(1,1) CONSTRAINT PK_LegalDistrict PRIMARY KEY,
    DistrictName NVARCHAR(100) NOT NULL,
    DistrictCode NVARCHAR(20) NULL,
    State NVARCHAR(100) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalDistrict_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalDistrict_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalDistrict UNIQUE (State, DistrictName),
    CONSTRAINT FK_LegalDistrict_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalDistrict_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Municipality: Municipalities, corporations and panchayats — the local body for building sanction and mutation.
IF OBJECT_ID('dbo.LegalMunicipality', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalMunicipality (
    MunicipalityId INT IDENTITY(1,1) CONSTRAINT PK_LegalMunicipality PRIMARY KEY,
    DistrictId INT NOT NULL,
    BodyName NVARCHAR(150) NOT NULL,
    BodyType NVARCHAR(60) NOT NULL,
    WardCount INT NULL,
    Phone NVARCHAR(15) NULL,
    Address NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalMunicipality_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalMunicipality_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalMunicipality UNIQUE (DistrictId, BodyName),
    CONSTRAINT FK_LegalMunicipality_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId),
    CONSTRAINT FK_LegalMunicipality_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalMunicipality_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Police Station: Police stations whose jurisdiction a parcel falls under, as written in deeds.
IF OBJECT_ID('dbo.LegalPoliceStation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalPoliceStation (
    PoliceStationId INT IDENTITY(1,1) CONSTRAINT PK_LegalPoliceStation PRIMARY KEY,
    DistrictId INT NOT NULL,
    StationName NVARCHAR(150) NOT NULL,
    Phone NVARCHAR(15) NULL,
    Address NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalPoliceStation_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPoliceStation_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalPoliceStation UNIQUE (DistrictId, StationName),
    CONSTRAINT FK_LegalPoliceStation_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId),
    CONSTRAINT FK_LegalPoliceStation_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalPoliceStation_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Village: Villages / localities, with their police station, local body and revenue Mouza.
IF OBJECT_ID('dbo.LegalVillage', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVillage (
    VillageId INT IDENTITY(1,1) CONSTRAINT PK_LegalVillage PRIMARY KEY,
    DistrictId INT NOT NULL,
    VillageName NVARCHAR(150) NOT NULL,
    PoliceStationId INT NULL,
    MunicipalityId INT NULL,
    MouzaId INT NULL,
    Pincode NVARCHAR(10) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalVillage_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalVillage_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalVillage UNIQUE (DistrictId, VillageName),
    CONSTRAINT FK_LegalVillage_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId),
    CONSTRAINT FK_LegalVillage_PoliceStationId FOREIGN KEY (PoliceStationId) REFERENCES dbo.LegalPoliceStation(PoliceStationId),
    CONSTRAINT FK_LegalVillage_MunicipalityId FOREIGN KEY (MunicipalityId) REFERENCES dbo.LegalMunicipality(MunicipalityId),
    CONSTRAINT FK_LegalVillage_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalVillage_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalVillage_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Land Type: Classes of land as recorded (Sali, Bastu, Danga…) and whether building on it needs conversion.
IF OBJECT_ID('dbo.LegalLandType', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalLandType (
    LandTypeId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandType PRIMARY KEY,
    LandTypeCode NVARCHAR(20) NOT NULL,
    LandTypeName NVARCHAR(100) NOT NULL,
    ConversionNeeded BIT NOT NULL CONSTRAINT DF_LegalLandType_ConversionNeeded DEFAULT 0,
    Description NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandType_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandType_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLandType UNIQUE (LandTypeCode),
    CONSTRAINT FK_LegalLandType_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalLandType_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Person (Buyer, Seller, Owner, Customer, Witness): Buyers of land: identity, PAN / Aadhaar and their land record documents.
IF OBJECT_ID('dbo.LegalPerson', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalPerson (
    PersonId INT IDENTITY(1,1) CONSTRAINT PK_LegalPerson PRIMARY KEY,
    PersonRole NVARCHAR(30) NOT NULL CONSTRAINT CK_LegalPerson_PersonRole CHECK (PersonRole IN (N'Buyer', N'Seller', N'Owner', N'Customer', N'Witness')),
    FullName NVARCHAR(200) NOT NULL,
    GuardianName NVARCHAR(200) NULL,
    Pan NVARCHAR(10) NULL,
    Aadhaar NVARCHAR(14) NULL,
    Phone NVARCHAR(15) NULL,
    Email NVARCHAR(150) NULL,
    Address NVARCHAR(500) NULL,
    IdProofFileId INT NULL,
    LandDocTypeId INT NULL,
    LandDocNo NVARCHAR(60) NULL,
    LandDocFileId INT NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalPerson_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPerson_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalPerson_IdProofFileId FOREIGN KEY (IdProofFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalPerson_LandDocTypeId FOREIGN KEY (LandDocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId),
    CONSTRAINT FK_LegalPerson_LandDocFileId FOREIGN KEY (LandDocFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalPerson_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalPerson_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Advocate: Advocates and lawyers who draft, vet and register deeds for the company.
IF OBJECT_ID('dbo.LegalAdvocate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalAdvocate (
    AdvocateId INT IDENTITY(1,1) CONSTRAINT PK_LegalAdvocate PRIMARY KEY,
    AdvocateName NVARCHAR(200) NOT NULL,
    EnrolmentNo NVARCHAR(40) NOT NULL,
    BarCouncil NVARCHAR(150) NOT NULL,
    Practice NVARCHAR(60) NULL,
    CourtOfPractice NVARCHAR(150) NULL,
    Pan NVARCHAR(10) NULL,
    Phone NVARCHAR(15) NULL,
    Email NVARCHAR(150) NULL,
    Address NVARCHAR(500) NULL,
    EnrolmentFileId INT NULL,
    FeeTerms NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalAdvocate_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalAdvocate_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalAdvocate UNIQUE (EnrolmentNo),
    CONSTRAINT FK_LegalAdvocate_EnrolmentFileId FOREIGN KEY (EnrolmentFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalAdvocate_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalAdvocate_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Land: A land parcel the company holds or is buying: where it is, its records, area, owner and documents.
IF OBJECT_ID('dbo.LegalLand', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalLand (
    LandId INT IDENTITY(1,1) CONSTRAINT PK_LegalLand PRIMARY KEY,
    LandCode NVARCHAR(30) NOT NULL,
    LandName NVARCHAR(200) NOT NULL,
    ProjectId INT NULL,
    DistrictId INT NOT NULL,
    VillageId INT NULL,
    PoliceStationId INT NULL,
    MunicipalityId INT NULL,
    MouzaId INT NULL,
    RsKhatianId INT NULL,
    RsPlotId INT NULL,
    LrRorId INT NULL,
    LandTypeId INT NULL,
    Area DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    OwnerId INT NULL,
    LandStatus NVARCHAR(60) NOT NULL,
    LandDocTypeId INT NULL,
    LandDocNo NVARCHAR(60) NULL,
    LandDocFileId INT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLand_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLand_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLand UNIQUE (LandCode),
    CONSTRAINT FK_LegalLand_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId),
    CONSTRAINT FK_LegalLand_VillageId FOREIGN KEY (VillageId) REFERENCES dbo.LegalVillage(VillageId),
    CONSTRAINT FK_LegalLand_PoliceStationId FOREIGN KEY (PoliceStationId) REFERENCES dbo.LegalPoliceStation(PoliceStationId),
    CONSTRAINT FK_LegalLand_MunicipalityId FOREIGN KEY (MunicipalityId) REFERENCES dbo.LegalMunicipality(MunicipalityId),
    CONSTRAINT FK_LegalLand_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalLand_RsKhatianId FOREIGN KEY (RsKhatianId) REFERENCES dbo.LegalRsKhatian(RsKhatianId),
    CONSTRAINT FK_LegalLand_RsPlotId FOREIGN KEY (RsPlotId) REFERENCES dbo.LegalRsPlot(RsPlotId),
    CONSTRAINT FK_LegalLand_LrRorId FOREIGN KEY (LrRorId) REFERENCES dbo.LegalLrRor(LrRorId),
    CONSTRAINT FK_LegalLand_LandTypeId FOREIGN KEY (LandTypeId) REFERENCES dbo.LegalLandType(LandTypeId),
    CONSTRAINT FK_LegalLand_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalLand_OwnerId FOREIGN KEY (OwnerId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalLand_LandDocTypeId FOREIGN KEY (LandDocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId),
    CONSTRAINT FK_LegalLand_LandDocFileId FOREIGN KEY (LandDocFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalLand_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalLand_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- PAN and Aadhaar: one person per role (a seller may also be a buyer), only when entered.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LegalPerson_Role_Pan')
  CREATE UNIQUE INDEX UX_LegalPerson_Role_Pan ON dbo.LegalPerson (PersonRole, Pan) WHERE Pan IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LegalPerson_Role_Aadhaar')
  CREATE UNIQUE INDEX UX_LegalPerson_Role_Aadhaar ON dbo.LegalPerson (PersonRole, Aadhaar) WHERE Aadhaar IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalPerson_Role_Name')
  CREATE INDEX IX_LegalPerson_Role_Name ON dbo.LegalPerson (PersonRole, FullName);
GO

-- ── Menu rights ───────────────────────────────────────────────────────────────────────────────────
DECLARE @pages TABLE (PageKey NVARCHAR(100), Label NVARCHAR(200), GroupName NVARCHAR(150), SortOrder INT);
INSERT INTO @pages VALUES
    (N'legal-land-type-master', N'Land Type Master', N'Legal Masters - Land records', 210)
  , (N'legal-land-master', N'Land Master', N'Legal Masters - Land records', 220)
  , (N'legal-district-master', N'District Master', N'Legal Masters - Locations', 230)
  , (N'legal-municipality-master', N'Municipality Master', N'Legal Masters - Locations', 240)
  , (N'legal-police-station-master', N'Police Station Master', N'Legal Masters - Locations', 250)
  , (N'legal-village-master', N'Village Master', N'Legal Masters - Locations', 260)
  , (N'legal-buyer-master', N'Buyer Master', N'Legal Masters - Parties', 270)
  , (N'legal-seller-master', N'Seller Master', N'Legal Masters - Parties', 280)
  , (N'legal-owner-master', N'Owner Master', N'Legal Masters - Parties', 290)
  , (N'legal-customer-master', N'Customer Master', N'Legal Masters - Parties', 300)
  , (N'legal-witness-master', N'Witness Master', N'Legal Masters - Parties', 310)
  , (N'legal-advocate-master', N'Advocate Master', N'Legal Masters - Parties', 320);

UPDATE pd SET Label = p.Label, Module = N'Legal', GroupName = p.GroupName, Actions = N'view,create,edit,delete,print,export',
              SortOrder = p.SortOrder, IsActive = 1, UpdatedAt = SYSDATETIME()
FROM dbo.PageDefinitions pd JOIN @pages p ON p.PageKey = pd.PageKey;

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, N'Legal', p.GroupName, N'view,create,edit,delete,print,export', p.SortOrder, 1, N'migration-590', SYSDATETIME()
FROM @pages p WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey);
GO

-- ── Starting data ─────────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.LegalDistrict)
  INSERT INTO dbo.LegalDistrict (DistrictName, State) SELECT v.n, N'West Bengal' FROM (VALUES
    (N'Alipurduar'), (N'Bankura'), (N'Birbhum'), (N'Cooch Behar'), (N'Dakshin Dinajpur'), (N'Darjeeling'),
    (N'Hooghly'), (N'Howrah'), (N'Jalpaiguri'), (N'Jhargram'), (N'Kalimpong'), (N'Kolkata'), (N'Malda'),
    (N'Murshidabad'), (N'Nadia'), (N'North 24 Parganas'), (N'Paschim Bardhaman'), (N'Paschim Medinipur'),
    (N'Purba Bardhaman'), (N'Purba Medinipur'), (N'Purulia'), (N'South 24 Parganas'), (N'Uttar Dinajpur')
  ) v (n);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LegalLandType)
  INSERT INTO dbo.LegalLandType (LandTypeCode, LandTypeName, ConversionNeeded, Description) VALUES
    (N'SALI', N'Sali (agricultural, paddy)', 1, N'Low-lying cultivated land; conversion needed before building.'),
    (N'SUNA', N'Suna', 1, N'Agricultural land.'),
    (N'DANGA', N'Danga', 1, N'High land, usually dry cultivation.'),
    (N'BASTU', N'Bastu (homestead)', 0, N'Homestead / residential land.'),
    (N'DOBA', N'Doba', 1, N'Low land holding water.'),
    (N'PUKUR', N'Pukur (pond)', 1, N'Water body; filling is restricted.'),
    (N'BAGAN', N'Bagan (orchard)', 1, N'Orchard / garden land.'),
    (N'KHAMAR', N'Khamar', 1, N'Threshing floor / farm yard.'),
    (N'KARKHANA', N'Karkhana (industrial)', 0, N'Recorded for industrial use.'),
    (N'COMM', N'Commercial', 0, N'Recorded for commercial use.'),
    (N'OTHERS', N'Others', 1, N'Any other class as recorded.');
GO

PRINT '590-legal-location-party-land-masters applied successfully.';
GO
