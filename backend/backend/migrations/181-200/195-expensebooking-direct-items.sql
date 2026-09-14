-- Adds EDirectItemsData to ExpenseBooking for storing line-item details on
-- direct (Other Expenses / TOD) bookings where no PO, WO, GRN or Work Done
-- document is linked.  The column stores a JSON array of
--   { description, qty, uom, rate, amount }
-- objects serialised by the frontend.  The total of these items automatically
-- populates EAmount/ENetAmount so the existing amount columns remain the
-- authoritative figures for reporting and payment calculations.
ALTER TABLE dbo.ExpenseBooking
  ADD EDirectItemsData NVARCHAR(MAX) NULL;
