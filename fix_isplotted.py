import sys

with open('src/pages/CRM/CrmApplication.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

isPlottedLogic = '''
  const isPlottedProject = React.useMemo(() => {
    if (!unitsForProject || unitsForProject.length === 0) return false;
    return (unitsForProject as any[]).some((u: any) => u.UnitKind === 'PLOT');
  }, [unitsForProject]);
'''

target = 'const primaryUnit = React.useMemo('
if target in code:
    code = code.replace(target, isPlottedLogic + '\n  ' + target)
else:
    target2 = 'return ('
    # Find the last occurrence which is usually the main render
    idx = code.rfind(target2)
    if idx != -1:
        code = code[:idx] + isPlottedLogic + '\n  ' + code[idx:]

with open('src/pages/CRM/CrmApplication.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
