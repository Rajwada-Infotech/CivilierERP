# Activity Browser Crash Fix - TODO

## Plan Breakdown & Progress Tracker

### Step 1: ✅ Create this TODO.md [DONE]

### Step 2: Update EVENT_COLORS with 'unknown' fallback
- Add `unknown` entry to EVENT_COLORS object in `src/pages/admin/ActivityBrowser.tsx`.

### Step 3: Fix desktop table map() - safe EVENT_COLORS access
- Replace `EVENT_COLORS[s.event]` with `EVENT_COLORS[s.event ?? 'unknown']`.

### Step 4: Fix mobile cards map() - safe EVENT_COLORS access
- Replace second `EVENT_COLORS[s.event]` with `EVENT_COLORS[s.event ?? 'unknown']`.

### Step 5: Optional - Update event display labels (if any direct {s.event})
- Scan and replace direct displays.

### Step 6: Test & Complete
- Verify no crashes.
- Mark complete.

**Next step:** Implement Step 2-4 via edits.

