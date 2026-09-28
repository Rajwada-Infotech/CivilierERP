import sys

with open('src/pages/CRM/CrmApplication.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if i > 3000 and 'const isPlottedProject' in line:
        skip = True
        continue
    if skip and '}, [unitsForProject]);' in line:
        skip = False
        continue
    if skip:
        continue
        
    if 'const canEditUnitSelection =' in line:
        new_lines.append('''  const isPlottedProject = React.useMemo(() => {
    if (!unitsForProject || unitsForProject.length === 0) return false;
    return (unitsForProject as any[]).some((u: any) => u.UnitKind === 'PLOT');
  }, [unitsForProject]);\n\n''')
        new_lines.append(line)
    else:
        new_lines.append(line)

with open('src/pages/CRM/CrmApplication.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
