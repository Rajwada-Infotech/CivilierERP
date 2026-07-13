-- Unified Unit + Parking "hold" engine: a customer can ask staff to hold a
-- unit or parking slot for N days without booking it yet. While Active, the
-- matrix must show it as OnHold (never Available, never bookable by anyone
-- else). Once HoldUntil passes without a booking/allotment being created,
-- it auto-reverts to Available. One table covers both entity types so a
-- single registry-driven engine (crmSlaEngine.js) can expire/remind for both.

CREATE TABLE dbo.CrmInventoryHold (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  EntityType    NVARCHAR(20)   NOT NULL CHECK (EntityType IN ('Unit', 'Parking')),
  EntityId      INT            NOT NULL,
  ApplicationId INT            NOT NULL REFERENCES dbo.CrmApplication(Id),
  HoldDays      INT            NOT NULL,
  HoldUntil     DATETIME2(3)   NOT NULL,
  Reason        NVARCHAR(500)  NULL,
  Status        NVARCHAR(20)   NOT NULL DEFAULT 'Active' CHECK (Status IN ('Active', 'Released', 'Expired', 'Converted')),
  CreatedBy     INT            NULL,
  CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
  ReleasedBy    INT            NULL,
  ReleasedAt    DATETIME2(3)   NULL
);
GO

-- Only one Active hold can exist per entity at a time.
CREATE UNIQUE INDEX UQ_CrmInventoryHold_ActiveEntity
  ON dbo.CrmInventoryHold(EntityType, EntityId)
  WHERE Status = 'Active';
GO

CREATE INDEX IX_CrmInventoryHold_Application ON dbo.CrmInventoryHold(ApplicationId);
GO
