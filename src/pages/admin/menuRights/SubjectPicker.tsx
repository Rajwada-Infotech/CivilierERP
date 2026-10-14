import { Search, ChevronDown, Check, Users } from "lucide-react";
import type { MenuRightsState } from "./useMenuRights";

// Choosing whose rights are being edited: a role's baseline, or one user's own.
export function SubjectPicker({ m }: { m: MenuRightsState }) {
  const { subject, users, selectedUserId, setSelectedUserId, dropdownOpen, setDropdownOpen, userSearch, setUserSearch, roles, selectedRoleId, setSelectedRoleId, roleDropdownOpen, setRoleDropdownOpen, roleSearch, setRoleSearch, loadingRoles, loadingUsers, selectedUser, selectedRole, switchSubject, dropdownRef, roleDropdownRef, filteredUsers, filteredRoles } = m;
  return (
    <>
      {/* ── Subject Selector Card ────────────────────────────────────────── */}
      <div
        className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm p-5 relative"
        style={{ zIndex: 40 }}
      >
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center gap-2 text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="w-3.5 h-3.5" />
            {subject === "user" ? "Select User" : "Select Role"}
          </label>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted border border-border w-fit">
            <button
              onClick={() => switchSubject("role")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                subject === "role"
                  ? "bg-card shadow text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Role-wise
            </button>
            <button
              onClick={() => switchSubject("user")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                subject === "user"
                  ? "bg-card shadow text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Custom User-wise
            </button>
          </div>
        </div>
        {subject === "role" && (
          <p className="text-xs text-muted-foreground/70 mb-3">
            Sets the baseline every user with this role inherits, effective immediately — a user's own overrides (Custom User-wise) take full precedence over this for any page they touch, whether that's granting more or restricting less.
          </p>
        )}

        {subject === "user" ? (
          <div className="relative w-full max-w-sm" ref={dropdownRef}>
            {/* Trigger button */}
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-muted hover:border-primary/60 transition-all text-sm font-body"
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
                  <span className="text-[0.625rem] font-heading px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {selectedUser.role}
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
              <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                <div className="p-2.5 border-b border-border bg-muted/40">
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
                      className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
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
                          className="w-full px-4 py-2.5 text-left hover:bg-muted/60 flex justify-between items-center transition-colors"
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
                            <Check size={14} className="text-primary" />
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
          <div className="relative w-full max-w-sm" ref={roleDropdownRef}>
            {/* Trigger button */}
            <button
              onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-muted hover:border-primary/60 transition-all text-sm font-body"
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
              <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                <div className="p-2.5 border-b border-border bg-muted/40">
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
                      className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
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
                          className="w-full px-4 py-2.5 text-left hover:bg-muted/60 flex justify-between items-center transition-colors"
                        >
                          <div className="text-sm font-medium text-foreground">
                            {r.RName}
                          </div>
                          {selectedRoleId === r.RId && (
                            <Check size={14} className="text-primary" />
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
