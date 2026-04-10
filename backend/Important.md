# Operational Notes

## Expense Booking and Debit Note dependency

The Debit Note flow depends on valid records in `dbo.ExpenseBooking`. The bill selector and related foreign key constraints require each saved debit note to reference an existing expense booking record.

If `dbo.ExpenseBooking` is empty, users must first create records through the application’s **Expense Booking** workflow before creating debit notes.

## Setup guidance

For a new environment:

1. Confirm the database schema is applied correctly.
2. Start the backend with the correct database configuration.
3. Create required master and transactional records through the application UI.
4. Verify the relevant API endpoints return live database data before user onboarding.

## Operational caution

Avoid relying on hardcoded or seed business data in shared, staging, or production environments. Business records such as expense bookings should be created through the supported application flows so downstream modules continue to work with real data.

## If Debit Note save fails due to missing bill references

If the database reports a foreign key conflict related to debit note bill references:

1. Check whether the selected bill exists in `dbo.ExpenseBooking`.
2. Confirm the record was created successfully and is available to the backend.
3. Verify the API used by the Debit Note form is reading from the intended database.
4. Re-test after correcting the source data.

## Data reset caution

Do not delete transactional tables directly in active environments unless the reset is planned and approved. If a non-production database must be reset, handle dependent tables in the correct order and take a backup first.