# ⚠️ IMPORTANT — seedExpenses.js

## What is this file?

`seedExpenses.js` is a **one-time database seed script** located in the `backend/` folder. It inserts 8 test `ExpenseBooking` records into `dbo.ExpenseBooking` in the **Civilier** SQL Server database.

These records are required for the **Debit Note Master** to function correctly. The bill dropdown in the Debit Note form is populated from `dbo.ExpenseBooking`, and the `FK_DN_Bill` foreign key constraint on `dbo.DebitNote.bill_id` enforces that every saved debit note must reference a real `Eid` from that table. Without these seed rows, saving any debit note will throw:

> _"The INSERT statement conflicted with the FOREIGN KEY constraint FK\_DN\_Bill"_

---

## When to run it

Run this script **once**, the first time you set up the project on a new machine or a fresh database. You do **not** need to run it again unless the `dbo.ExpenseBooking` table is wiped.

The script is safe to re-run — it checks the existing row count and skips insertion if seed data is already present.

---

## How to run it

From the project root, run:

```bash
cd backend
node seedExpenses.js
```

Expected output:

```
Connecting to: 192.168.0.201 / Civilier
Connected.

dbo.ExpenseBooking currently has 0 row(s).

Inserting 8 seed rows...

  ✓ Inserted INV-1001 — Prestige Heights          →  Eid = 1
  ✓ Inserted INV-1002 — Green Valley Phase 2       →  Eid = 2
  ✓ Inserted INV-1003 — Prestige Heights           →  Eid = 3
  ✓ Inserted INV-1004 — Riverside Residency        →  Eid = 4
  ✓ Inserted INV-1005 — Green Valley Phase 2       →  Eid = 5
  ✓ Inserted INV-1006 — Metro Commercial Hub       →  Eid = 6
  ✓ Inserted INV-1007 — Prestige Heights           →  Eid = 7
  ✓ Inserted INV-1008 — Riverside Residency        →  Eid = 8

✅ Seed complete. Restart your backend and the bill dropdown will populate.
```

After running, **restart the backend server** so the `/api/expense-booking/options` endpoint picks up the new rows.

---

## What it inserts

| Eid | Doc No   | Project                  | Type    | Amount      | Status   |
|-----|----------|--------------------------|---------|-------------|----------|
| 1   | INV-1001 | Prestige Heights         | Invoice | ₹45,000     | Pending  |
| 2   | INV-1002 | Green Valley Phase 2     | Invoice | ₹1,20,500   | Approved |
| 3   | INV-1003 | Prestige Heights         | Bill    | ₹2,85,000   | Pending  |
| 4   | INV-1004 | Riverside Residency      | Invoice | ₹67,250     | Approved |
| 5   | INV-1005 | Green Valley Phase 2     | Bill    | ₹98,750     | Pending  |
| 6   | INV-1006 | Metro Commercial Hub     | Invoice | ₹55,000     | Approved |
| 7   | INV-1007 | Prestige Heights         | Bill    | ₹35,000     | Pending  |
| 8   | INV-1008 | Riverside Residency      | Invoice | ₹42,000     | Approved |

---

## How to reset

If you need to wipe and re-seed, run the following SQL in SSMS **before** running the script again:

```sql
DELETE FROM dbo.DebitNote;
DELETE FROM dbo.ExpenseBooking;
```

> ⚠️ Delete `dbo.DebitNote` first — it holds a FK reference to `dbo.ExpenseBooking` and will block deletion if reversed.

---

## Production note

This script is for **testing and development only**. In production, `dbo.ExpenseBooking` will be populated through the **Expense Booking** module in the application. Once real data exists, this seed script is no longer needed and can be removed from the codebase.
