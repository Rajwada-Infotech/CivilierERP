// RN port of PasswordReset.tsx's avatarGradient/getInitials/roleLabel/
// ROLE_COLORS (web) — web renders a Tailwind gradient class per user;
// RN needs a flat hex, so each gradient collapses to its start color.
const AVATAR_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f43f5e", "#f59e0b", "#06b6d4"];

export function avatarGradientColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: "#a855f7",
  admin: "#3b82f6",
  dba: "#10b981",
  manager: "#f59e0b",
  director: "#f43f5e",
};

export function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "#94a3b8";
}
