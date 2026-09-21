# Production Verification Checklist for Migration 448

Migration file:

- `backend/migrations/441-460/448-fix-crm-bank-detail-bookingid-unique-constraint.sql`

Bug being fixed:

- Production is rejecting `PUT /api/crm/customer-bank-details/application/:applicationId` with:
  `Violation of UNIQUE KEY constraint 'UQ__CrmCusto__73951AECF85291CA'. Cannot insert duplicate key in object 'dbo.CrmCustomerBankDetail'. The duplicate key value is (<NULL>).`
- The `<NULL>` duplicate key means the old unfiltered `UNIQUE` constraint on `BookingId` is still active in production. Application-stage bank/KYC rows intentionally have `BookingId = NULL`, so that old constraint must be replaced by the filtered unique index `WHERE BookingId IS NOT NULL`.

## Before Running Migration 448

Run these read-only SQL checks directly on the production database.

### 1. Confirm the leftover constraint

```sql
SELECT kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id
 AND ic.index_id = kc.unique_index_id
JOIN sys.columns c
  ON c.object_id = ic.object_id
 AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
  AND kc.[type] = 'UQ'
  AND c.name = 'BookingId'
  AND NOT EXISTS (
    SELECT 1
    FROM sys.index_columns ic2
    WHERE ic2.object_id = ic.object_id
      AND ic2.index_id = ic.index_id
      AND ic2.column_id <> ic.column_id
  );
```

Expected result:

```text
UQ__CrmCusto__73951AECF85291CA
```

A different single-column `BookingId` unique constraint name is still consistent with the same bug, but paste the result back before deployment. Zero rows means production may not match the reported error anymore; stop and re-check before running migration `448`.

### 2. Confirm there are no existing BookingId duplicates

```sql
SELECT BookingId, COUNT(*)
FROM dbo.CrmCustomerBankDetail
WHERE BookingId IS NOT NULL
GROUP BY BookingId
HAVING COUNT(*) > 1;
```

Expected result: zero rows.

### 3. Confirm there are no existing ApplicationId duplicates

```sql
SELECT ApplicationId, COUNT(*)
FROM dbo.CrmCustomerBankDetail
WHERE ApplicationId IS NOT NULL
GROUP BY ApplicationId
HAVING COUNT(*) > 1;
```

Expected result: zero rows.

## Stop Conditions

Do not run migration `448` yet if any of these happen:

- The confirmation query returns no rows.
- The confirmation query returns a constraint that is not a single-column `BookingId` unique constraint.
- Either duplicate-check query returns rows.

Paste the exact query output back into the task/PR so the migration can be adjusted before touching production.

## Code Path Cross-Check

The Booking conversion path was checked in `backend/services/crmEntityCreation.js`.

- `createCrmBookingRecord` does not insert a second `CrmCustomerBankDetail` row after booking creation.
- It backfills the existing Application-stage row only:

```sql
UPDATE dbo.CrmCustomerBankDetail
SET BookingId = @bid
WHERE ApplicationId = @aid
  AND BookingId IS NULL;
```

- That backfill runs inside the same Booking creation transaction that begins before the `CrmBooking` insert.
- The existing Application guard and the filtered `UX_CrmCustomerBankDetail_ApplicationId` index mean there should be one bank-detail row per Application to backfill.

## If All Checks Pass

Deploy through the normal CivilierERP production path:

1. Run the GitHub Actions `CI` workflow manually for the target branch.
2. Download the `civilier-source-...` artifact from the completed workflow run.
3. Copy the artifact to the production EC2 box.
4. Run:

```bash
bash /opt/civilier/scripts/deploy-from-artifact.sh /path/to/civilier-source-*.zip
```

That script runs:

```bash
docker compose run --rm backend npm run migrate
```

After deployment, confirm against the production database:

```bash
docker compose run --rm backend npm run migrate:status
```

Expected result: `Pending (0)`.

## After Migration 448 Applies

Verify the resulting index state directly on production:

```sql
SELECT i.name, i.is_unique, i.filter_definition
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
  AND i.name IN (
    'UX_CrmCustomerBankDetail_BookingId',
    'UX_CrmCustomerBankDetail_ApplicationId'
  );
```

Expected result:

- `UX_CrmCustomerBankDetail_BookingId`, `is_unique = 1`, filter `([BookingId] IS NOT NULL)`
- `UX_CrmCustomerBankDetail_ApplicationId`, `is_unique = 1`, filter `([ApplicationId] IS NOT NULL)`

Also confirm the old generated unique constraint is gone:

```sql
SELECT *
FROM sys.key_constraints
WHERE parent_object_id = OBJECT_ID('dbo.CrmCustomerBankDetail')
  AND [type] = 'UQ';
```

Expected result: no leftover single-column `BookingId` `UQ__...` constraint.

## Post-Deploy Smoke Test

Run these checks on production itself, not staging or local:

1. Retry the failed CRM application Bank/KYC save for the application that previously produced the duplicate error. The save should no longer fail with:

```text
duplicate key value is (<NULL>)
```

2. Create a second brand-new Application for an existing customer with pre-filled KYC, reach the Bank/KYC step, and save. It must succeed.
3. Create a third concurrently in-progress Application for the same existing customer, leave both Applications unsubmitted, and confirm both can independently save Bank/KYC without colliding.
4. Open an existing Booking's Bank Details tab for a booking that already had KYC before migration `448`, then re-save it. It must update the existing row without throwing or creating a duplicate.
5. Check production logs for new 500s on `crm-customer-bank-details` routes immediately after deploy. The route logs caught errors with prefixes such as:

```text
[crm-customer-bank-details] PUT error:
[crm-customer-bank-details] PUT /application error:
```

Tail whatever log stream is active on the EC2 deployment (`docker compose logs`, CloudWatch, or the production log aggregator) for the deployment and smoke-test window.
