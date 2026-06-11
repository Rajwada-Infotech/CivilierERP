import re, os

files = [
    "src\\pages\\followup\\Agreements.tsx",
    "src\\pages\\followup\\AgreementWorkflow.tsx",
    "src\\pages\\followup\\ConstructionUpdates.tsx",
    "src\\pages\\followup\\Handover.tsx",
    "src\\pages\\followup\\LegalMilestones.tsx",
    "src\\pages\\followup\\NOC.tsx",
    "src\\pages\\followup\\PossessionNotice.tsx",
    "src\\pages\\followup\\PrePossessionClearance.tsx",
    "src\\pages\\followup\\SalesDeed.tsx",
]

# Import lines to find and append filterProjectsByCompany after
IMPORT_ANCHORS = [
    'import React, { useMemo, useState } from "react";',
    'import { useMemo, useState } from "react";',
    'import { useMemo, useRef, useEffect, useState } from "react";',
    'import { useMemo, useState, type ReactNode } from "react";',
]
IMPORT_INSERT = '\nimport { filterProjectsByCompany } from "@/lib/projectBelongsTo";'

# Pattern 1: memo-based project map — filter by CompanyId
# (meta?.projects ?? []).map((p) => ({
OLD_MEMO = r'\(meta\?\.projects \?\? \[\]\)\.map\('
NEW_MEMO = 'filterProjectsByCompany(meta?.projects ?? [], form.CompanyId).map('

# Pattern 2: inline JSX project map with typed param
# (meta?.projects ?? []).map((p: OptionItem) => (
OLD_MEMO_TYPED = r'\(meta\?\.projects \?\? \[\]\)\.map\(\(p: OptionItem\)'
NEW_MEMO_TYPED = 'filterProjectsByCompany(meta?.projects ?? [], form.CompanyId).map((p: any)'

OLD_MEMO_ANY = r'\(meta\?\.projects \?\? \[\]\)\.map\(\(p: any\)'
NEW_MEMO_ANY = 'filterProjectsByCompany(meta?.projects ?? [], form.CompanyId).map((p: any)'

# Company onChange resets — two patterns
OLD_SET = 'onChange={(v) => set("CompanyId", v)}'
NEW_SET = 'onChange={(v) => { set("CompanyId", v); set("ProjectId", ""); }}'

OLD_SETFORM = 'onValueChange={(v) => setForm((f) => ({ ...f, CompanyId: v }))}'
NEW_SETFORM = 'onValueChange={(v) => setForm((f) => ({ ...f, CompanyId: v, ProjectId: "" }))}'

OLD_SETFORM2 = 'setForm((f) => ({ ...f, CompanyId: v }))'
NEW_SETFORM2 = 'setForm((f) => ({ ...f, CompanyId: v, ProjectId: "" }))'

for fname in files:
    if not os.path.exists(fname):
        print(f"SKIP: {fname}")
        continue
    with open(fname, "r", encoding="utf-8") as f:
        content = f.read()

    total = 0

    # Fix 1: add import
    if "filterProjectsByCompany" not in content:
        for anchor in IMPORT_ANCHORS:
            if anchor in content:
                content = content.replace(anchor, anchor + IMPORT_INSERT, 1)
                total += 1
                break

    # Fix 2: filter project map (typed variants first, then generic)
    content, n = re.subn(OLD_MEMO_TYPED, NEW_MEMO_TYPED, content)
    total += n
    content, n = re.subn(OLD_MEMO_ANY, NEW_MEMO_ANY, content)
    total += n
    content, n = re.subn(OLD_MEMO, NEW_MEMO, content, flags=re.DOTALL)
    total += n

    # Fix 3: reset ProjectId on company change
    content, n = re.subn(re.escape(OLD_SET), NEW_SET, content)
    total += n
    content, n = re.subn(re.escape(OLD_SETFORM), NEW_SETFORM, content)
    total += n
    content, n = re.subn(re.escape(OLD_SETFORM2), NEW_SETFORM2, content)
    total += n

    if total == 0:
        print(f"NO CHANGE: {fname}")
    else:
        with open(fname, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"OK ({total} changes): {fname}")
