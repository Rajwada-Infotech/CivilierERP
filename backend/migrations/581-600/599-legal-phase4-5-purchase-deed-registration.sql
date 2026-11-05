-- 599 · Legal module, Phases 4 and 5 of the Legal & Land Management document v2.0
--   Phase 4 (Purchase & Sale): purchase / sale transactions, valuation & survey, agreements, buyer & seller
--     approvals, payments (each verified on its own) and expenses (kept apart from the land value).
--   Phase 5 (Deed & Registration): the land's deed, draft versions with a 12-point verification, stamp duty and
--     fee calculation, registration fee payments, appointments, registration attempts (failures kept as history)
--     and the registered deed with its approval.
-- These are the land pipeline's own records; the Deed Registration dossier screens are separate and unchanged.
-- Additive only.
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.LegalLandTransaction', 'U') IS NULL
  CREATE TABLE dbo.LegalLandTransaction (
    TransactionId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandTransaction PRIMARY KEY,
    TransactionNo NVARCHAR(30) NOT NULL CONSTRAINT UQ_LegalLandTransaction_No UNIQUE,
    LandId INT NOT NULL,
    TxnType NVARCHAR(10) NOT NULL CONSTRAINT CK_LegalLandTransaction_Type CHECK (TxnType IN (N'Purchase', N'Sale')),
    BuyerName NVARCHAR(200) NOT NULL,
    BuyerId INT NULL,
    SellerNames NVARCHAR(500) NOT NULL,
    TxnArea DECIMAL(18,6) NOT NULL,
    AreaUnitId INT NOT NULL,
    RatePerUnit DECIMAL(18,2) NULL,
    TotalValue DECIMAL(18,2) NOT NULL,
    AdvanceAmount DECIMAL(18,2) NULL,
    AgreementDate DATE NULL,
    ExpectedRegistrationDate DATE NULL,
    PaymentTerms NVARCHAR(1000) NULL,
    BrokerName NVARCHAR(200) NULL,
    BrokerCommission DECIMAL(18,2) NULL,
    AdvocateFees DECIMAL(18,2) NULL,
    OtherExpenses DECIMAL(18,2) NULL,
    AgreementFileId INT NULL,
    TxnStatus NVARCHAR(30) NOT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandTransaction_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandTransaction_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalLandTransaction_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandTransaction_BuyerId FOREIGN KEY (BuyerId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalLandTransaction_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalLandTransaction_AgreementFileId FOREIGN KEY (AgreementFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalPayment', 'U') IS NULL
  CREATE TABLE dbo.LegalPayment (
    PaymentId INT IDENTITY(1,1) CONSTRAINT PK_LegalPayment PRIMARY KEY,
    LandId INT NOT NULL,
    TransactionId INT NOT NULL,
    PaymentDate DATE NOT NULL,
    TxnTypeId INT NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,
    PaymentModeId INT NOT NULL,
    Payer NVARCHAR(200) NULL,
    Payee NVARCHAR(200) NULL,
    BankRef NVARCHAR(100) NULL,
    TransactionRef NVARCHAR(100) NULL,
    ReceiptNo NVARCHAR(60) NULL,
    ReceiptFileId INT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalPayment_VerificationStatus DEFAULT N'Pending',
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalPayment_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPayment_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalPayment_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalPayment_TransactionId FOREIGN KEY (TransactionId) REFERENCES dbo.LegalLandTransaction(TransactionId),
    CONSTRAINT FK_LegalPayment_TxnTypeId FOREIGN KEY (TxnTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalPayment_PaymentModeId FOREIGN KEY (PaymentModeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalPayment_ReceiptFileId FOREIGN KEY (ReceiptFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalExpense', 'U') IS NULL
  CREATE TABLE dbo.LegalExpense (
    ExpenseId INT IDENTITY(1,1) CONSTRAINT PK_LegalExpense PRIMARY KEY,
    LandId INT NOT NULL,
    TransactionId INT NULL,
    ExpenseTypeId INT NOT NULL,
    ExpenseDate DATE NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,
    PaidTo NVARCHAR(200) NULL,
    PaymentModeId INT NULL,
    ReceiptFileId INT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalExpense_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalExpense_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalExpense_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalExpense_TransactionId FOREIGN KEY (TransactionId) REFERENCES dbo.LegalLandTransaction(TransactionId),
    CONSTRAINT FK_LegalExpense_ExpenseTypeId FOREIGN KEY (ExpenseTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalExpense_PaymentModeId FOREIGN KEY (PaymentModeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalExpense_ReceiptFileId FOREIGN KEY (ReceiptFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalValuation', 'U') IS NULL
  CREATE TABLE dbo.LegalValuation (
    ValuationId INT IDENTITY(1,1) CONSTRAINT PK_LegalValuation PRIMARY KEY,
    LandId INT NOT NULL,
    ValuationDate DATE NOT NULL,
    LandArea DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    MarketRate DECIMAL(18,2) NULL,
    EstimatedMarketValue DECIMAL(18,2) NULL,
    GovernmentValuation DECIMAL(18,2) NULL,
    ValuationSource NVARCHAR(300) NOT NULL,
    ValuationFileId INT NULL,
    Surveyor NVARCHAR(200) NULL,
    SurveyDate DATE NULL,
    SurveyFileId INT NULL,
    GpsLatitude DECIMAL(10,7) NULL,
    GpsLongitude DECIMAL(10,7) NULL,
    BoundaryFindings NVARCHAR(1000) NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalValuation_VerificationStatus DEFAULT N'Pending',
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalValuation_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalValuation_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalValuation_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalValuation_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalValuation_ValuationFileId FOREIGN KEY (ValuationFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalValuation_SurveyFileId FOREIGN KEY (SurveyFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalAgreement', 'U') IS NULL
  CREATE TABLE dbo.LegalAgreement (
    AgreementId INT IDENTITY(1,1) CONSTRAINT PK_LegalAgreement PRIMARY KEY,
    AgreementNo NVARCHAR(30) NOT NULL CONSTRAINT UQ_LegalAgreement_No UNIQUE,
    LandId INT NOT NULL,
    TransactionId INT NOT NULL,
    AgreementType NVARCHAR(40) NOT NULL,
    AgreedArea DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    AgreedRate DECIMAL(18,2) NULL,
    TotalValue DECIMAL(18,2) NOT NULL,
    AdvanceAmount DECIMAL(18,2) NULL,
    PaymentSchedule NVARCHAR(1000) NULL,
    AgreementDate DATE NOT NULL,
    ExpectedRegistrationDate DATE NULL,
    ExpiryDate DATE NULL,
    Terms NVARCHAR(2000) NULL,
    BrokerDetails NVARCHAR(300) NULL,
    AdvocateId INT NULL,
    AgreementFileId INT NULL,
    BuyerSignature NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalAgreement_BuyerSig DEFAULT N'Pending',
    SellerSignature NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalAgreement_SellerSig DEFAULT N'Pending',
    AgreementStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalAgreement_AgreementStatus DEFAULT N'Draft',
    ApprovedBy INT NULL,
    ApprovedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalAgreement_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalAgreement_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalAgreement_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalAgreement_TransactionId FOREIGN KEY (TransactionId) REFERENCES dbo.LegalLandTransaction(TransactionId),
    CONSTRAINT FK_LegalAgreement_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalAgreement_AdvocateId FOREIGN KEY (AdvocateId) REFERENCES dbo.LegalAdvocate(AdvocateId),
    CONSTRAINT FK_LegalAgreement_AgreementFileId FOREIGN KEY (AgreementFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalPartyApproval', 'U') IS NULL
  CREATE TABLE dbo.LegalPartyApproval (
    ApprovalId INT IDENTITY(1,1) CONSTRAINT PK_LegalPartyApproval PRIMARY KEY,
    LandId INT NOT NULL,
    AgreementId INT NOT NULL,
    PartyName NVARCHAR(200) NOT NULL,
    PersonId INT NULL,
    PartyRole NVARCHAR(30) NOT NULL,
    OwnershipSharePct DECIMAL(7,4) NULL,
    ConsentStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalPartyApproval_ConsentStatus DEFAULT N'Pending',
    RecordedBy INT NULL,
    RecordedAt DATETIME2 NULL,
    ApprovalDate DATE NULL,
    SignatureFileId INT NULL,
    IdVerification NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalPartyApproval_IdVer DEFAULT N'Pending',
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalPartyApproval_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPartyApproval_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalPartyApproval UNIQUE (AgreementId, PartyName, PartyRole),
    CONSTRAINT FK_LegalPartyApproval_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalPartyApproval_AgreementId FOREIGN KEY (AgreementId) REFERENCES dbo.LegalAgreement(AgreementId),
    CONSTRAINT FK_LegalPartyApproval_PersonId FOREIGN KEY (PersonId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalPartyApproval_SignatureFileId FOREIGN KEY (SignatureFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalLandDeed', 'U') IS NULL
  CREATE TABLE dbo.LegalLandDeed (
    DeedId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandDeed PRIMARY KEY,
    DeedCode NVARCHAR(30) NOT NULL CONSTRAINT UQ_LegalLandDeed_Code UNIQUE,
    LandId INT NOT NULL,
    TransactionId INT NULL,
    DeedTypeId INT NOT NULL,
    LandDescription NVARCHAR(2000) NULL,
    ConsiderationAmount DECIMAL(18,2) NOT NULL,
    DeedWriter NVARCHAR(200) NULL,
    DeedWriterDueDate DATE NULL,
    AdvocateId INT NULL,
    RegistrationOfficeId INT NOT NULL,
    RegisteredDeedNo NVARCHAR(60) NULL,
    RegistrationStatus NVARCHAR(40) NOT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandDeed_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandDeed_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalLandDeed_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandDeed_TransactionId FOREIGN KEY (TransactionId) REFERENCES dbo.LegalLandTransaction(TransactionId),
    CONSTRAINT FK_LegalLandDeed_DeedTypeId FOREIGN KEY (DeedTypeId) REFERENCES dbo.LegalDeedType(DeedTypeId),
    CONSTRAINT FK_LegalLandDeed_AdvocateId FOREIGN KEY (AdvocateId) REFERENCES dbo.LegalAdvocate(AdvocateId),
    CONSTRAINT FK_LegalLandDeed_RegistrationOfficeId FOREIGN KEY (RegistrationOfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId)
  );
GO

IF OBJECT_ID('dbo.LegalDeedDraft', 'U') IS NULL
  CREATE TABLE dbo.LegalDeedDraft (
    DraftId INT IDENTITY(1,1) CONSTRAINT PK_LegalDeedDraft PRIMARY KEY,
    LandId INT NOT NULL,
    DeedId INT NOT NULL,
    VersionNo INT NOT NULL,
    DraftDate DATE NOT NULL,
    DraftFileId INT NOT NULL,
    ChangeNotes NVARCHAR(1000) NULL,
    ReviewStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalDeedDraft_ReviewStatus DEFAULT N'Pending',
    ReviewedBy INT NULL,
    ReviewedAt DATETIME2 NULL,
    ReviewRemarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalDeedDraft_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalDeedDraft_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalDeedDraft UNIQUE (DeedId, VersionNo),
    CONSTRAINT FK_LegalDeedDraft_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalDeedDraft_DeedId FOREIGN KEY (DeedId) REFERENCES dbo.LegalLandDeed(DeedId),
    CONSTRAINT FK_LegalDeedDraft_DraftFileId FOREIGN KEY (DraftFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalDeedDraftCheck', 'U') IS NULL
  CREATE TABLE dbo.LegalDeedDraftCheck (
    CheckId INT IDENTITY(1,1) CONSTRAINT PK_LegalDeedDraftCheck PRIMARY KEY,
    LandId INT NOT NULL,
    DraftId INT NOT NULL,
    CheckItem NVARCHAR(60) NOT NULL,
    Result NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalDeedDraftCheck_Result DEFAULT N'Pending',
    CheckedBy INT NULL,
    CheckedAt DATETIME2 NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalDeedDraftCheck_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalDeedDraftCheck_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalDeedDraftCheck UNIQUE (DraftId, CheckItem),
    CONSTRAINT FK_LegalDeedDraftCheck_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalDeedDraftCheck_DraftId FOREIGN KEY (DraftId) REFERENCES dbo.LegalDeedDraft(DraftId)
  );
GO

IF OBJECT_ID('dbo.LegalStampDuty', 'U') IS NULL
  CREATE TABLE dbo.LegalStampDuty (
    CalculationId INT IDENTITY(1,1) CONSTRAINT PK_LegalStampDuty PRIMARY KEY,
    LandId INT NOT NULL,
    DeedId INT NOT NULL,
    GovtMarketValue DECIMAL(18,2) NULL,
    ConsiderationValue DECIMAL(18,2) NULL,
    ValuationBasis NVARCHAR(300) NULL,
    StampDuty DECIMAL(18,2) NULL,
    RegistrationFee DECIMAL(18,2) NULL,
    ScanningFee DECIMAL(18,2) NULL,
    OtherCharges DECIMAL(18,2) NULL,
    TotalPayable DECIMAL(18,2) NOT NULL,
    CalculationDate DATE NOT NULL,
    CalculationSource NVARCHAR(300) NOT NULL,
    SupportingFileId INT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalStampDuty_VerificationStatus DEFAULT N'Pending',
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalStampDuty_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalStampDuty_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalStampDuty_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalStampDuty_DeedId FOREIGN KEY (DeedId) REFERENCES dbo.LegalLandDeed(DeedId),
    CONSTRAINT FK_LegalStampDuty_SupportingFileId FOREIGN KEY (SupportingFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalRegPayment', 'U') IS NULL
  CREATE TABLE dbo.LegalRegPayment (
    RegPaymentId INT IDENTITY(1,1) CONSTRAINT PK_LegalRegPayment PRIMARY KEY,
    LandId INT NOT NULL,
    DeedId INT NOT NULL,
    FeeTypeId INT NOT NULL,
    Amount DECIMAL(18,2) NOT NULL,
    PaymentDate DATE NOT NULL,
    PaymentRef NVARCHAR(100) NULL,
    ReceiptFileId INT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalRegPayment_VerificationStatus DEFAULT N'Pending',
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRegPayment_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRegPayment_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalRegPayment_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalRegPayment_DeedId FOREIGN KEY (DeedId) REFERENCES dbo.LegalLandDeed(DeedId),
    CONSTRAINT FK_LegalRegPayment_FeeTypeId FOREIGN KEY (FeeTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalRegPayment_ReceiptFileId FOREIGN KEY (ReceiptFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalRegAppointment', 'U') IS NULL
  CREATE TABLE dbo.LegalRegAppointment (
    AppointmentId INT IDENTITY(1,1) CONSTRAINT PK_LegalRegAppointment PRIMARY KEY,
    LandId INT NOT NULL,
    DeedId INT NOT NULL,
    RegistrationOfficeId INT NOT NULL,
    AppointmentDate DATE NOT NULL,
    AppointmentTime NVARCHAR(10) NULL,
    TokenNo NVARCHAR(60) NULL,
    BuyerAttendance NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalRegAppointment_Buyer DEFAULT N'Pending',
    SellerAttendance NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalRegAppointment_Seller DEFAULT N'Pending',
    WitnessDetails NVARCHAR(1000) NULL,
    AppointmentStatus NVARCHAR(20) NOT NULL,
    SlipFileId INT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRegAppointment_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRegAppointment_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalRegAppointment_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalRegAppointment_DeedId FOREIGN KEY (DeedId) REFERENCES dbo.LegalLandDeed(DeedId),
    CONSTRAINT FK_LegalRegAppointment_RegistrationOfficeId FOREIGN KEY (RegistrationOfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
    CONSTRAINT FK_LegalRegAppointment_SlipFileId FOREIGN KEY (SlipFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalRegAttempt', 'U') IS NULL
  CREATE TABLE dbo.LegalRegAttempt (
    AttemptId INT IDENTITY(1,1) CONSTRAINT PK_LegalRegAttempt PRIMARY KEY,
    LandId INT NOT NULL,
    DeedId INT NOT NULL,
    AppointmentId INT NULL,
    AttemptDate DATE NOT NULL,
    Result NVARCHAR(30) NOT NULL,
    RegisteredDeedNo NVARCHAR(60) NULL,
    FailureReason NVARCHAR(1000) NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRegAttempt_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRegAttempt_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalRegAttempt_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalRegAttempt_DeedId FOREIGN KEY (DeedId) REFERENCES dbo.LegalLandDeed(DeedId),
    CONSTRAINT FK_LegalRegAttempt_AppointmentId FOREIGN KEY (AppointmentId) REFERENCES dbo.LegalRegAppointment(AppointmentId)
  );
GO

IF OBJECT_ID('dbo.LegalRegisteredDeed', 'U') IS NULL
  CREATE TABLE dbo.LegalRegisteredDeed (
    RegisteredId INT IDENTITY(1,1) CONSTRAINT PK_LegalRegisteredDeed PRIMARY KEY,
    LandId INT NOT NULL,
    DeedId INT NOT NULL,
    RegisteredDeedNo NVARCHAR(60) NOT NULL,
    RegistrationDate DATE NOT NULL,
    RegistrationOfficeId INT NULL,
    DeedFileId INT NOT NULL,
    ReceiptFileId INT NULL,
    CertifiedCopyStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalRegisteredDeed_Copy DEFAULT N'Not Applied',
    ApprovalStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalRegisteredDeed_ApprovalStatus DEFAULT N'Pending',
    ApprovedBy INT NULL,
    ApprovedAt DATETIME2 NULL,
    ApprovalRemarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRegisteredDeed_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRegisteredDeed_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalRegisteredDeed_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalRegisteredDeed_DeedId FOREIGN KEY (DeedId) REFERENCES dbo.LegalLandDeed(DeedId),
    CONSTRAINT FK_LegalRegisteredDeed_RegistrationOfficeId FOREIGN KEY (RegistrationOfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
    CONSTRAINT FK_LegalRegisteredDeed_DeedFileId FOREIGN KEY (DeedFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalRegisteredDeed_ReceiptFileId FOREIGN KEY (ReceiptFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

DECLARE @t TABLE (n SYSNAME);
INSERT INTO @t VALUES ('LegalLandTransaction'), ('LegalPayment'), ('LegalExpense'), ('LegalValuation'), ('LegalAgreement'), ('LegalPartyApproval'),
  ('LegalLandDeed'), ('LegalDeedDraft'), ('LegalDeedDraftCheck'), ('LegalStampDuty'), ('LegalRegPayment'), ('LegalRegAppointment'), ('LegalRegAttempt'), ('LegalRegisteredDeed');
DECLARE @n SYSNAME, @sql NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT n FROM @t;
OPEN c; FETCH NEXT FROM c INTO @n;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_' + @n + '_Land')
  BEGIN
    SET @sql = N'CREATE INDEX ' + QUOTENAME('IX_' + @n + '_Land') + N' ON dbo.' + QUOTENAME(@n) + N' (LandId)';
    EXEC sp_executesql @sql;
  END;
  FETCH NEXT FROM c INTO @n;
END;
CLOSE c; DEALLOCATE c;
GO

PRINT '599-legal-phase4-5-purchase-deed-registration applied successfully.';
GO
