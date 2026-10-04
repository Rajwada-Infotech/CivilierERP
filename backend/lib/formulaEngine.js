// Salary Structure formula engine -- shared by the Salary Structure routes
// (validate/calculate/activate), Employee Salary Details, and Payroll Run.
// Backend-authoritative on purpose: the frontend Preview Calculator and the
// real Payroll Run both call through here, so they can never drift apart.
//
// Grammar (recursive descent):
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | postfix
//   postfix := primary ('%')*          -- N% means N/100, so "BASIC * 40%"
//   primary := NUMBER | IDENT | '(' expr ')'

const RESERVED_KEYWORDS = [
  "CTC",
  "ANNUAL_CTC",
  "MONTHLY_CTC",
  "GROSS",
  "NET",
  "TOTAL_EARNINGS",
  "TOTAL_DEDUCTION",
  "TOTAL_EMPLOYER_CONTRIBUTION",
];
const RESERVED_SET = new Set(RESERVED_KEYWORDS);

const COMPONENT_TYPES = ["Earning", "Deduction", "Employer Contribution", "Informational"];
const CALCULATION_TYPES = ["Fixed", "Percentage", "Formula"];
const ROUNDING_RULES = ["None", "Nearest", "Up", "Down"];

class FormulaError extends Error {}

// ---------------------------------------------------------------------------
// Tokenizer + parser
// ---------------------------------------------------------------------------

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const s = text || "";
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(raw)) throw new FormulaError(`Invalid number "${raw}"`);
      tokens.push({ type: "NUMBER", value: Number(raw) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      tokens.push({ type: "IDENT", value: s.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    if ("+-*/()%".includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}"`);
  }
  return tokens;
}

function parseFormula(text) {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new FormulaError("Missing operand");
    if (tok.type === "NUMBER") {
      next();
      return { kind: "number", value: tok.value };
    }
    if (tok.type === "IDENT") {
      next();
      return { kind: "ident", name: tok.value };
    }
    if (tok.type === "(") {
      next();
      const inner = parseExpr();
      if (!peek() || peek().type !== ")") throw new FormulaError("Missing closing parenthesis");
      next();
      return inner;
    }
    throw new FormulaError(`Unexpected token "${tok.type}"`);
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (peek() && peek().type === "%") {
      next();
      node = { kind: "percent", operand: node };
    }
    return node;
  }

  function parseUnary() {
    if (peek() && peek().type === "-") {
      next();
      return { kind: "neg", operand: parseUnary() };
    }
    return parsePostfix();
  }

  function parseTerm() {
    let node = parseUnary();
    while (peek() && (peek().type === "*" || peek().type === "/")) {
      const op = next().type;
      const right = parseUnary();
      node = { kind: "binary", op, left: node, right };
    }
    return node;
  }

  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().type === "+" || peek().type === "-")) {
      const op = next().type;
      const right = parseTerm();
      node = { kind: "binary", op, left: node, right };
    }
    return node;
  }

  if (!tokens.length) throw new FormulaError("Formula is empty");
  const ast = parseExpr();
  if (pos !== tokens.length) throw new FormulaError(`Unexpected token near position ${pos}`);
  return ast;
}

function extractIdentifiers(ast, out) {
  const set = out || new Set();
  if (!ast) return set;
  if (ast.kind === "ident") set.add(ast.name);
  else if (ast.kind === "neg" || ast.kind === "percent") extractIdentifiers(ast.operand, set);
  else if (ast.kind === "binary") {
    extractIdentifiers(ast.left, set);
    extractIdentifiers(ast.right, set);
  }
  return set;
}

function evalAst(ast, scope) {
  switch (ast.kind) {
    case "number":
      return ast.value;
    case "ident": {
      if (!(ast.name in scope)) throw new FormulaError(`Unknown identifier "${ast.name}"`);
      return scope[ast.name];
    }
    case "neg":
      return -evalAst(ast.operand, scope);
    case "percent":
      return evalAst(ast.operand, scope) / 100;
    case "binary": {
      const l = evalAst(ast.left, scope);
      const r = evalAst(ast.right, scope);
      if (ast.op === "+") return l + r;
      if (ast.op === "-") return l - r;
      if (ast.op === "*") return l * r;
      if (ast.op === "/") {
        if (r === 0) throw new FormulaError("Division by zero");
        return l / r;
      }
      throw new FormulaError(`Unknown operator "${ast.op}"`);
    }
    default:
      throw new FormulaError("Malformed formula");
  }
}

