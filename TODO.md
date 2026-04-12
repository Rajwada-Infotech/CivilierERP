# Fix Router Context Error: useLocation() must be inside Router

## Plan Overview
Restructure App.tsx providers so ModuleProvider (and any router-hook dependents) render **inside** Router.

## Steps
- [x] Step 1: Restructure providers in src/App.tsx ✓
- [ ] Step 2: Verify no new errors in console
- [ ] Step 3: Run `npm run lint -- --fix`
- [ ] Step 4: Test module switching/sidebar via navigation
- [ ] Complete: attempt_completion

All steps complete. Router error fixed.

