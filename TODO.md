# GRN Database Integration - Approved Plan Implementation

Status: ✅ Plan approved by user. Fixes: dynamic items from item-master, units from uom-master, ItemID type fix.

## Steps (Step 1/4 Complete after this)

### ✅ Step 0: Analysis Complete
- Files analyzed: GRN.tsx, grnApi.ts, grns.js, migration, APIs, routes.
- Integrations confirmed: Supplier (AccountHeadMaster), PO (PurchaseOrders), Item (fix to ItemMaster), Unit (UOM).

### ⏳ Step 1: Update src/api/grnApi.ts
- Change getItems → /api/item-master
- Add getUoms → /api/uom-master
- Update interfaces: Item (M_Id/M_Name), GRNItemLine (+uom)

### ⏳ Step 2: Update src/pages/material/GRN.tsx
- Items dropdown: use itemMaster M_Id/M_Name
- Per-item UOM dropdown from uoms
- Remove hardcoded units
- Form sends uom per item

### ⏳ Step 3: Update backend/routes/grns.js  
- Handle uom in GRNItems JSON (auto)
- StockLedger ItemID: sql.NVarChar(50) for UUID
- Add UOM to StockLedger insert

### ⏳ Step 4: Test & Complete
- npm run dev
- Navigate /material/grn
- Verify dropdowns from DB, submit GRN → DB insert
- attempt_completion

**Notes:** 
- ItemMaster uses UUID M_Id → StockLedger.ItemID change to NVARCHAR(50)
- DB may need ALTER TABLE StockLedger ALTER COLUMN ItemID NVARCHAR(50)