// ---------------------------------------------------------------------------
// Structure-level formula derivation
// ---------------------------------------------------------------------------

// Every line, regardless of CalculationType, reduces to a formula string so
// the rest of the engine (dependency graph, evaluator) only has one code
// path. Percentage lines auto-generate "BASE * PCT %" so the user never
// types the underlying arithmetic (spec 3B).
function lineFormulaText(line) {
  if (line.CalculationType === "Fixed") return null; // literal, no identifiers
  if (line.CalculationType === "Percentage") {
    const base = (line.CalculationBase || "").trim();
    if (!base) return null;
    return `${base} * ${line.Percentage} %`;
  }
  if (line.CalculationType === "Formula") return (line.Formula || "").trim() || null;
  return null;
}

function round(value, rule) {
  if (rule === "Nearest") return Math.round(value);
  if (rule === "Up") return Math.ceil(value);
  if (rule === "Down") return Math.floor(value);
  return value;
}

function clamp(value, min, max) {
  let v = value;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// lines: array of { DeductionAdditionId, HeadCode, HeadName, HeadType, HeadActive,
//   CalculationType, CalculationBase, Percentage, Amount, Formula, MinAmount,
//   MaxAmount, RoundingRule, IsBalancing, IsActive }
function validateStructure(lines) {
  const errors = [];
  const codeToLine = new Map();
  const seenHeads = new Set();
  let balancingCount = 0;

  for (const line of lines) {
    if (seenHeads.has(line.DeductionAdditionId)) {
      errors.push({ message: `Duplicate Salary Head: ${line.HeadName}` });
    }
    seenHeads.add(line.DeductionAdditionId);
    if (line.HeadCode) codeToLine.set(line.HeadCode.toUpperCase(), line);
    if (line.IsBalancing) balancingCount++;

    if (!CALCULATION_TYPES.includes(line.CalculationType)) {
      errors.push({ message: `${line.HeadName}: invalid Calculation Type "${line.CalculationType}"` });
      continue;
    }
    if (line.RoundingRule && !ROUNDING_RULES.includes(line.RoundingRule)) {
      errors.push({ message: `${line.HeadName}: invalid Rounding Rule "${line.RoundingRule}"` });
    }
    if (!line.HeadActive) {
      errors.push({ message: `${line.HeadName} is inactive and cannot be used in a Salary Structure` });
    }

    if (line.CalculationType === "Fixed") {
      if (line.Amount == null || !Number.isFinite(Number(line.Amount))) {
        errors.push({ message: `${line.HeadName}: Fixed Amount is required` });
      }
    }
    if (line.CalculationType === "Percentage") {
      const pct = Number(line.Percentage);
      if (line.Percentage == null || !Number.isFinite(pct) || pct < 0) {
        errors.push({ message: `${line.HeadName}: invalid percentage` });
      }
      if (!line.CalculationBase) {
        errors.push({ message: `${line.HeadName}: Calculation Base is required for Percentage type` });
      }
    }
    if (line.CalculationType === "Formula" && !(line.Formula || "").trim()) {
      errors.push({ message: `${line.HeadName}: Formula is required` });
    }
  }

  if (balancingCount > 1) {
    errors.push({ message: "Only one Salary Head can be configured as the balancing component" });
  }

  // Parse formulas + collect identifier references
  const lineRefs = new Map(); // line -> Set<head codes referenced>
  for (const line of lines) {
    const formulaText = lineFormulaText(line);
    if (!formulaText) continue;
    let ast;
    try {
      ast = parseFormula(formulaText);
    } catch (err) {
      errors.push({ message: `${line.HeadName}: ${err.message}` });
      continue;
    }
    const idents = extractIdentifiers(ast);
    const refs = new Set();
    for (const ident of idents) {
      if (RESERVED_SET.has(ident)) continue;
      const target = codeToLine.get(ident);
      if (!target) {
        errors.push({ message: `${line.HeadName}: formula references unknown Salary Head "${ident}"` });
        continue;
      }
      if (!target.HeadActive) {
        errors.push({ message: `${line.HeadName}: formula references inactive Salary Head "${ident}"` });
      }
      if (target.IsBalancing) {
        errors.push({ message: `${line.HeadName}: cannot reference the balancing component "${ident}" -- it is computed last` });
        continue;
      }
      refs.add(ident);
    }
    lineRefs.set(line, refs);
  }

  // Also validate Percentage CalculationBase references.
  for (const line of lines) {
    if (line.CalculationType !== "Percentage" || !line.CalculationBase) continue;
    const base = line.CalculationBase.toUpperCase();
    if (RESERVED_SET.has(base)) continue;
    const target = codeToLine.get(base);
    if (!target) {
      errors.push({ message: `${line.HeadName}: invalid Calculation Base "${line.CalculationBase}"` });
    } else if (!target.HeadActive) {
      errors.push({ message: `${line.HeadName}: Calculation Base "${line.CalculationBase}" is inactive` });
    } else if (target.IsBalancing) {
      errors.push({ message: `${line.HeadName}: cannot use balancing component "${line.CalculationBase}" as a Calculation Base` });
    }
  }

  // Dependency graph + cycle detection (DFS), non-balancing lines only.
  const graphErrors = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const state = new Map();
  const codeOf = (line) => (line.HeadCode || "").toUpperCase();
  for (const line of lines) state.set(codeOf(line), WHITE);

  function dfs(line, stack) {
    const code = codeOf(line);
    state.set(code, GRAY);
    stack.push(line.HeadName);
    const refs = lineRefs.get(line) || new Set();
    for (const refCode of refs) {
      const target = codeToLine.get(refCode);
      if (!target) continue;
      const targetState = state.get(codeOf(target));
      if (targetState === GRAY) {
        graphErrors.push(
          `Circular dependency detected between ${line.HeadName} and ${target.HeadName}.`,
        );
      } else if (targetState === WHITE) {
        dfs(target, stack);
      }
    }
    stack.pop();
    state.set(code, BLACK);
  }

  for (const line of lines) {
    if (line.IsBalancing) continue;
    if (state.get(codeOf(line)) === WHITE) dfs(line, []);
  }
  for (const msg of new Set(graphErrors)) errors.push({ message: msg });

  return { errors, valid: errors.length === 0, lineRefs, codeToLine };
}

function topologicalOrder(lines, lineRefs, codeToLine) {
  const order = [];
  const visited = new Set();
  const codeOf = (line) => (line.HeadCode || "").toUpperCase();

  function visit(line) {
    const code = codeOf(line);
    if (visited.has(code)) return;
    visited.add(code);
    const refs = lineRefs.get(line) || new Set();
    for (const refCode of refs) {
      const target = codeToLine.get(refCode);
      if (target) visit(target);
    }
    order.push(line);
  }

  for (const line of lines) {
    if (line.IsBalancing) continue;
    visit(line);
  }
  return order;
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

function describeCalculation(line) {
  if (line.IsBalancing) return "Balance";
  if (line.CalculationType === "Fixed") return `Fixed ₹${Number(line.Amount || 0).toLocaleString("en-IN")}`;
  if (line.CalculationType === "Percentage") return `${line.Percentage}% of ${line.CalculationBase}`;
  if (line.CalculationType === "Formula") return line.Formula || "";
  return "";
}

// testCtc + ctcFrequency describe the CTC being tested (Preview) or the
// employee's actual CTC (real calculation) -- same function either way.
function calculateStructure(lines, testCtc, ctcFrequency, structureFrequency) {
  const validation = validateStructure(lines);
  if (!validation.valid) {
    return { errors: validation.errors, valid: false, lines: [], totals: null };
  }

  const annualCtc = ctcFrequency === "Annual" ? Number(testCtc) : Number(testCtc) * 12;
  const monthlyCtc = ctcFrequency === "Annual" ? Number(testCtc) / 12 : Number(testCtc);
  // CTC keyword follows the *structure's* configured frequency, matching
  // both the generic "BASIC = CTC * 40 / 100" examples (spec 8) and the
  // explicit MONTHLY_CTC form used in the spec 5 worked example.
  const ctcInStructureFrequency = structureFrequency === "Annual" ? annualCtc : monthlyCtc;

  const scope = {
    CTC: ctcInStructureFrequency,
    ANNUAL_CTC: annualCtc,
    MONTHLY_CTC: monthlyCtc,
    GROSS: 0,
    NET: 0,
    TOTAL_EARNINGS: 0,
    TOTAL_DEDUCTION: 0,
    TOTAL_EMPLOYER_CONTRIBUTION: 0,
  };

  const order = topologicalOrder(lines.filter((l) => l.IsActive), validation.lineRefs, validation.codeToLine);
  const results = new Map(); // line -> amount
  const computeErrors = [];

  for (const line of order) {
    let amount = 0;
    try {
      if (line.CalculationType === "Fixed") {
        amount = Number(line.Amount || 0);
      } else {
        const formulaText = lineFormulaText(line);
        const ast = parseFormula(formulaText);
        amount = evalAst(ast, scope);
      }
      amount = clamp(amount, line.MinAmount != null ? Number(line.MinAmount) : null, line.MaxAmount != null ? Number(line.MaxAmount) : null);
      amount = round(amount, line.RoundingRule);
    } catch (err) {
      computeErrors.push({ message: `${line.HeadName}: ${err.message}` });
      amount = 0;
    }
    results.set(line, amount);
    scope[(line.HeadCode || "").toUpperCase()] = amount;
  }

  if (computeErrors.length) {
    return { errors: computeErrors, valid: false, lines: [], totals: null };
  }

  const sumWhere = (predicate) =>
    lines
      .filter((l) => l.IsActive && !l.IsBalancing && predicate(l))
      .reduce((acc, l) => acc + (results.get(l) || 0), 0);

  const targetCtc = ctcInStructureFrequency;
  const balancingLine = lines.find((l) => l.IsBalancing && l.IsActive);
  if (balancingLine) {
    const otherCtcSum = sumWhere((l) => l.IncludeInCTC);
    let balancingAmount = targetCtc - otherCtcSum;
    balancingAmount = clamp(
      balancingAmount,
      balancingLine.MinAmount != null ? Number(balancingLine.MinAmount) : null,
      balancingLine.MaxAmount != null ? Number(balancingLine.MaxAmount) : null,
    );
    balancingAmount = round(balancingAmount, balancingLine.RoundingRule);
    results.set(balancingLine, balancingAmount);
    scope[(balancingLine.HeadCode || "").toUpperCase()] = balancingAmount;
  }

  const gross = lines.filter((l) => l.IsActive && l.IncludeInGross).reduce((acc, l) => acc + (results.get(l) || 0), 0);
  const totalEmployeeDeduction = lines
    .filter((l) => l.IsActive && l.HeadType === "Deduction" && l.IncludeInNet)
    .reduce((acc, l) => acc + (results.get(l) || 0), 0);
  const totalEmployerContribution = lines
    .filter((l) => l.IsActive && l.HeadType === "Employer Contribution" && l.IncludeInCTC)
    .reduce((acc, l) => acc + (results.get(l) || 0), 0);
  const totalCtc = lines.filter((l) => l.IsActive && l.IncludeInCTC).reduce((acc, l) => acc + (results.get(l) || 0), 0);
  const netSalary = gross - totalEmployeeDeduction;

  const computedLines = lines
    .filter((l) => l.IsActive)
    .sort((a, b) => (a.Sequence || 0) - (b.Sequence || 0))
    .map((l) => ({
      DeductionAdditionId: l.DeductionAdditionId,
      HeadCode: l.HeadCode,
      HeadName: l.HeadName,
      HeadType: l.HeadType,
      Calculation: describeCalculation(l),
      Amount: Math.round((results.get(l) || 0) * 100) / 100,
    }));

  return {
    valid: true,
    errors: [],
    lines: computedLines,
    totals: {
      AnnualCTC: Math.round(annualCtc * 100) / 100,
      MonthlyCTC: Math.round(monthlyCtc * 100) / 100,
      GrossSalary: Math.round(gross * 100) / 100,
      TotalEmployeeDeduction: Math.round(totalEmployeeDeduction * 100) / 100,
      NetSalary: Math.round(netSalary * 100) / 100,
      TotalEmployerContribution: Math.round(totalEmployerContribution * 100) / 100,
      TotalCTC: Math.round(totalCtc * 100) / 100,
    },
  };
}

// Picks the SalaryStructure row for `code` whose EffectiveFrom..EffectiveTo
// window covers `asOfDate`, among Active rows -- shared by Employee Salary
// Details and Payroll Run so both resolve the same way (spec 16).
function pickStructureVersion(rows, asOfDate) {
  const date = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
  const candidates = rows.filter((r) => {
    if (!r.IsActive) return false;
    const from = r.EffectiveFrom ? new Date(r.EffectiveFrom) : null;
    const to = r.EffectiveTo ? new Date(r.EffectiveTo) : null;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.Version || 0) - (a.Version || 0));
  return candidates[0];
}

module.exports = {
  RESERVED_KEYWORDS,
  RESERVED_SET,
  COMPONENT_TYPES,
  CALCULATION_TYPES,
  ROUNDING_RULES,
  FormulaError,
  parseFormula,
  evalAst,
  lineFormulaText,
  validateStructure,
  topologicalOrder,
  calculateStructure,
  pickStructureVersion,
};
