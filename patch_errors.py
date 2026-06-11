import re

# Fix 1 & 2: href -> path in Breadcrumbs items
for fname in [
    "src\\pages\\followup\\FinanceDemands.tsx",
    "src\\pages\\followup\\FinancePayments.tsx",
]:
    with open(fname, "r", encoding="utf-8") as f:
        content = f.read()
    new, n = re.subn(
        r'\{ label: "Follow-Up", href: "/followup" \}',
        '{ label: "Follow-Up", path: "/followup" }',
        content
    )
    with open(fname, "w", encoding="utf-8") as f:
        f.write(new)
    print(f"Fix href->path ({n}): {fname}")

# Fix 3: add missing poReceivedAmount in GRN edit setFormData
fname = "src\\pages\\material\\GRN.tsx"
with open(fname, "r", encoding="utf-8") as f:
    content = f.read()
old = '      poSubtotalAmount: Number(fullGrn.POSubtotalAmount ?? 0),\r\n      remarks: fullGrn.Remarks || "",'
new = '      poSubtotalAmount: Number(fullGrn.POSubtotalAmount ?? 0),\r\n      poReceivedAmount: Number(fullGrn.POReceivedAmount ?? 0),\r\n      remarks: fullGrn.Remarks || "",'
if old in content:
    content = content.replace(old, new)
    print("Fix poReceivedAmount (CRLF): GRN.tsx")
else:
    old = old.replace('\r\n', '\n')
    new = new.replace('\r\n', '\n')
    content = content.replace(old, new)
    print("Fix poReceivedAmount (LF): GRN.tsx")
with open(fname, "w", encoding="utf-8") as f:
    f.write(content)
