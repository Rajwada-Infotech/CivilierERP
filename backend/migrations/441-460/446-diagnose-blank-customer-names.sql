-- Migration 446: READ-ONLY diagnostic — find every CrmCustomer row still
-- missing a name, and every CrmApplication row whose ApplicantName/Mobile
-- disagree with the customer they're linked to.
--
-- Customer Name is still mandatory (unlike Mobile, which is now genuinely
-- optional by business decision — see migration 445) — the Customers form
-- and its API now both enforce this going forward (crmCustomers.js POST /,
-- CrmCustomers.tsx). This migration does NOT fix anything by itself: unlike
-- 441/443 (which had one safe, mechanical fix — reseed a corrupted identity
-- column), there is no single correct name to fill in for a customer with a
-- blank one. Each result here needs a human to actually look up and enter
-- the real name, the same careful way 441's design doc insisted on for any
-- ambiguous case.
--
-- SAFE: pure SELECT, no writes, nothing to roll back.

-- 1. Every active customer with a blank/whitespace-only name.
SELECT
  Id, CustomerNo, Mobile, Email, CreatedAt,
  'Customer has no name on file' AS Issue
FROM dbo.CrmCustomer
WHERE IsActive = 1
  AND (CustomerName IS NULL OR LTRIM(RTRIM(CustomerName)) = '')
ORDER BY CreatedAt DESC;

-- 2. Any CrmApplication whose linked Customer's canonical name/mobile has
-- since diverged from the copy stored on the Application at creation time
-- (e.g. the Customer was corrected later via Edit, or was corrupted and
-- later fixed by a migration, but this Application's own denormalized
-- ApplicantName/Mobile columns were never re-synced). Informational only —
-- decide case by case whether to update the Application's copy.
SELECT
  a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName AS AppName, a.Mobile AS AppMobile,
  c.Id AS CustomerId, c.CustomerNo, c.CustomerName AS CustName, c.Mobile AS CustMobile,
  'Application copy differs from its linked Customer record' AS Issue
FROM dbo.CrmApplication a
JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
WHERE a.IsActive = 1 AND c.IsActive = 1
  AND (
    ISNULL(a.ApplicantName, '') <> ISNULL(c.CustomerName, '')
    OR ISNULL(a.Mobile, '') <> ISNULL(c.Mobile, '')
  )
ORDER BY a.CreatedAt DESC;
GO
