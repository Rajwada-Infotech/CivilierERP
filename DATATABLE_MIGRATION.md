# DataTable Migration Guide

## Setup

```bash
npm install @tanstack/react-table@^8.21.0
```

Copy `src/components/ui/DataTable.tsx` into your project. Done.

---

## The pattern in 4 steps

BankMaster is the reference. Every other page follows the same 4 steps.

### 1. Import DataTable and ColumnDef

```tsx
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
```

### 2. Define columns outside the component

Move your `<thead>` headers + `<td>` cell renderers into a `ColumnDef[]` array.
Define it as a function when it needs access to state (edit/delete handlers):

```tsx
function buildColumns(
  editingId: string | null,
  onEdit: (row: MyRow) => void,
  onDelete: (id: string) => void,
): ColumnDef<MyRow, unknown>[] {
  return [
    {
      accessorKey: "Name",           // maps to row.Name
      header: "Name",
      cell: ({ getValue }) => <span>{getValue() as string}</span>,
    },
    {
      accessorKey: "Status",
      header: "Status",
      cell: ({ getValue }) => (
        <StatusBadge active={Boolean(getValue())} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <ActionButtons
          onEdit={() => onEdit(row.original)}
          onDelete={() => onDelete(String(row.original.Id))}
        />
      ),
    },
  ];
}
```

### 3. Memoize columns in the component

```tsx
const columns = useMemo(
  () => buildColumns(editingId, handleEdit, handleDelete),
  [editingId], // only rebuild when the deps that affect column rendering change
);
```

### 4. Replace the `<table>` block with `<DataTable>`

**Before:**
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-border bg-muted/30">
        {["Name", "Status", "Actions"].map((h) => (
          <th key={h} className="px-4 py-3 text-left text-[10px] ...">{h}</th>
        ))}
      </tr>
    </thead>
    <tbody className="divide-y divide-border">
      {filtered.length === 0 ? (
        <tr><td colSpan={3}>No records.</td></tr>
      ) : (
        filtered.map((row) => (
          <tr key={row.Id} className="hover:bg-muted/20 ...">
            <td className="px-4 py-3">{row.Name}</td>
            ...
          </tr>
        ))
      )}
    </tbody>
  </table>
</div>
```

**After:**
```tsx
<DataTable
  data={dbData}
  columns={columns}
  loading={isLoading}
  searchPlaceholder="Search..."
  emptyMessage="No records yet. Add one above."
/>
```

Delete the `const [search, setSearch] = useState("")` and the `.filter()` call —
DataTable handles global search internally.

---

## Props reference

| Prop | Type | Default | Notes |
|---|---|---|---|
| `data` | `TData[]` | required | Raw data array from your query |
| `columns` | `ColumnDef<TData>[]` | required | Column definitions |
| `loading` | `boolean` | `false` | Shows skeleton rows |
| `searchable` | `boolean` | `true` | Show built-in search bar |
| `searchPlaceholder` | `string` | `"Search..."` | |
| `paginated` | `boolean` | `true` | Client-side pagination |
| `defaultPageSize` | `number` | `10` | |
| `pageSizeOptions` | `number[]` | `[10,25,50,100]` | |
| `emptyMessage` | `string` | `"No records found."` | |
| `rowClassName` | `(row) => string` | — | For edit highlight: `(row) => editingId === row.original.Id ? "bg-primary/5 border-l-2 border-l-primary" : ""` |
| `skeletonRows` | `number` | `5` | Skeleton row count when loading |

---

## Enabling / disabling sorting per column

All columns are sortable by default. Disable per column:

```tsx
{ accessorKey: "Actions", enableSorting: false }
```

---

## Pages to migrate (28 remaining)

| File | Notes |
|---|---|
| `pages/Users.tsx` | Has avatar cell — keep custom cell renderer |
| `pages/Transactions.tsx` | Server-side pagination — set `paginated={false}`, keep your own pagination |
| `pages/Records.tsx` | Same as Transactions |
| `pages/Brs.tsx` | Has checkbox column — add as first ColumnDef |
| `pages/masters/ItemMaster.tsx` | Standard |
| `pages/masters/CardMaster.tsx` | Standard |
| `pages/masters/GeneralLedgerMaster.tsx` | Already has sort logic — remove it, DataTable handles it |
| `pages/masters/TypeOfDocMaster.tsx` | Standard |
| `pages/masters/ExpensesMaster.tsx` | Standard |
| `pages/masters/AccountGroupMaster.tsx` | Tree structure — skip DataTable, keep custom |
| `pages/masters/ChequeMaster.tsx` | Standard |
| `pages/masters/RoleMaster.tsx` | Standard |
| `pages/admin/masters/EnterpriseMaster.tsx` | Standard |
| `pages/admin/masters/ProjectMaster.tsx` | Standard |
| `pages/admin/masters/CompanyMaster.tsx` | Standard |
| `pages/admin/Activitybrowser/ActivityBrowserTabs.tsx` | Standard |
| `pages/admin/MenuRights.tsx` | Has complex nested structure — partial migration |
| `pages/admin/WidgetsRights.tsx` | Standard |
| `pages/admin/PostApprovalRights.tsx` | Standard |
| `pages/material/GRN.tsx` | Standard |
| `pages/material/MaterialDashboard.tsx` | Standard |
| `pages/dba/DBAProfile.tsx` | Standard |
| `pages/user/UserProfile.tsx` | Standard |
| `pages/admin/SuperAdminProfile.tsx` | Standard |
| `pages/admin/AdminProfile.tsx` | Standard |
| `pages/Widgets.tsx` | Standard |

**Skip for now:**
- `AccountGroupMaster.tsx` — tree/accordion structure, not a flat table
- `MenuRights.tsx` — checkbox matrix, not a data list

---

## Server-side pagination (Transactions, Records)

When the API paginates, keep your `page`/`totalPages` state but pass `paginated={false}` 
to DataTable and render your own pagination below it:

```tsx
<DataTable
  data={transactions}
  columns={columns}
  loading={loading}
  paginated={false}        // ← disable built-in pagination
  searchable={false}       // ← search is server-side too
/>

{/* Your existing pagination controls */}
<div className="flex items-center justify-between mt-4 px-1">
  ...
</div>
```
