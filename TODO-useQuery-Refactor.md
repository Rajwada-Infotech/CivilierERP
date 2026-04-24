# TODO: useQuery Refactor & staleTime Fix

## Step 1: CommandCenter.tsx
- [ ] Replace useEffect + useState with useQuery
- [ ] Add staleTime: 60_000 for dashboard query

## Step 2: Add staleTime to master-data useQuery blocks
- [ ] src/pages/masters/ItemMaster.tsx
- [ ] src/pages/masters/AccountGroupMaster.tsx
- [ ] src/pages/masters/BankMaster.tsx
- [ ] src/pages/masters/SupplierMaster.tsx
- [ ] src/pages/masters/CustomerMaster.tsx
- [ ] src/pages/masters/ContractorMaster.tsx
- [ ] src/pages/masters/HsnMaster.tsx
- [ ] src/pages/masters/FinancialYearMaster.tsx
- [ ] src/pages/masters/DebitNoteMaster.tsx
- [ ] src/pages/masters/TypeOfDocMaster.tsx
- [ ] src/pages/masters/RoleMaster.tsx
- [ ] src/pages/masters/ActivityMaster.tsx
- [ ] src/pages/masters/NamedEntryTypeMaster.tsx
- [ ] src/pages/masters/ChequeMaster.tsx
- [ ] src/pages/masters/CardMaster.tsx
- [ ] src/pages/masters/TdsMaster.tsx
- [ ] src/pages/masters/ExpensesMaster.tsx
- [ ] src/pages/masters/GeneralLedgerMaster.tsx
- [ ] src/pages/masters/ItemGroupMaster.tsx
- [ ] src/pages/material/UnitOfMeasurementMaster.tsx
- [ ] src/pages/material/T&CMaster.tsx
- [ ] src/pages/material/CardMaster.tsx
- [ ] src/pages/admin/masters/EnterpriseMaster.tsx
- [ ] src/contexts/TdsContext.tsx

## Step 3: Verification
- [ ] Run TypeScript check (`npx tsc --noEmit`)

