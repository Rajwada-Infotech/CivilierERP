-- Migration 507: which HSN applies becomes DATA, not code.
--
-- GST was already half-dynamic. Rates live in dbo.HSN and crmGst.js reads them
-- through getHsnRate(), so changing a rate is a master edit. But WHICH HSN code
-- applies was hardcoded in crmGst.js, and so was the Rs 45 lakh threshold, as a
-- JavaScript constant. Two consequences:
--
--   * When the affordable-housing threshold moves — it has before — that is a
--     code change and a deploy, not a master edit.
--   * A villa built on land the CUSTOMER already owns is arguably a works
--     contract at a different rate entirely (see migration 506's business
--     model). Expressing that meant adding another branch in code.
--
-- This table makes the SELECTION data too, while the rate stays in HSN:
--
--     (what am I taxing, what is it worth, who owns the land)
--        -> highest-priority matching rule -> HsnCode -> rate from dbo.HSN
--
-- DELIBERATELY A SEPARATE TABLE, NOT COLUMNS ON dbo.HSN. HSN is a shared ERP
-- master used by purchases and materials as well as CRM; CRM-specific
-- applicability conditions do not belong in it, and a second module wanting
-- different conditions against the same HSN code would have nowhere to put them.
--
-- The seed below reproduces today's behaviour EXACTLY — same two Unit+Parking
-- bands at the same 45,00,000 boundary, same Extra Work rule — so this migration
-- changes no number anywhere. It only moves the decision somewhere editable.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmGstRule' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmGstRule (
    Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmGstRule PRIMARY KEY,
    Name                NVARCHAR(150) NOT NULL,

    -- What is being taxed. Matched exactly by the resolver, so a value it does
    -- not recognise simply finds no rule rather than mis-taxing something.
    --   'UNIT_PARKING'                  -- the unit + parking bracket
    --   'EXTRA_WORK'                    -- extra charges
    --   'CONSTRUCTION_ON_CUSTOMER_LAND' -- villa built on land already sold
    --   'RESALE_FEE'                    -- the developer's facilitation fee
    AppliesTo           NVARCHAR(40) NOT NULL,

    -- Which HSN row supplies the rate. The rate itself is NEVER stored here —
    -- it stays in dbo.HSN so there is exactly one place to change it.
    HsnCode             VARCHAR(20) NULL,

    -- Value band, replacing the hardcoded Rs 45,00,000 constant. NULL is
    -- unbounded on that side. Compared against the pre-tax value of whatever
    -- AppliesTo names.
    MinValue            DECIMAL(18,2) NULL,
    MaxValue            DECIMAL(18,2) NULL,

    -- Three-state on purpose: NULL means "this rule does not care", while 1/0
    -- require the land under the sale to be customer-owned / developer-owned.
    -- This is what lets the works-contract question be answered by a row
    -- instead of a code branch.
    LandOwnedByCustomer BIT NULL,

    -- Lower number wins. Lets a specific rule beat a general one without
    -- having to make the bands mutually exclusive.
    Priority            INT NOT NULL CONSTRAINT DF_CrmGstRule_Priority DEFAULT (100),
    IsActive            BIT NOT NULL CONSTRAINT DF_CrmGstRule_IsActive DEFAULT (1),
    Notes               NVARCHAR(500) NULL,

    CreatedBy           INT NULL,
    CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_CrmGstRule_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy           INT NULL,
    UpdatedAt           DATETIME2(0) NULL
  );
  CREATE NONCLUSTERED INDEX IX_CrmGstRule_Lookup ON dbo.CrmGstRule(AppliesTo, Priority) WHERE IsActive = 1;
  PRINT 'Migration 507: created dbo.CrmGstRule.';
END
ELSE
  PRINT 'Migration 507: dbo.CrmGstRule already exists — skipped.';
GO

-- Seed = today's hardcoded behaviour, moved into rows. Idempotent by Name.
INSERT INTO dbo.CrmGstRule (Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer, Priority, Notes)
SELECT v.Name, v.AppliesTo, v.HsnCode, v.MinValue, v.MaxValue, v.LandOwnedByCustomer, v.Priority, v.Notes
FROM (VALUES
  (N'Unit + Parking — affordable band',  'UNIT_PARKING', '9954AFH', CAST(NULL AS DECIMAL(18,2)), CAST(4500000 AS DECIMAL(18,2)), CAST(NULL AS BIT), 10,
   N'Was the <= Rs 45 lakh half of the hardcoded bracket. Edit MaxValue here if the threshold changes.'),
  (N'Unit + Parking — other residential','UNIT_PARKING', '9954OTH', CAST(4500000 AS DECIMAL(18,2)), CAST(NULL AS DECIMAL(18,2)), CAST(NULL AS BIT), 20,
   N'Was the > Rs 45 lakh half. MinValue is exclusive, matching the original <= test.'),
  (N'Extra Work / Extra Charges',        'EXTRA_WORK',   '9954EXW', CAST(NULL AS DECIMAL(18,2)), CAST(NULL AS DECIMAL(18,2)), CAST(NULL AS BIT), 10,
   N'Always applied, no band — unchanged from the hardcoded rule.')
) AS v(Name, AppliesTo, HsnCode, MinValue, MaxValue, LandOwnedByCustomer, Priority, Notes)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CrmGstRule r WHERE r.Name = v.Name);
GO

-- NOT SEEDED, DELIBERATELY: 'CONSTRUCTION_ON_CUSTOMER_LAND'.
-- Whether a villa built on land the customer already owns is construction of
-- residential property or a works contract depends on how the agreements are
-- drafted, and the two rates differ materially. Guessing here would silently
-- misprice every such villa, so no rule is seeded: until one is added the
-- resolver falls back to the ordinary UNIT_PARKING treatment, which is the
-- behaviour that exists today. Add the row once the finance team confirms.
DECLARE @Rules INT = (SELECT COUNT(*) FROM dbo.CrmGstRule WHERE IsActive = 1);
PRINT CONCAT('Migration 507 done. Active GST rules: ', @Rules,
             '. No CONSTRUCTION_ON_CUSTOMER_LAND rule seeded — add one when the works-contract treatment is confirmed.');
GO
