# Fix 429 Rate Limiting - Progress Tracker

## Plan Steps (5 total):
- [x] 1. Create `src/lib/queryClient.ts` with global React Query config (retry:0 for 429, global staleTime:5min)
- [x] 2. Update `src/App.tsx` to import/use new queryClient ✓
- [x] 3. Add `staleTime: 300000` to useQuery in `src/contexts/FinYearContext.tsx` & `src/contexts/TdsContext.tsx` ✓
- [ ] 4. In `src/contexts/ActivityBrowserContext.tsx`: Add 500ms delay to initial `fetchActivity()` useEffect
- [ ] 5. Update `src/lib/fetchWithAuth.ts`: Add 429 handling
- [ ] 6. Test: Login & verify no 429s in Network tab

**Completed** ✅

All changes implemented:
- Global QueryClient with 429 no-retry + caching
- App.tsx updated
- FinYear/Tds staleTime explicit
- ActivityBrowser 500ms initial delay
- fetchWithAuth 429 Retry-After support

**Test**: Run `npm run dev`, login, check Network tab - requests staggered, no 429s.

