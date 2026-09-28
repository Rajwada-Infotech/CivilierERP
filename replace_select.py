import sys

with open('src/pages/CRM/CrmApplication.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

new_select = '''{isPlottedProject ? (
                          <div className={unitLocked || !canEditUnitSelection ? "pointer-events-none opacity-50" : ""}>
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
                          /></div>
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

start_idx = code.find('<select value={form.PreferredUnitIds[0]}')
end_idx = code.find('</select>', start_idx) + 9
if start_idx != -1:
    code = code[:start_idx] + new_select + code[end_idx:]

code = code.replace('PreferredUnitId: e.target.value', 'PreferredUnitIds: [e.target.value]')
code = code.replace('PreferredUnitId: ""', 'PreferredUnitIds: []')
code = code.replace('PreferredUnitId: null', 'PreferredUnitIds: []')
code = code.replace('(!form.PreferredUnitIds[0]s || form.PreferredUnitIds[0]s.length === 0)', '(!form.PreferredUnitIds || form.PreferredUnitIds.length === 0)')

with open('src/pages/CRM/CrmApplication.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
