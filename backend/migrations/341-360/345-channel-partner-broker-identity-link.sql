-- Bridge Sales Automation channel partners to CRM Broker Master identity.
-- The CRM broker remains dbo.AccountHeadMaster(LHeadType='BR'); SaChannelPartner
-- stores the FK so lead -> application -> booking can carry one identity.

IF COL_LENGTH('dbo.SaChannelPartner', 'CrmBrokerLHeadId') IS NULL
  ALTER TABLE dbo.SaChannelPartner ADD CrmBrokerLHeadId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SaChannelPartner_CrmBroker'
)
BEGIN
  ALTER TABLE dbo.SaChannelPartner
  ADD CONSTRAINT FK_SaChannelPartner_CrmBroker
    FOREIGN KEY (CrmBrokerLHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.SaChannelPartner')
    AND name = 'UX_SaChannelPartner_CrmBrokerLHeadId'
)
BEGIN
  CREATE UNIQUE INDEX UX_SaChannelPartner_CrmBrokerLHeadId
    ON dbo.SaChannelPartner(CrmBrokerLHeadId)
    WHERE CrmBrokerLHeadId IS NOT NULL;
END;
GO

DECLARE @SundryCreditorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SCS');
DECLARE @CpId INT, @PartnerCode NVARCHAR(20), @Name NVARCHAR(200), @Mobile NVARCHAR(20),
        @Email NVARCHAR(200), @FirmName NVARCHAR(200), @Region NVARCHAR(200),
        @BrokerId INT, @BrokerCode NVARCHAR(20);

DECLARE cp_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT Id, PartnerCode, Name, Mobile, Email, FirmName, Region
  FROM dbo.SaChannelPartner
  WHERE IsActive = 1 AND CrmBrokerLHeadId IS NULL;

OPEN cp_cursor;
FETCH NEXT FROM cp_cursor INTO @CpId, @PartnerCode, @Name, @Mobile, @Email, @FirmName, @Region;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @BrokerId = NULL;
  SET @BrokerCode = CONCAT('SACP-', @CpId);

  SELECT TOP 1 @BrokerId = LHeadId
  FROM dbo.AccountHeadMaster
  WHERE LHeadType = 'BR'
    AND (
      LHeadCode = @BrokerCode
      OR (@Mobile IS NOT NULL AND LHeadPhone = LEFT(@Mobile, 15))
      OR (@Email IS NOT NULL AND LOWER(LTRIM(RTRIM(LHeadEmail))) = LOWER(LTRIM(RTRIM(LEFT(@Email, 100)))))
    )
  ORDER BY CASE WHEN LHeadCode = @BrokerCode THEN 0 ELSE 1 END, LHeadId;

  IF @BrokerId IS NULL
  BEGIN
    INSERT INTO dbo.AccountHeadMaster
      (LHeadName, LHeadCode, LHeadType, LHeadPhone, LHeadEmail,
       LHeadAddress, LHeadContactPerson, LHeadStatus, LHeadPaymentTerms,
       LCountry, LBelongsTo, LDescription, Status, CreatedBy, CreatedAt)
    VALUES
      (ISNULL(NULLIF(LTRIM(RTRIM(@Name)), ''), 'Channel Partner'), @BrokerCode, 'BR',
       LEFT(NULLIF(LTRIM(RTRIM(@Mobile)), ''), 15),
       LEFT(NULLIF(LTRIM(RTRIM(@Email)), ''), 100),
       ISNULL(NULLIF(LTRIM(RTRIM(@Region)), ''), 'N/A'),
       ISNULL(NULLIF(LTRIM(RTRIM(@FirmName)), ''), ISNULL(NULLIF(LTRIM(RTRIM(@Name)), ''), 'N/A')),
       1, 'N/A', 'India', @SundryCreditorsId,
       CONCAT('Auto-created from Sales Automation channel partner ', ISNULL(@PartnerCode, CAST(@CpId AS NVARCHAR(20)))),
       'Approved', 'migration-345', SYSDATETIME());

    SET @BrokerId = SCOPE_IDENTITY();
  END;

  UPDATE dbo.SaChannelPartner
  SET CrmBrokerLHeadId = @BrokerId,
      UpdatedAt = SYSDATETIME()
  WHERE Id = @CpId;

  FETCH NEXT FROM cp_cursor INTO @CpId, @PartnerCode, @Name, @Mobile, @Email, @FirmName, @Region;
END;

CLOSE cp_cursor;
DEALLOCATE cp_cursor;
GO
