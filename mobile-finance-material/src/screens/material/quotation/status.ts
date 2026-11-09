// A quotation's status as the sheet shows it: "PartiallyQuoted" reads "Partially quoted"; Quoted and Closed are done,
// Sent and Partially quoted are waiting on suppliers, Draft is graphite.
export const qtStatusLabel = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/ (\w)/g, (_m, c: string) => " " + c.toLowerCase());

export const qtStatusTone = (s?: string | null) =>
  (s === "Quoted" || s === "Closed" ? "done" : s === "Sent" || s === "PartiallyQuoted" ? "waiting" : s === "Rejected" || s === "Cancelled" ? "stopped" : "draft") as
    | "done"
    | "waiting"
    | "stopped"
    | "draft";
