## TODO - Fix React Invalid Hook Call

### Completed (3/7)
- [x] 1. Create src/components/layout/AuthRoute.tsx (new lazy auth guards)
- [x] 2. Refactor src/App.tsx (remove top-level guards, use lazy routes)
- [x] 3. Fix src/contexts/AuthContext.tsx (remove useActivityBrowser dependency)

- [ ] 4. Add npm install command
- [ ] 5. Test `npm run dev` - no hook errors
- [ ] 6. Test login/logout, page guards, activity logging

- [ ] 5. Delete node_modules & reinstall dependencies (run manually)

- [ ] 4. Update all route definitions to use lazy AuthRoute wrappers
- [ ] 5. Delete node_modules & reinstall dependencies
- [ ] 6. Test app startup (npm run dev) - verify no hook errors
- [ ] 7. Test functionality: login/logout, page guards, activity logging

**Current step: 1/7 - Create AuthRoute.tsx**

