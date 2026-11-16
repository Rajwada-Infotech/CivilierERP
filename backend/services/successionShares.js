"use strict";
/**
 * Succession share SUGGESTION — never a legal decision.
 * Works only from the rules in Setup → Succession Rules (dbo.LegalSuccessionRule). Each heir's share comes from the
 * one rule matching (law, heir role, condition); heirs with no rule are left for manual review. Every result line
 * carries the rule used and whether a lawyer has validated it.
 *
 * Rule share types:
 *   Fixed   — a fraction ("1/8"), or "one|two-or-more" ("1/2|2/3") shared by all heirs of that role
 *   Equal   — one head share each, from what is left after Fixed shares
 *   Branch  — heirs of a predeceased child (same BranchOf) together take one head share, split equally
 *   Residue — what is left after Fixed (and Equal) shares, split by weight ("2" for a son, "1" for a daughter)
 * If Fixed shares exceed the whole, they are reduced proportionally (noted). Any remainder nobody takes is reported
 * as unallocated, for legal review.
 */

const frac = (s) => {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(s || ""));
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
};
const CHILD_ROLES = ["Son", "Daughter", "Child of predeceased son", "Child of predeceased daughter"];

/** Which conditions hold for this set of heirs. */
function conditions(heirs) {
  const children = heirs.some((h) => CHILD_ROLES.includes(h.role));
  const son = heirs.some((h) => h.role === "Son");
  return { Always: true, "Children present": children, "No children": !children, "Son present": son, "No son": !son };
}

/**
 * heirs: [{ id, name, role, branchOf, relinquished, recordedPct }]; rules: rows of LegalSuccessionRule (active ones).
 * Returns { lines: [{ id, name, role, recordedPct, suggestedPct|null, rule|null, validated, note }], notes: [], allValidated }.
 */
function suggestShares(law, heirs, rules) {
  const notes = [];
  const active = heirs.filter((h) => h.relinquished !== "Yes");
  heirs.filter((h) => h.relinquished === "Yes").forEach((h) => notes.push(`${h.name} relinquished — left out of the calculation`));
  const cond = conditions(active);
  const lawRules = rules.filter((r) => r.Law === law && r.IsActive !== false && r.IsActive !== 0);
  const ruleFor = (role) => lawRules.find((r) => r.HeirRole === role && cond[r.Condition]);

  const out = new Map(heirs.map((h) => [h.id, { id: h.id, name: h.name, role: h.role, recordedPct: h.recordedPct, suggestedPct: h.relinquished === "Yes" ? 0 : null, rule: null, validated: false, note: h.relinquished === "Yes" ? "Relinquished" : "" }]));
  const withRule = [];
  for (const h of active) {
    const r = h.role ? ruleFor(h.role) : null;
    const line = out.get(h.id);
    if (!h.role) { line.note = "Heir role not set"; continue; }
    if (!r) { line.note = "No rule for this heir under this law — manual review"; continue; }
    line.rule = `${r.ShareType}${r.ShareValue ? ` ${r.ShareValue}` : ""}${r.LawRef ? ` · ${r.LawRef}` : ""}`;
    line.validated = !!r.LawyerValidated;
    withRule.push({ h, r });
  }

  // 1. Fixed shares (shared among all heirs of the same role).
  const byRole = (type) => {
    const m = new Map();
    withRule.filter((x) => x.r.ShareType === type).forEach((x) => m.set(x.h.role, [...(m.get(x.h.role) ?? []), x]));
    return m;
  };
  const fixed = [];
  for (const [, group] of byRole("Fixed")) {
    const [one, many] = String(group[0].r.ShareValue || "").split("|");
    const total = frac(group.length > 1 && many ? many : one);
    if (total == null) { group.forEach((x) => { out.get(x.h.id).note = "Rule share is not a fraction"; }); continue; }
    fixed.push({ group, total });
  }
  let fixedSum = fixed.reduce((a, f) => a + f.total, 0);
  if (fixedSum > 1 + 1e-9) {
    notes.push(`Fixed shares add up to ${(fixedSum * 100).toFixed(2)}% — reduced proportionally (legal review)`);
    fixed.forEach((f) => { f.total /= fixedSum; });
    fixedSum = 1;
  }
  fixed.forEach((f) => f.group.forEach((x) => { out.get(x.h.id).suggestedPct = (f.total / f.group.length) * 100; }));
  let rest = 1 - fixedSum;

  // 2. Equal heads (each Equal heir one head; each Branch one head shared inside the branch).
  const equal = withRule.filter((x) => x.r.ShareType === "Equal");
  const branches = new Map();
  withRule.filter((x) => x.r.ShareType === "Branch").forEach((x) => {
    const key = (x.h.branchOf || "").trim().toLowerCase();
    if (!key) { out.get(x.h.id).note = "Say whose branch (the predeceased child)"; return; }
    branches.set(key, [...(branches.get(key) ?? []), x]);
  });
  const heads = equal.length + branches.size;
  const residue = withRule.filter((x) => x.r.ShareType === "Residue");
  if (heads) {
    const each = residue.length ? 0 : rest / heads;
    if (residue.length) notes.push("Equal and residuary heirs under the same law — check the rules (legal review)");
    else {
      equal.forEach((x) => { out.get(x.h.id).suggestedPct = each * 100; });
      for (const [, g] of branches) g.forEach((x) => { out.get(x.h.id).suggestedPct = (each / g.length) * 100; });
      rest = 0;
    }
  }

  // 3. Residue by weight.
  if (residue.length && rest > 0) {
    const w = residue.reduce((a, x) => a + (Number(x.r.ShareValue) || 1), 0);
    residue.forEach((x) => { out.get(x.h.id).suggestedPct = (rest * (Number(x.r.ShareValue) || 1) / w) * 100; });
    rest = 0;
  }
  if (rest > 1e-9 && withRule.length) notes.push(`${(rest * 100).toFixed(2)}% is not taken by any heir under these rules — legal review`);

  const lines = [...out.values()].map((l) => ({ ...l, suggestedPct: l.suggestedPct == null ? null : Math.round(l.suggestedPct * 10000) / 10000 }));
  return { lines, notes, allValidated: withRule.length > 0 && withRule.every((x) => x.r.LawyerValidated) };
}

/** True when a recorded share differs from the suggestion by more than 0.01 percentage points. */
const differs = (lines) => lines.some((l) => l.suggestedPct != null && Math.abs(Number(l.recordedPct ?? 0) - l.suggestedPct) > 0.01);

module.exports = { suggestShares, differs, CHILD_ROLES };
