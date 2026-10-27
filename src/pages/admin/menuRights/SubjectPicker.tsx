import { Search, ChevronDown, Check, Users } from "lucide-react";
import type { MenuRightsState } from "./useMenuRights";

// Choosing whose rights are being edited: a role's baseline, or one user's own.
export function SubjectPicker({ m }: { m: MenuRightsState }) {
  const { subject, isAdminTier, users, selectedUserId, setSelectedUserId, dropdownOpen, setDropdownOpen, userSearch, setUserSearch, roles, selectedRoleId, setSelectedRoleId, roleDropdownOpen, setRoleDropdownOpen, roleSearch, setRoleSearch, loadingRoles, loadingUsers, selectedUser, selectedRole, switchSubject, dropdownRef, roleDropdownRef, filteredUsers, filteredRoles } = m;
  return (
    <>
      {/* ── Subject Selector Card ────────────────────────────────────────── */}
      <div
        className="bg-card border border-foreground relative"
        style={{ zIndex: 40 }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-foreground">
          <label className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
            {subject === "user" ? "Choose a person" : "Choose a role"}
          </label>
          <div className="inline-flex items-stretch border border-foreground w-fit">
            <button
              onClick={() => switchSubject("role")}
              className={`h-8 px-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                subject === "role" ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Role-wise
            </button>
            {isAdminTier && (
              <button
                onClick={() => switchSubject("user")}
                className={`h-8 px-3 border-l border-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  subject === "user" ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Custom user-wise
              </button>
            )}
          </div>
        </div>
        {subject === "role" && (
          <p className="text-xs text-muted-foreground px-4 pt-3 max-w-prose">
            Sets the baseline every user with this role inherits, effective immediately — a user's own overrides (Custom User-wise) take full precedence over this for any page they touch, whether that's granting more or restricting less.
          </p>
        )}

        {subject === "user" ? (
          <div className="relative w-full max-w-sm m-4" ref={dropdownRef}>
            {/* Trigger button */}
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full h-10 flex items-center justify-between px-3 border border-foreground/40 hover:border-foreground bg-card transition-colors text-sm"
            >
              <span
                className={
                  selectedUser
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }
              >
                {loadingUsers
                  ? "Loading users…"
                  : selectedUser
                    ? selectedUser.name
                    : "Choose a user…"}
              </span>
              <div className="flex items-center gap-2">
                {selectedUser && (
                  <span className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap text-foreground border-foreground/40 capitalize">
                    {selectedUser.role.replace(/_/g, " ")}
                  </span>
                )}
                <ChevronDown
                  size={15}
                  className={`text-muted-foreground transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {/* Dropdown panel */}
            {dropdownOpen && (
              <div className="absolute z-50 mt-1 w-full border border-foreground bg-card overflow-hidden" style={{ boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" }}>
                <div className="p-2 border-b border-foreground">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      autoFocus
                      placeholder="Search user…"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="w-full h-8 pl-8 pr-3 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                  </div>
                </div>
                <ul className="max-h-60 overflow-auto py-1">
                  {filteredUsers.length === 0 ? (
                    <li className="px-4 py-3 text-sm text-muted-foreground text-center">
                      No users found
                    </li>
                  ) : (
                    filteredUsers.map((u) => (
                      <li key={u.id}>
                        <button
                          onClick={() => {
                            setSelectedUserId(u.id);
                            setDropdownOpen(false);
                            setUserSearch("");
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-primary/5 flex justify-between items-center border-b border-foreground/10 transition-colors"
                        >
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              {u.name}
                            </div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {u.role.replace(/_/g, " ")}
                            </div>
                          </div>
                          {selectedUserId === u.id && (
                            <Check size={14} className="text-foreground" />
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="relative w-full max-w-sm m-4" ref={roleDropdownRef}>
            {/* Trigger button */}
            <button
              onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
              className="w-full h-10 flex items-center justify-between px-3 border border-foreground/40 hover:border-foreground bg-card transition-colors text-sm"
            >
              <span
                className={
                  selectedRole
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }
              >
                {loadingRoles
                  ? "Loading roles…"
                  : selectedRole
                    ? selectedRole.RName
                    : "Choose a role…"}
              </span>
              <ChevronDown
                size={15}
                className={`text-muted-foreground transition-transform duration-200 ${roleDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* Dropdown panel */}
            {roleDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full border border-foreground bg-card overflow-hidden" style={{ boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" }}>
                <div className="p-2 border-b border-foreground">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      autoFocus
                      placeholder="Search role…"
                      value={roleSearch}
                      onChange={(e) => setRoleSearch(e.target.value)}
                      className="w-full h-8 pl-8 pr-3 text-sm bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                    />
                  </div>
                </div>
                <ul className="max-h-60 overflow-auto py-1">
                  {filteredRoles.length === 0 ? (
                    <li className="px-4 py-3 text-sm text-muted-foreground text-center">
                      No roles found
                    </li>
                  ) : (
                    filteredRoles.map((r) => (
                      <li key={r.RId}>
                        <button
                          onClick={() => {
                            setSelectedRoleId(r.RId);
                            setRoleDropdownOpen(false);
                            setRoleSearch("");
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-primary/5 flex justify-between items-center border-b border-foreground/10 transition-colors"
                        >
                          <div className="text-sm font-medium text-foreground">
                            {r.RName}
                          </div>
                          {selectedRoleId === r.RId && (
                            <Check size={14} className="text-foreground" />
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
