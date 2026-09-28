import sys

with open('src/pages/CRM/CrmApplication.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

target = 'PreferredUnitIds: app.PreferredUnitId != null ? [String(app.PreferredUnitId)] : [],'
insertion = 'PreferredUnitIds: app.PreferredUnitIdsCsv ? app.PreferredUnitIdsCsv.split(\',\') : (app.PreferredUnitId != null ? [String(app.PreferredUnitId)] : []), // Mapped from STRING_AGG'

code = code.replace(target, insertion)

with open('src/pages/CRM/CrmApplication.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
