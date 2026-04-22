import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserRecord {
  id: number;
  name: string;
  email: string;
}

// email → display name map
type UserMap = Record<string, string>;

// ─── Hook ─────────────────────────────────────────────────────────────────────
// Usage:
//   const resolveUser = useUserMap();
//   <td>{resolveUser(row.createdBy)}</td>
//
// If the email exists in the users list → shows "Rahul Sharma"
// If not found (deleted user, external actor) → falls back to the raw email
// If null/undefined → shows "—"

export function useUserMap(): (email: string | null | undefined) => string {
  const [map, setMap] = useState<UserMap>({});

  useEffect(() => {
    let cancelled = false;

    fetchWithAuth("/api/users")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch users");
        return res.json();
      })
      .then((users: UserRecord[]) => {
        if (cancelled) return;
        const built: UserMap = {};
        users.forEach((u) => {
          if (u.email) built[u.email.toLowerCase()] = u.name || u.email;
        });
        setMap(built);
      })
      .catch(() => {
        // Silently fail — fallback to raw email in resolveUser
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Resolver function returned to the component
  return (email: string | null | undefined): string => {
    if (!email) return "—";
    return map[email.toLowerCase()] ?? email; // fallback: show raw email
  };
}
