-- Migration 450: fix CrmBooking's identity seed, same corruption class
-- already fixed for CrmCustomer (migration 441) and 16 other tables
-- (migration 449's history / the 442 diagnostic).
--
-- CrmBooking's identity was reseeded to 0 by the same historical event as
-- the other tables. It had zero rows when migration 442's diagnostic was
-- first run (so it wasn't in that list) — the corruption only became
-- visible once the first real booking was created afterward and landed at
-- Id=0 (BKG-2026-00001), tripping every "Id > 0" / "!!bookingId" truthy
-- check across CrmBooking.tsx and CrmBookingDetail.tsx that assumed a
-- booking id of 0 could never be real (same bug class as migrations
-- 441-443, just on a table those didn't catch because it wasn't populated
-- yet). The app-level checks are already fixed to treat 0 as a valid id.
--
-- This migration does NOT touch the existing Id=0 row itself — unlike
-- CrmCustomer, CrmBooking is live financial data (Milestone/payment
-- records may already reference BookingId=0), so renumbering it would
-- need to cascade through every FK table, which is far riskier than the
-- app already correctly displaying it. It only reseeds the identity
-- counter forward so every booking created FROM NOW ON gets an
-- unambiguous positive id, instead of leaving the counter sitting at 0
-- where the next insert would land at 1 anyway but any future manual
-- DBCC action or restore could reopen the same ambiguity.
--
-- Guarded: only runs if CrmBooking's current identity is still <= 0 and
-- the known Id=0 row is the only one at/below 0 (matches what was found
-- live) — if production's state doesn't match that exactly, this is a
-- no-op rather than an incorrect blind reseed.
IF EXISTS (
  SELECT 1 FROM dbo.CrmBooking WHERE Id = 0
)
AND NOT EXISTS (
  SELECT 1 FROM dbo.CrmBooking WHERE Id < 0
)
AND IDENT_CURRENT('dbo.CrmBooking') <= 0
BEGIN
  DECLARE @maxId INT = (SELECT ISNULL(MAX(Id), 0) FROM dbo.CrmBooking);
  DBCC CHECKIDENT ('dbo.CrmBooking', RESEED, @maxId);
  PRINT 'Reseeded dbo.CrmBooking identity to ' + CAST(@maxId AS NVARCHAR(10)) + ' — next booking will be Id ' + CAST(@maxId + 1 AS NVARCHAR(10)) + '.';
END
ELSE
BEGIN
  PRINT 'dbo.CrmBooking identity state does not match the expected corrupted pattern — skipped as a no-op. If bookings still fail, check IDENT_CURRENT(''dbo.CrmBooking'') and MIN(Id) manually before reseeding.';
END
GO
