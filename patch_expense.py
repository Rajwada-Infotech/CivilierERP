import re

fname = "src\\pages\\material\\MaterialExpenseBooking.tsx"
with open(fname, "r", encoding="utf-8") as f:
    content = f.read()

# Fix 1: add useMemo to React imports and add filterProjectsByCompany import
old1 = 'import React, { useState, useEffect, useCallback, useRef } from "react";'
new1 = 'import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";\nimport { filterProjectsByCompany } from "@/lib/projectBelongsTo";'
content, n1 = re.subn(re.escape(old1), new1, content)
print(f"Fix 1 (imports): {n1} replacement")

# Fix 2: reset projectSite when company changes
old2 = 'set("companyId", v ? parseInt(v, 10) : null)'
new2 = '{ set("companyId", v ? parseInt(v, 10) : null); set("projectSite", ""); set("projectName", ""); }'
content, n2 = re.subn(re.escape(old2), new2, content)
print(f"Fix 2 (company reset): {n2} replacement")

# Fix 3: filter projectOptions before mapping in the dropdown
old3 = '{projectOptions.map((p) => ('
new3 = '{filterProjectsByCompany(projectOptions as any[], form.companyId ?? null).map((p: any) => ('
content, n3 = re.subn(re.escape(old3), new3, content)
print(f"Fix 3 (filtered dropdown): {n3} replacement")

with open(fname, "w", encoding="utf-8") as f:
    f.write(content)
print("Done")
