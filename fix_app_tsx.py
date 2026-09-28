import sys

with open('src/pages/CRM/CrmApplication.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Add import
if 'MultiSelectDropdown' not in code:
    code = code.replace('import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";', 
    'import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";\nimport { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";')

# 2. Update EMPTY_FORM
code = code.replace('PreferredUnitId: "", PaymentPlanId: "",', 'PreferredUnitIds: [] as string[], PaymentPlanId: "",')

# 3. Update setForm overrides
code = code.replace('PreferredUnitId: app.PreferredUnitId != null ? String(app.PreferredUnitId) : "",', 'PreferredUnitIds: app.PreferredUnitId != null ? [String(app.PreferredUnitId)] : [],')

code = code.replace('PreferredUnitId: "", PaymentPlanId: ""', 'PreferredUnitIds: [], PaymentPlanId: ""')

# 4. Form references to first item
code = code.replace('form.PreferredUnitId', 'form.PreferredUnitIds[0]')
code = code.replace('form.PreferredUnitIds[0]s', 'form.PreferredUnitIds')  # just in case
code = code.replace('!form.PreferredUnitIds[0]', '(!form.PreferredUnitIds || form.PreferredUnitIds.length === 0)')

# 5. The submission
code = code.replace('PreferredUnitId: form.PreferredUnitIds[0] || null,', 'PreferredUnitIds: form.PreferredUnitIds || [],')

# 6. isPlotted logic and conditional render
# We need to inject isPlottedProject logic near the unitsForProject filtering.
# unitsForProject is around line 916
isPlottedLogic = '''
  const isPlottedProject = React.useMemo(() => {
    if (!unitsForProject || unitsForProject.length === 0) return false;
    return (unitsForProject as any[]).some((u: any) => u.UnitKind === 'PLOT');
  }, [unitsForProject]);
'''
code = code.replace('const primaryUnit = React.useMemo(', isPlottedLogic + '\n  const primaryUnit = React.useMemo(')

# Now replace the <select value={form.PreferredUnitIds[0]}> with the conditional component
old_select = '''<select value={form.PreferredUnitIds[0]} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}
                          onChange={(e) => {
                            // Payment Plans) still narrows correctly instead of
                            // silently staying project-wide.
                            const picked = (unitsForProject as any[]).find((u: any) => String(u.Id) === e.target.value);
                            setForm((f) => ({
                              ...f,
                              PreferredUnitIds: [e.target.value],
                              BlockId: picked?.BlockId != null ? String(picked.BlockId) : f.BlockId,
                              FloorNo: picked?.FloorNo != null ? String(picked.FloorNo) : f.FloorNo,
                              PaymentPlanId: "",
                            }));
                          }}
                          className={inputCls}>
                          <option value="">Select unit</option>
                          {(unitsForProject as any[]).map((u: any) => <option key={u.Id} value={String(u.Id)}>{u.UnitName} {u.AreaSqFt ? \(\ sq.ft)\ : ""}</option>)}
                        </select>'''

new_select = '''{isPlottedProject ? (
                          <MultiSelectDropdown
                            options={(unitsForProject as any[]).map((u: any) => ({
                              id: String(u.Id),
                              label: \\ \\,
                              group: u.BlockName
                            }))}
                            value={form.PreferredUnitIds}
                            onChange={(nextIds) => {
                              const picked = (unitsForProject as any[]).find((u: any) => nextIds.includes(String(u.Id)));
                              setForm((f) => ({
                                ...f,
                                PreferredUnitIds: nextIds,
                                BlockId: picked?.BlockId != null ? String(picked.BlockId) : f.BlockId,
                                FloorNo: picked?.FloorNo != null ? String(picked.FloorNo) : f.FloorNo,
                                PaymentPlanId: "",
                              }));
                            }}
                            placeholder="Select units"
                            searchPlaceholder="Search units..."
                            itemNoun="unit"
                          />
                        ) : (
                          <Select value={form.PreferredUnitIds[0] || undefined} onValueChange={(id) => {
                            const picked = (unitsForProject as any[]).find((u: any) => String(u.Id) === id);
                            setForm((f) => ({
                              ...f,
                              PreferredUnitIds: [id],
                              BlockId: picked?.BlockId != null ? String(picked.BlockId) : f.BlockId,
                              FloorNo: picked?.FloorNo != null ? String(picked.FloorNo) : f.FloorNo,
                              PaymentPlanId: "",
                            }));
                          }} disabled={applicationId != null && (unitLocked || !canEditUnitSelection)}>
                            <SelectTrigger className={inputCls}>
                              <SelectValue placeholder="Select unit" />
                            </SelectTrigger>
                            <SelectContent>
                              {(unitsForProject as any[]).map((u: any) => (
                                <SelectItem key={u.Id} value={String(u.Id)}>{u.UnitName} {u.AreaSqFt ? \(\ sq.ft)\ : ""}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}'''

# Since we don't have exactly old_select matched string (it has PreferredUnitId instead of PreferredUnitIds[0] originally, wait, I already replaced it above! But I need to be careful with formatting).
# Let's replace using regex or index.

with open('src/pages/CRM/CrmApplication.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
