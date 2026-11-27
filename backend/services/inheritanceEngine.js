"use strict";
/**
 * Provisional inheritance share calculation (Legal V3, spec 9.6–9.10).
 *
 * Exact rational arithmetic (BigInt fractions) — never floating point. The result is always PROVISIONAL: a Legal
 * Officer must approve it, and the rules here MUST be validated by a qualified lawyer (Indian / West Bengal law)
 * before they are relied on in production.
 *
 * Only clear, common situations are calculated; everything else returns "Requires Legal Review" with the reasons:
 *   • Hindu Succession Act 1956, male intestate — Class I heirs (s.8), distribution rules of s.10 (widows together
 *     one share; each son, daughter and the mother one share; each pre-deceased son's / daughter's branch one share,
 *     divided within the branch).
 *   • Hindu Succession Act 1956, female intestate — s.15(1)(a) sons, daughters (and branches of pre-deceased
 *     children, s.16) and husband in equal shares.
 *   • Muslim Personal Law, Sunni (Hanafi), NON-agricultural, at least one son — spouse 1/4 (husband) or 1/8 shared
 *     (wives), father 1/6, mother 1/6, residue to sons and daughters 2 : 1.
 * Not calculated (legal review): no framework confirmation, will / court order / non-intestate, agricultural land
 * under Muslim law (Shariat Act 1937 s.2 exception), coparcenary / undivided family property, Class II / agnates,
 * s.15(1)(b)–(e) and s.15(2), Shia school, Muslim cases without a son, disputed / unknown / missing heirs, deeper
 * pre-deceased generations, missing gender or available share. Shares are never adjusted to reach 100 %.
 */
const RULE_VERSION = "LEGAL-V3-INH-1.0 (27 Nov 2026) — HSA 1956 s.8/s.10, s.15(1)(a)/s.16; Hanafi basic — pending lawyer validation";

