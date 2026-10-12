import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// A booking belongs to all its applicants: the main applicant (Applicant 1)
// and the co-applicants (Applicant 2, 3 …). Everywhere a CRM record names its
// buyer it reads "Mr. Roy & Mrs. Roy" — the main applicant at full strength,
// the co-applicants following in a softer tone so the order stays clear.

type NamesMap = { byApplication: Record<string, string[]>; byBooking: Record<string, string[]> };

export function useCoApplicantNames() {
  return useQuery<NamesMap>({
    queryKey: ["crm-co-applicant-names"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/crm/co-applicants/names");
      if (!r.ok) return { byApplication: {}, byBooking: {} };
      return r.json();
    },
    staleTime: 60_000,
  });
}

/** The co-applicants of a booking / application (Applicant 2, 3 …), main applicant excluded. */
export function coApplicantsOf(map: NamesMap | undefined, ids: { bookingId?: number | null; applicationId?: number | null }, mainName?: string | null): string[] {
  if (!map) return [];
  const list = (ids.bookingId != null && map.byBooking[String(ids.bookingId)])
    || (ids.applicationId != null && map.byApplication[String(ids.applicationId)]) || [];
  const main = String(mainName || "").trim().toLowerCase();
  return list.filter((n) => n.trim().toLowerCase() !== main);
}

/** Plain text — "Mr. Roy & Mrs. Roy" — for exports, titles and search. */
export function applicantNamesText(mainName: string | null | undefined, others: string[]): string {
  return [mainName || "—", ...others].join(" & ");
}

export function ApplicantNames({
  name, bookingId, applicationId, className = "",
}: { name: string | null | undefined; bookingId?: number | null; applicationId?: number | null; className?: string }) {
  const { data } = useCoApplicantNames();
  const others = coApplicantsOf(data, { bookingId, applicationId }, name);
  return (
    <span className={className} title={others.length ? applicantNamesText(name, others) : undefined}>
      <span>{name || "—"}</span>
      {others.map((o) => (
        <span key={o} className="font-normal opacity-60">
          <span className="opacity-70"> &amp; </span>{o}
        </span>
      ))}
    </span>
  );
}
