# Seed data

One-off test/demo data scripts — TDS Master rows, flagged test suppliers/contractors,
Vendor Payment Terms — used to exercise TDS posting during development. These are
**not** part of the live migration chain: `migrate.js` only globs `backend/migrations/`,
so files here are never auto-applied and are not tracked in the `SchemaMigrations`
table lookup path. They're kept for reference and can be re-run manually
(`sqlcmd` / the same runner query-by-query) against a fresh dev database if needed.

- `308-seed-tds-test-data.sql` — TDS Master sections (194C/194J/194I/194H/194Q) +
  flags a handful of contractors/suppliers as TDS-applicable for testing.
- `309-seed-payment-plan-master.sql` — seeded the wrong table (`PaymentTermMaster`,
  the CRM/Follow-Up milestone-plan table) by mistake; kept only alongside its revert
  for the record.
- `310-revert-payment-plan-master-seed.sql` — reverts 309.
- `311-seed-vendor-payment-term.sql` — the correct seed, for `VendorPaymentTerm`
  (PO/Invoice payment terms, e.g. "Net 30 Days").