// ── exact fractions ──
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
class Frac {
  constructor(n, d = 1n) { const g = gcd(BigInt(n), BigInt(d)); this.n = BigInt(n) / g; this.d = BigInt(d) / g; if (this.d < 0n) { this.n = -this.n; this.d = -this.d; } }
  static of(x) { if (x instanceof Frac) return x; const s = String(x).trim(); if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split("/"); return new Frac(BigInt(a), BigInt(b)); }
    const [i, f = ""] = s.split("."); return new Frac(BigInt(i + f), 10n ** BigInt(f.length)); }
  add(o) { o = Frac.of(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Frac.of(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Frac.of(o); return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { o = Frac.of(o); return new Frac(this.n * o.d, this.d * o.n); }
  eq(o) { o = Frac.of(o); return this.n * o.d === o.n * this.d; }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
  pct(places = 4) { const m = 10n ** BigInt(places); const v = (this.n * 100n * m) / this.d; return Number(v) / Number(m); }
}

// Dates may arrive as Date objects (database) or "YYYY-MM-DD" strings — always compare ISO days.
const day = (d) => (d == null || d === "" ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
/** Alive when the owner died: recorded alive with no death date, or died after the owner. */
const alive = (m, deathOfDeceased) => {
  const died = day(m.DateOfDeath), ownerDied = day(deathOfDeceased);
  if (!died) return m.IsAlive === true || m.IsAlive === 1;
  return !!ownerDied && died > ownerDied;
};
const rel = (m) => String(m.RelationToDeceased || "");

/** Members of the case who are pre-deceased children, and their branch (spouse / children by RelatedToMemberId). */
function branches(members, death, kinds) {
  return members.filter((m) => kinds.includes(rel(m)) && !alive(m, death)).map((p) => ({
    head: p,
    members: members.filter((x) => Number(x.RelatedToMemberId) === Number(p.MemberId) && ["Son of", "Daughter of", "Wife of", "Husband of"].includes(String(x.RelationToRelated))),
  }));
}

/**
 * @param c     inheritance case row (ApplicableFramework, SchoolOfLaw, PropertyType, NatureOfOwnership, SuccessionType,
 *              WillAvailable, CourtOrderAvailable, DeceasedGender, DateOfDeath, AvailableSharePct/Fraction, FrameworkConfirmedBy)
 * @param members family members of the case
 * @returns { outcome, reasons[], lines[], explanation[], total, ruleVersion }
 */
function calculate(c, members) {
  const reasons = [], explanation = [];
  const fw = String(c.ApplicableFramework || "");
  if (!c.FrameworkConfirmedBy) reasons.push("The applicable legal framework is not confirmed by a Legal Officer");
  if (c.WillAvailable || c.CourtOrderAvailable || (c.SuccessionType && c.SuccessionType !== "Intestate – No Will")) reasons.push("Will / court order / non-intestate succession — testamentary or court rules apply");
  if (!["Hindu Succession Act, 1956", "Muslim Personal Law (Shariat)"].includes(fw)) reasons.push(`Framework "${fw || "not set"}" has no configured calculation`);
  if (!c.DeceasedGender) reasons.push("Deceased's gender not recorded");
  const avail = c.AvailableShareFraction ? Frac.of(c.AvailableShareFraction) : c.AvailableSharePct != null ? Frac.of(String(c.AvailableSharePct)).div(100) : null;
  if (!avail) reasons.push("The deceased's available share in the parcel is not recorded");
  const death = c.DateOfDeath;
  const doubtful = members.filter((m) => !m.IsDeceasedOwner && (["Disputed", "Unknown"].includes(m.RelationshipStatus) || m.IsMissing));
  if (doubtful.length) reasons.push(`Disputed / unknown / missing family members: ${doubtful.map((m) => m.FullName).join(", ")}`);
  const minors = members.filter((m) => m.IsMinor && alive(m, death));
  if (minors.length) explanation.push(`Minor heir(s) ${minors.map((m) => m.FullName).join(", ")} — a guardian / court permission may be needed for any transfer.`);

  let heads = []; // { label, people:[member], share: Frac (of estate, before splitting inside the head) }
  if (fw === "Hindu Succession Act, 1956") {
    if (["Mitakshara Coparcenary Property", "Undivided Family Property"].includes(c.NatureOfOwnership)) reasons.push("Coparcenary / undivided family property — s.6 (2005 amendment) needs legal review");
    if (c.DeceasedGender === "Male") {
      const widows = members.filter((m) => rel(m) === "Wife" && alive(m, death));
      const sons = members.filter((m) => rel(m) === "Son" && alive(m, death));
      const daughters = members.filter((m) => rel(m) === "Daughter" && alive(m, death));
      const mother = members.filter((m) => rel(m) === "Mother" && alive(m, death));
      const br = branches(members, death, ["Son", "Daughter"]).map((b) => {
        const livePeople = b.members.filter((x) => alive(x, death));
        if (b.members.some((x) => !alive(x, death) && ["Son of", "Daughter of"].includes(String(x.RelationToRelated)))) reasons.push(`A child of pre-deceased ${b.head.FullName} is also pre-deceased — deeper generations need legal review`);
        return { ...b, live: livePeople.filter((x) => rel(b.head) === "Son" ? true : String(x.RelationToRelated) !== "Husband of") };
      }).filter((b) => b.live.length);
      if (widows.length) heads.push({ label: `Widow${widows.length > 1 ? "s (together)" : ""}`, people: widows });
      sons.forEach((m) => heads.push({ label: "Son", people: [m] }));
      daughters.forEach((m) => heads.push({ label: "Daughter", people: [m] }));
      mother.forEach((m) => heads.push({ label: "Mother", people: [m] }));
      br.forEach((b) => heads.push({ label: `Branch of pre-deceased ${rel(b.head).toLowerCase()} ${b.head.FullName}`, people: b.live }));
      if (!heads.length) reasons.push("No Class I heir found — Class II / agnates / cognates need legal review");
      explanation.push("Hindu Succession Act 1956 s.8 (Class I) with s.10: the widows together take one share; each surviving son, daughter and the mother one share; the branch of each pre-deceased son or daughter one share, divided equally within the branch.");
    } else if (c.DeceasedGender === "Female") {
      const sons = members.filter((m) => rel(m) === "Son" && alive(m, death));
      const daughters = members.filter((m) => rel(m) === "Daughter" && alive(m, death));
      const husband = members.filter((m) => rel(m) === "Husband" && alive(m, death));
      const br = branches(members, death, ["Son", "Daughter"]).map((b) => ({ ...b, live: b.members.filter((x) => alive(x, death) && ["Son of", "Daughter of"].includes(String(x.RelationToRelated))) })).filter((b) => b.live.length);
      if (c.NatureOfOwnership === "Inherited Property" && !sons.length && !daughters.length && !br.length) reasons.push("Property inherited from her parents / husband with no children — s.15(2) needs legal review");
      sons.forEach((m) => heads.push({ label: "Son", people: [m] }));
      daughters.forEach((m) => heads.push({ label: "Daughter", people: [m] }));
      husband.forEach((m) => heads.push({ label: "Husband", people: [m] }));
      br.forEach((b) => heads.push({ label: `Children of pre-deceased ${rel(b.head).toLowerCase()} ${b.head.FullName}`, people: b.live }));
      if (!heads.length) reasons.push("No heir under s.15(1)(a) — s.15(1)(b)–(e) need legal review");
      explanation.push("Hindu Succession Act 1956 s.15(1)(a) with s.16: sons, daughters and the husband take equally; the children of a pre-deceased son or daughter take that child's share together.");
    } else reasons.push("Calculation is configured for male and female deceased only");
    const each = heads.length ? new Frac(1n, BigInt(heads.length)) : null;
    heads = heads.map((h) => ({ ...h, share: each }));
  } else if (fw === "Muslim Personal Law (Shariat)") {
    if (c.PropertyType === "Agricultural") reasons.push("Agricultural land — Muslim Personal Law (Shariat) Application Act 1937 s.2 excludes questions on agricultural land; the West Bengal position must be confirmed by the Legal Officer");
    if (c.SchoolOfLaw !== "Sunni (Hanafi)") reasons.push(`School "${c.SchoolOfLaw || "not set"}" has no configured calculation`);
    const sons = members.filter((m) => rel(m) === "Son" && alive(m, death));
    const daughters = members.filter((m) => rel(m) === "Daughter" && alive(m, death));
    if (!sons.length) reasons.push("No surviving son — fixed shares, return (radd) and other heirs need legal review");
    const spouses = members.filter((m) => rel(m) === (c.DeceasedGender === "Female" ? "Husband" : "Wife") && alive(m, death));
    const father = members.filter((m) => rel(m) === "Father" && alive(m, death));
    const mother = members.filter((m) => rel(m) === "Mother" && alive(m, death));
    let fixed = new Frac(0n);
    if (spouses.length) { const s = c.DeceasedGender === "Female" ? new Frac(1n, 4n) : new Frac(1n, 8n); heads.push({ label: c.DeceasedGender === "Female" ? "Husband (1/4 with children)" : `Wife${spouses.length > 1 ? "s together" : ""} (1/8 with children)`, people: spouses, share: s }); fixed = fixed.add(s); }
    if (father.length) { heads.push({ label: "Father (1/6 with a son)", people: father, share: new Frac(1n, 6n) }); fixed = fixed.add(new Frac(1n, 6n)); }
    if (mother.length) { heads.push({ label: "Mother (1/6 with children)", people: mother, share: new Frac(1n, 6n) }); fixed = fixed.add(new Frac(1n, 6n)); }
    const residue = new Frac(1n).sub(fixed);
    const units = BigInt(sons.length * 2 + daughters.length);
    if (units > 0n) {
      sons.forEach((m) => heads.push({ label: "Son (residue, 2 parts)", people: [m], share: residue.mul(new Frac(2n, units)) }));
      daughters.forEach((m) => heads.push({ label: "Daughter (residue, 1 part)", people: [m], share: residue.mul(new Frac(1n, units)) }));
    }
    explanation.push("Hanafi rules (basic case with a son): spouse fixed share, father 1/6, mother 1/6; the residue goes to sons and daughters, a son taking twice a daughter's share.");
  }

  if (reasons.length) return { outcome: "Requires Legal Review", reasons, lines: [], explanation, total: null, ruleVersion: RULE_VERSION };
  // Split each head among its people equally; scale by the deceased's available share.
  const lines = [];
  heads.forEach((h) => h.people.forEach((p) => {
    const ofEstate = h.share.div(BigInt(h.people.length));
    const ofParcel = ofEstate.mul(avail);
    lines.push({ memberId: p.MemberId, name: p.FullName, relation: rel(p) || String(p.RelationToRelated || ""), head: h.label,
      fractionOfEstate: ofEstate.toString(), pctOfEstate: ofEstate.pct(), fractionOfParcel: ofParcel.toString(), pctOfParcel: ofParcel.pct(), minor: !!p.IsMinor });
  }));
  const total = lines.reduce((a, l) => a.add(l.fractionOfEstate), new Frac(0n));
  explanation.push(`Calculated on the deceased's available share ${avail.toString()} (${avail.pct()} %) of the parcel.`);
  if (!total.eq(1)) explanation.push(`Allocated total is ${total.toString()} of the estate, not 1 — shown as it is, never adjusted; review.`);
  return { outcome: "Calculated", reasons: [], lines, explanation, total: total.toString(), ruleVersion: RULE_VERSION };
}

module.exports = { calculate, Frac, RULE_VERSION };
