-- Migration 254: CrmCustomerPortalUser — switch from ApplicationId-keyed to
-- CustomerId-keyed identity, enabling multi-application portal support.
--
-- Rationale:
--   • CustomerId UNIQUE: one portal account per real customer (mobile is the
--     canonical identity key in CrmCustomer, which already has UQ_CrmCustomer_Mobile).
--   • ApplicationId becomes nullable: the portal now receives applicationId
--     as a request-scoped parameter, not baked into the portal user row.
--     The column is kept (nullable) so existing SQL tooling referencing it
--     doesn't break hard; crmPortalProvision.js no longer writes it.
--   • UQ on ApplicationId dropped: was the mechanism that forced the
--     "repoint to newest app" hack in ensurePortalUser(); no longer needed.
--   • UQ on portal Email dropped: portal identity is CustomerId, not Email.
--     Email may still be used as the login credential, but its uniqueness is
--     enforced on dbo.CrmCustomer by migration 255.
--
-- Zero rows in CrmCustomerPortalUser at migration time — no data migration needed.

-- 1. Drop the old UQ on ApplicationId
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomerPortalUser')
    AND name = 'UQ__CrmCusto__C93A4C9840BE0C66'
)
BEGIN
  ALTER TABLE dbo.CrmCustomerPortalUser
    DROP CONSTRAINT UQ__CrmCusto__C93A4C9840BE0C66;
  PRINT 'Dropped UQ on CrmCustomerPortalUser.ApplicationId';
END
ELSE
BEGIN
  PRINT 'UQ on CrmCustomerPortalUser.ApplicationId already absent — skipped';
END

-- 2. Drop the old UQ on Email
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomerPortalUser')
    AND name = 'UQ__CrmCusto__A9D105348A9B2647'
)
BEGIN
  ALTER TABLE dbo.CrmCustomerPortalUser
    DROP CONSTRAINT UQ__CrmCusto__A9D105348A9B2647;
  PRINT 'Dropped UQ on CrmCustomerPortalUser.Email';
END
ELSE
BEGIN
  PRINT 'UQ on CrmCustomerPortalUser.Email already absent — skipped';
END

-- 3. Make ApplicationId nullable (was NOT NULL, no longer the primary anchor)
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CrmCustomerPortalUser'
    AND COLUMN_NAME = 'ApplicationId' AND IS_NULLABLE = 'NO'
)
BEGIN
  ALTER TABLE dbo.CrmCustomerPortalUser
    ALTER COLUMN ApplicationId INT NULL;
  PRINT 'Made CrmCustomerPortalUser.ApplicationId nullable';
END
ELSE
BEGIN
  PRINT 'CrmCustomerPortalUser.ApplicationId already nullable — skipped';
END

-- 4. Add CustomerId column (NOT NULL — zero rows, safe to add without default)
IF COL_LENGTH('dbo.CrmCustomerPortalUser', 'CustomerId') IS NULL
BEGIN
  ALTER TABLE dbo.CrmCustomerPortalUser
    ADD CustomerId INT NOT NULL DEFAULT 0;  -- default only for ALTER syntax; overridden immediately below
  -- Remove the default constraint (we don't want a permanent DEFAULT 0)
  DECLARE @dfName NVARCHAR(200);
  SELECT @dfName = dc.name
  FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmCustomerPortalUser')
    AND c.name = 'CustomerId';
  IF @dfName IS NOT NULL
    EXEC('ALTER TABLE dbo.CrmCustomerPortalUser DROP CONSTRAINT ' + @dfName);
  PRINT 'Added CrmCustomerPortalUser.CustomerId';
END
ELSE
BEGIN
  PRINT 'CrmCustomerPortalUser.CustomerId already exists — skipped';
END

-- 5. Add FK CustomerId → CrmCustomer.Id
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID('dbo.CrmCustomerPortalUser')
    AND name = 'FK_CrmCustomerPortalUser_Customer'
)
BEGIN
  ALTER TABLE dbo.CrmCustomerPortalUser
    ADD CONSTRAINT FK_CrmCustomerPortalUser_Customer
      FOREIGN KEY (CustomerId) REFERENCES dbo.CrmCustomer(Id);
  PRINT 'Added FK_CrmCustomerPortalUser_Customer';
END
ELSE
BEGIN
  PRINT 'FK_CrmCustomerPortalUser_Customer already exists — skipped';
END

-- 6. Add UQ on CustomerId — one portal account per real customer
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CrmCustomerPortalUser')
    AND name = 'UQ_CrmCustomerPortalUser_CustomerId'
)
BEGIN
  ALTER TABLE dbo.CrmCustomerPortalUser
    ADD CONSTRAINT UQ_CrmCustomerPortalUser_CustomerId UNIQUE (CustomerId);
  PRINT 'Added UQ_CrmCustomerPortalUser_CustomerId';
END
ELSE
BEGIN
  PRINT 'UQ_CrmCustomerPortalUser_CustomerId already exists — skipped';
END
