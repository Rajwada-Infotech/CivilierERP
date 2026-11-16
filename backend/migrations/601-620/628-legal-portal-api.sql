-- 628: an API connection per Government Site Link (Setup → Government Site Links), set in Admin → API Integration.
-- Land Enquiry / Land page call it through the server ("Fetch from <site>"). Schema only.
IF OBJECT_ID(N'dbo.LegalPortalApi', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalPortalApi (
    LinkId INT NOT NULL CONSTRAINT PK_LegalPortalApi PRIMARY KEY
      CONSTRAINT FK_LegalPortalApi_Link REFERENCES dbo.LegalPortalLink (LinkId) ON DELETE CASCADE,
    IsEnabled BIT NOT NULL CONSTRAINT DF_LegalPortalApi_IsEnabled DEFAULT 0,
    Method NVARCHAR(10) NOT NULL CONSTRAINT DF_LegalPortalApi_Method DEFAULT N'GET',
    UrlTemplate NVARCHAR(1000) NOT NULL,           -- https://…/ror?district={district}&mouza={mouza}&dag={dag}
    AuthType NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalPortalApi_AuthType DEFAULT N'None', -- None | Header | Bearer | Basic
    AuthHeader NVARCHAR(100) NULL,                 -- header name for AuthType = Header (e.g. x-api-key)
    Username NVARCHAR(200) NULL,                   -- Basic
    Secret NVARCHAR(1000) NULL,                    -- key / token / password; never sent back to the browser
    BodyTemplate NVARCHAR(4000) NULL,              -- JSON body for POST, same {placeholders}
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPortalApi_UpdatedAt DEFAULT SYSUTCDATETIME()
  );
END
