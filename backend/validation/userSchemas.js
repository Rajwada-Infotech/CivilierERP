const { z } = require("zod");
const { optStr, optInt, reqStr, emptyToUndefined } = require("./helpers");

// ── users ─────────────────────────────────────────────────────────────────────
// Verified against users.js + dbo.users column definitions:
//   name               nvarchar(100)  NOT NULL
//   email              nvarchar(150)  NOT NULL
//   password           nvarchar(255)  NOT NULL
//   RoleId             int            NOT NULL
//   can_accept_tickets bit            NOT NULL (route defaults to 0 if absent)
//   discontinue        bit            NULL
//
// POST /  -> { name, email, RoleId, roleId, password, can_accept_tickets }
//            assignedRoleId = Number(RoleId ?? roleId) — at least one required
//            because RoleId is NOT NULL (Number(undefined) -> NaN -> SQL error)
// PUT /:id -> { name, email, RoleId, roleId, discontinue, can_accept_tickets }
//            "toggle-only" branch: ONLY discontinue is sent -> updates
//              discontinue alone, nothing else is touched
//            "full update" branch: triggered whenever any of name/email/
//              RoleId/roleId/can_accept_tickets is present -> name, email,
//              and RoleId/roleId are written directly (NOT NULL columns),
//              so all three must resolve to real values in this branch

const userCreateBaseSchema = z.object({
  name:     reqStr(100, "Name is required"),
  email:    z.string().trim().min(1, "Email is required").email("Valid email is required").max(150),
  password: z.string().min(1, "Password is required"),
  RoleId:   optInt,
  roleId:   optInt, // alias accepted by the route for RoleId
  can_accept_tickets: z.coerce.boolean().optional(),
}).passthrough();

const userCreateSchema = userCreateBaseSchema.refine(
  (data) => data.RoleId !== undefined || data.roleId !== undefined,
  { message: "RoleId is required", path: ["RoleId"] },
);

const userUpdateBaseSchema = z.object({
  name:  optStr(100),
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().email("Valid email required").max(150).optional(),
  ),
  RoleId:             optInt,
  roleId:             optInt, // alias accepted by the route for RoleId
  discontinue:        z.coerce.boolean().optional(),
  can_accept_tickets: z.coerce.boolean().optional(),
}).passthrough();

const userUpdateSchema = userUpdateBaseSchema.refine((data) => {
  const isToggleOnly =
    data.discontinue !== undefined &&
    data.name === undefined &&
    data.email === undefined &&
    data.RoleId === undefined &&
    data.roleId === undefined &&
    data.can_accept_tickets === undefined;

  if (isToggleOnly) return true;

  // Full-update branch: name, email and RoleId/roleId are NOT NULL columns
  // and are written unconditionally in this branch, so all three must be present.
  return (
    typeof data.name === "string" && data.name.length > 0 &&
    typeof data.email === "string" && data.email.length > 0 &&
    (data.RoleId !== undefined || data.roleId !== undefined)
  );
}, {
  message:
    "Provide either { discontinue } alone for a status toggle, or a full update including name, email, and RoleId/roleId",
});

// ── userProfile ───────────────────────────────────────────────────────────────
// Verified against userProfile.js:
//   PATCH /:id/profile          -> destructures { name } only; 400 if !name.trim()
//   POST  /:id/change-password  -> destructures { current_password, new_password }
//                                   (snake_case); both required; new_password >= 6
//   POST  /:id/upload-avatar     -> destructures { avatar } (a base64 data URL
//                                   string, not avatarUrl); required, non-empty.
//                                   Format/size checks (550,000 char max) are
//                                   done in-route, not yet mirrored here.

const profilePatchSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
}).passthrough();

const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password:      z.string().min(6, "New password must be at least 6 characters"),
}).passthrough();

const uploadAvatarSchema = z.object({
  avatar: z.string().min(1, "No avatar data provided"),
}).passthrough();

// ── userRights ────────────────────────────────────────────────────────────────
// Verified against userRights.js PUT /:userId -> destructures { rightsJson },
// only checks Array.isArray(rightsJson). No min-length requirement. Unchanged.

const userRightsSchema = z.object({
  rightsJson: z.array(z.any()),
}).passthrough();

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // users
  userCreateSchema,
  userUpdateSchema,

  // userProfile
  profilePatchSchema,
  changePasswordSchema,
  uploadAvatarSchema,

  // userRights
  userRightsSchema,
};