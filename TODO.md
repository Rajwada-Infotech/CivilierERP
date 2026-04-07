# API Auth Headers Update Plan

## Status: In Progress

**Completed:** 4/16 files (Batch 1 ✅)

**Remaining Files (12 total):**
5. src/api/grnApi.ts
6. src/api/purchaseOrdersApi.ts
7. src/api/newPaymentApi.ts
8. src/api/itemGroupApi.ts
9. src/api/uomApi.ts
10. src/api/tenantApi.ts
11. src/api/dbaApi.ts
12. src/api/debitNoteApi.ts
13. src/api/documentTyoeApi.ts
14. src/api/userProfileApi.ts
15. src/api/workOrderApi.ts

**Batch Progress:**
- Batch 1 (4 files): Complete ✅
- Batch 2 (4 files): Pending  
- Batch 3 (4 files): Pending
- Batch 4 (3 files): Pending
5. ✅ src/api/grnApi.ts
6. ✅ src/api/purchaseOrdersApi.ts
7. ✅ src/api/newPaymentApi.ts
8. ✅ src/api/itemGroupApi.ts
9. ✅ src/api/uomApi.ts
10. ✅ src/api/tenantApi.ts
11. ✅ src/api/dbaApi.ts
12. ✅ src/api/debitNoteApi.ts
13. ✅ src/api/documentTyoeApi.ts
14. ✅ src/api/userProfileApi.ts
15. ✅ src/api/workOrderApi.ts

**Batch Progress:**
- Batch 1 (4 files): Pending
- Batch 2 (4 files): Pending  
- Batch 3 (4 files): Pending
- Batch 4 (4 files): Pending

**Next Steps:**
- Verify no lint errors
- Test API calls post-update
- User will provide final login test checklist

**Notes:** 
- All files get `getAuthHeaders()` helper after BASE_URL
- Add `headers: getAuthHeaders()` to ALL fetch calls (except userApi.ts login)
- Preserve exact error handling, types, signatures

