# Purchase Order Redesign - Multi-Item Support

## Task Overview
Redesign the Purchase Order page to support adding multiple items at a time, where each item has:
- Item Description/Name
- Unit (UOM)
- Quantity
- Price/Rate
- Amount (calculated: qty × price)

## Current State Analysis

### Backend (Updated ✓)
- `backend/routes/purchaseOrders.js` now supports `POItems` JSON column
- The column stores an array of items as JSON
- Each item in the array has the structure matching the frontend需求

### Frontend (Need Updates)
- `src/pages/material/PurchaseOrderMaster.tsx` - needs redesign for multi-item input
- `src/api/purchaseOrdersApi.ts` - may need updates for new payload structure
- `src/components/MasterPage.tsx` - likely needs custom handling for PO items

## Implementation Plan

### Phase 1: Data Model & API
1. Define the item structure:
```typescript
interface POItem {
  id?: string;           // for editing existing items
  itemDescription: string;
  unit: string;          // UOM name
  unitId?: number;       // UOM ID for API
  quantity: number;
  rate: number;
  amount: number;       // calculated: quantity * rate
}
```

2. Update `purchaseOrdersApi.ts` to pass POItems in payload

### Phase 2: Frontend Redesign

#### Option A: MasterPage Extension (Recommended)
- Add support for "child items" or "line items" in MasterPage
- Allow defining item fields that can be added as multiple rows
- Show a nested table for items within PO form

#### Option B: Custom PO Form
- Create custom form dialog for PO with inline item editor
- Similar to how WorkOrder handles activities
- More work but more control

### Phase 3: UI/UX Design

The new PO form should have:
1. Header fields (existing): PO No, Date, Supplier, Company, Project
2. **Items Section** (new): 
   - Table with columns: Item | Unit | Qty | Rate | Amount | Actions
   - "Add Item" button to add new row
   - Inline editing for each row
   - Delete button per row
3. Footer (existing): Payment Terms, Status, Remarks

### Phase 4: Migration (if needed)
- Create migration to add POItems column if not exists
- File: `backend/migrations/031-add-poitems-column.sql` (may already exist)

## Files to Modify

### Backend
- `backend/routes/purchaseOrders.js` ✓ (already done)
- `backend/migrations/031-add-poitems-column.sql` (check if exists)

### Frontend
- `src/pages/material/PurchaseOrderMaster.tsx` - main redesign
- `src/api/purchaseOrdersApi.ts` - payload updates
- `src/components/MasterPage.tsx` - may need child items support

## Dependencies
- UOM for unit dropdown (already available)
- Items list (from Item Master if available, or free-text)

## Testing
1. Create PO with single item (backward compatibility)
2. Create PO with multiple items
3. Edit existing PO items
4. Delete items from PO
5. Verify total calculation

## Notes
- The amount should auto-calculate: quantity × rate
- Total PO amount = sum of all item amounts
- Keep backward compatibility with old single-item POs
