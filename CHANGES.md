# Bug Fixes — CivilierERP Codebase Review

## Fix 1 — Critical: BrowserRouter placement (`App.tsx`)
**Problem:** `<BrowserRouter>` was nested *inside* `<AuthProvider>` and other context providers.
Any context trying to use `useNavigate`/`useLocation` internally would crash at runtime.  
**Fix:** `<BrowserRouter>` moved to the outermost position, wrapping all providers.

## Fix 2 — Routing: AdminModule never reachable (`App.tsx`)
**Problem:** Both `/admin` and `/admin/dashboard` rendered `<AdminDashboard>` (the stats page).
`<AdminModule>` (user/permission management — the actual admin tool) had no route.  
**Fix:** `/admin` → `<AdminModule>`, `/admin/dashboard` → `<AdminDashboard>`.

## Fix 3 — Logic Bug: Unused params in `closeTask` (`TaskContext.tsx`, `TaskDetail.tsx`)
**Problem:** `closeTask(taskId, userId, userName)` accepted `userId` and `userName` that were
never used inside the function body. All callers had to pass dummy values.  
**Fix:** Signature simplified to `closeTask(taskId: string)`. Call site updated accordingly.

## Fix 4 — Critical Data Bug: Index-based record IDs (`MasterPage.tsx`)
**Problem:** Edit/delete used the **array index** as the record identifier. When records were
filtered by search, `filtered[i]` ≠ `data[i]` — editing a filtered result silently
corrupted the wrong record in the source array.  
**Fix:** Each record now carries a stable `_id: string`. All operations match by `_id`.

## Fix 5 — Incomplete Action Maps (`AdminModule.tsx`)
**Problem:** `ACTION_LABELS`, `ACTION_COLORS`, and `ACTION_COLORS_ON` were typed as
`Record<PageAction, string>` (9 values) but only defined 4 entries (`view/create/edit/delete`).
The missing 5 (`print/preview/export/approve/reject`) caused TypeScript errors and crashed
the legend renderer at runtime.  
**Fix:** All 9 entries added to all three maps with appropriate colours.

## Fix 6 — Dual Toast Systems (`MenuRights`, `WidgetsRights`, `FinYearRights`, `ApprovalSetup`, `PostApprovalRights`)
**Problem:** The app uses `sonner` as its toast library (mounted via `<Sonner />`), but five
admin pages imported the old shadcn `useToast` hook. The shadcn `<Toaster>` component was
never mounted, so toasts from those pages were silently swallowed.  
**Fix:** All five files standardised to `import { toast } from "sonner"`.

## Fix 7 — Disconnected User Page + Password Exposure (`Users.tsx`)
**Problem:** `Users.tsx` maintained its own isolated local `useState` list entirely
disconnected from `AuthContext`. Adding a user here had no effect on login/permissions.
The `password` field was also stored in component state and shown in plain text in the table.  
**Fix:** Page now uses `addUser`, `deleteUser`, `toggleUserStatus` from `AuthContext`.
Password field has a show/hide toggle and is never surfaced after submission.

## Fix 8 — No Delete Confirmation in MasterPage (`MasterPage.tsx`)
**Problem:** One click on the delete button immediately deleted the record with no confirmation.  
**Fix:** Inline confirm/cancel buttons appear on first click; deletion only happens on confirm.

## Fix 9 — Inverted Lock/Unlock Logic (`FinYearContext.tsx`)
**Problem:** `toggleLock` set `status: 'Active'` when locking a financial year — the
ternary `!fy.locked ? 'Active' : 'Closed'` was backwards. Locking should close; unlocking should activate.  
**Fix:** Corrected to `fy.locked ? 'Active' : 'Closed'`.
