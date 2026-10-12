import type { SessionEvent } from "@/api/userActivityApi";

// Turns a raw activity row ("POST /api/dpr-tag-master (from /civilworkdpr/dpr-tag-master)") into words a person
// reads at a glance: "Created DPR Tag Master", on the page it was done from.

const ACRONYMS = new Set(["dpr", "grn", "po", "wo", "jv", "boq", "crm", "gst", "pan", "tan", "emi", "pdc", "mr", "ict", "noc", "qc", "afs", "oc", "cc", "hr", "tds"]);

export function titleFromSlug(slug: string): string {
  return slug
    .replace(/[?#].*$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const isId = (seg: string) => /^\d+$/.test(seg) || /^[0-9a-f]{8}-/i.test(seg);

/** "/civilworkdpr/work-transfer" -> "Work Transfer"; an id on the end is dropped. */
export function pageName(path?: string | null): string {
  if (!path) return "";
  const clean = path.split("?")[0].split("#")[0];
  const segs = clean.split("/").filter(Boolean).filter((s) => !isId(s));
  if (!segs.length) return "Home";
  return titleFromSlug(segs[segs.length - 1]);
}

const VERBS: Record<string, string> = { create: "Created", update: "Updated", delete: "Deleted", export: "Exported", settings_change: "Changed settings in", read: "Opened" };

const STATUS_VERBS: Record<string, string> = {
  approve: "Approved", reject: "Rejected", submit: "Submitted", post: "Posted", close: "Closed",
  disburse: "Disbursed", pay: "Paid", cancel: "Cancelled", restore: "Restored",
};

export interface Described {
  kind: "login" | "logout" | "create" | "update" | "delete" | "export" | "settings_change" | "read";
  verb: string;
  subject: string;
  where: string;
}

export function describeActivity(e: SessionEvent): Described {
  if (e.event === "login") return { kind: "login", verb: "Signed in", subject: "", where: "" };
  if (e.event === "logout") return { kind: "logout", verb: "Signed out", subject: "", where: "" };
  const kind = (e.actionType || "read") as Described["kind"];
  const verb = VERBS[kind] || "Action on";

  if (kind === "read") {
    const nav = /Navigated to (\S+)/.exec(e.details || "");
    const path = nav?.[1] || String(e.resource || e.requestUrl || "").replace(/^[^:/]*:/, "");
    return { kind, verb, subject: pageName(path), where: "" };
  }

  // A write: the API path names what was touched, "(from /page)" says where the person was.
  const api = String(e.requestUrl || e.resource || "").replace(/^\/api\//, "");
  const named = api.split("?")[0].split("/").filter(Boolean).filter((seg) => !isId(seg));
  const last = (named[named.length - 1] || "").toLowerCase();
  const done = STATUS_VERBS[last];
  const subject = titleFromSlug((done ? named.slice(0, -1) : named).slice(0, 2).join(" "));
  const from = /\(from (\S+)\)/.exec(e.details || "")?.[1];
  return { kind, verb: done || verb, subject, where: from ? pageName(from) : "" };
}
