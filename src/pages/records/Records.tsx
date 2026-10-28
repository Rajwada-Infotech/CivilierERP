import React, { useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell } from "@/components/sheet/Sheet";
import { useRecords, type UnifiedRecord } from "@/hooks/useRecords";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Download,
  Eye,
  RefreshCw,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  Search,
  X,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Folder,
  FolderPlus,
  Upload,
  Trash2,
  Lock,
  KeyRound,
  MoreVertical,
  CheckSquare,
  Square,
  EyeOff,
  Ticket,
  Car,
  PackageCheck,
  Landmark,
  FileSignature,
  FolderLock,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getPersonalVaultFolders,
  uploadToPersonalVault,
  uploadMoreToPersonalVault,
  unlockPersonalVaultFolder,
  setPersonalVaultFolderPassword,
  resetPersonalVaultFolderPassword,
  deletePersonalVaultFile,
  deletePersonalVaultFilesBulk,
  deletePersonalVaultFolder,
  fetchPersonalVaultFile,
  type PersonalVaultFolder,
} from "@/api/personalVaultApi";
import { BodyPortal } from "@/components/ui/body-portal";
import { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, INP } from "@/pages/CRM/customers/config";

// ─── Sheet pieces ────────────────────────────────────────────────────────────

const KEY =
  "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;
const ACT =
  "w-7 h-7 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-40";
const NUM = "font-heading tabular-nums";
const DIALOG = "rounded-none p-5 gap-4 max-w-md";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileIcon(type?: string) {
  if (!type) return <File size={14} className="text-muted-foreground shrink-0" />;
  if (type.startsWith("image/")) return <FileImage size={14} className="text-foreground shrink-0" />;
  if (type.includes("pdf")) return <FileText size={14} className="text-foreground shrink-0" />;
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv"))
    return <FileSpreadsheet size={14} className="text-foreground shrink-0" />;
  return <FileText size={14} className="text-muted-foreground shrink-0" />;
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Every source the server sends (backend/routes/recordsRoutes.js). GRN, the two Loan sources and Contract were
// missing, so their folders had no name and no filter chip.
const MODULE_META: Record<string, { label: string; icon: React.ElementType }> = {
  ticket: { label: "Ticket", icon: Ticket },
  vehicle: { label: "Vehicle In/Out", icon: Car },
  grn: { label: "GRN", icon: PackageCheck },
  "loan-noc": { label: "Loan NOC", icon: Landmark },
  "loan-document": { label: "Loan documents", icon: Landmark },
  contract: { label: "Contract", icon: FileSignature },
  personal: { label: "Personal Vault", icon: FolderLock },
};

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative w-full">
      <input
        type={visible ? "text" : "password"}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`${INP} pr-9`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        className="absolute right-2.5 inset-y-0 my-auto h-5 text-muted-foreground hover:text-foreground transition-colors"
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function ActionButtons({
  record,
  onDelete,
  vaultToken,
  selectMode,
  selected,
  onToggleSelect,
}: {
  record: UnifiedRecord;
  onDelete?: () => void;
  vaultToken?: string | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [loading, setLoading] = useState<"preview" | "download" | "delete" | null>(null);

  const handleAction = async (action: "preview" | "download") => {
    setLoading(action);
    try {
      const res =
        record.source === "personal"
          ? await fetchPersonalVaultFile(record.url, vaultToken)
          : await fetchWithAuth(record.url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(objUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000); // cleanup after a minute
      } else {
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = record.filename;
        a.click();
        URL.revokeObjectURL(objUrl);
      }
    } catch (e: any) {
      toast.error(`Failed to ${action} file: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className={ACT}
          title={selected ? "Deselect" : "Select"}
          aria-pressed={!!selected}
        >
          {selected ? <CheckSquare size={14} className="text-foreground" /> : <Square size={14} />}
        </button>
      )}
      <button data-row-view
        onClick={(e) => {
          e.stopPropagation();
          handleAction("preview");
        }}
        disabled={loading !== null}
        className={ACT}
        title={`Preview ${record.filename}`}
      >
        {loading === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleAction("download");
        }}
        disabled={loading !== null}
        className={ACT}
        title={`Download ${record.filename}`}
      >
        {loading === "download" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm(`Delete "${record.filename}"? This can't be undone.`)) return;
            setLoading("delete");
            Promise.resolve(onDelete()).finally(() => setLoading(null));
          }}
          disabled={loading !== null}
          className={`${ACT} hover:!text-destructive hover:!border-destructive`}
          title={`Delete ${record.filename}`}
        >
          {loading === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      )}
    </div>
  );
}

// ─── Folder tree types ────────────────────────────────────────────────────────

type DocRefGroup = {
  key: string;
  docRef: string;
  docLabel: string;
  files: UnifiedRecord[];
  totalSize: number;
  latestUploadedAt: string;
};

type ModuleGroup = {
  key: string;
  source: string;
  module: string;
  docRefGroups: DocRefGroup[];
  fileCount: number;
  totalSize: number;
  latestUploadedAt: string;
};

function buildFolderTree(records: UnifiedRecord[]): ModuleGroup[] {
  const moduleMap = new Map<string, Map<string, DocRefGroup>>();

  for (const r of records) {
    if (!moduleMap.has(r.source)) moduleMap.set(r.source, new Map());
    const docMap = moduleMap.get(r.source)!;
    const key = `${r.source}::${r.docRef}`;
    if (!docMap.has(key)) {
      docMap.set(key, {
        key,
        docRef: r.docRef,
        docLabel: r.docLabel,
        files: [],
        totalSize: 0,
        latestUploadedAt: r.uploadedAt,
      });
    }
    const group = docMap.get(key)!;
    group.files.push(r);
    group.totalSize += r.size || 0;
    if (new Date(r.uploadedAt).getTime() > new Date(group.latestUploadedAt).getTime()) {
      group.latestUploadedAt = r.uploadedAt;
    }
  }

  const moduleGroups: ModuleGroup[] = [];
  for (const [source, docMap] of moduleMap.entries()) {
    const docRefGroups = Array.from(docMap.values())
      .map((g) => ({
        ...g,
        files: [...g.files].sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        ),
      }))
      .sort(
        (a, b) => new Date(b.latestUploadedAt).getTime() - new Date(a.latestUploadedAt).getTime(),
      );

    const fileCount = docRefGroups.reduce((s, g) => s + g.files.length, 0);
    const totalSize = docRefGroups.reduce((s, g) => s + g.totalSize, 0);
    const latestUploadedAt = docRefGroups[0]?.latestUploadedAt ?? "";
    const moduleLabel = MODULE_META[source]?.label ?? docRefGroups[0]?.files[0]?.module ?? source;

    moduleGroups.push({ key: source, source, module: moduleLabel, docRefGroups, fileCount, totalSize, latestUploadedAt });
  }

  return moduleGroups.sort(
    (a, b) => new Date(b.latestUploadedAt).getTime() - new Date(a.latestUploadedAt).getTime(),
  );
}

// ─── Folder grid view — drill-down like a file browser: root shows one folder card per module, clicking one
// opens a grid of doc-reference folders, clicking one of those opens the actual file list. ─────────────────────

function FolderCard({
  icon: Icon,
  label,
  sublabel,
  count,
  size,
  onClick,
  locked,
  menuItems,
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  count: number;
  size: number;
  onClick: () => void;
  locked?: boolean;
  menuItems?: { label: string; danger?: boolean; onClick: () => void }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      className="group relative flex flex-col items-start gap-3 p-4 bg-card border border-foreground/25 hover:border-foreground transition-colors text-left cursor-pointer focus:outline-none focus-visible:border-foreground"
    >
      {menuItems && menuItems.length > 0 && (
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={ACT}
            title="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <>
              <BodyPortal><div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} /></BodyPortal>
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-44 bg-card z-20 py-1"
                style={{ border: RULE, boxShadow: "4px 4px 0 hsl(var(--foreground) / 0.12)" }}
              >
                {menuItems.map((mi) => (
                  <button
                    key={mi.label}
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      mi.onClick();
                    }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      mi.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-primary/10"
                    }`}
                  >
                    {mi.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex items-center justify-center w-10 h-10 border border-foreground text-foreground">
        <Icon size={18} />
      </div>
      <div className="min-w-0 w-full">
        <p className="text-sm font-heading font-semibold text-foreground truncate flex items-center gap-1.5 pr-6" title={label}>
          {label}
          {locked && <Lock size={11} className="text-muted-foreground shrink-0" aria-label="Locked" />}
        </p>
        {sublabel && (
          <p className="text-xs text-muted-foreground truncate" title={sublabel}>
            {sublabel}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between w-full pt-2 text-[0.6875rem] text-muted-foreground" style={{ borderTop: RULE_SOFT }}>
        <span className={NUM}>
          {count} file{count !== 1 ? "s" : ""}
        </span>
        <span className={NUM}>{formatFileSize(size)}</span>
      </div>
    </div>
  );
}

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function FileRow({
  record,
  onChanged,
  vaultToken,
  selectMode,
  selected,
  onToggleSelect,
  canDelete,
}: {
  record: UnifiedRecord;
  onChanged?: () => void;
  vaultToken?: string | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  canDelete: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${selected ? "bg-primary/5" : "hover:bg-primary/5"}`}>
      {fileIcon(record.mimeType)}
      <span className="text-sm text-foreground truncate min-w-0 flex-1 sm:flex-none sm:max-w-[260px]" title={record.filename}>
        {record.filename}
      </span>
      {record.pendingDeletion && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em] text-destructive border border-destructive whitespace-nowrap"
          title="The source document was deleted — this file is auto-purged after a 7-day grace period"
        >
          Deleted · purges in {record.purgeAt ? daysUntil(record.purgeAt) : "?"}d
        </span>
      )}
      <span className={`${NUM} text-xs text-muted-foreground whitespace-nowrap`}>{formatFileSize(record.size)}</span>
      <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap truncate max-w-[140px]">
        {record.uploadedBy || "—"}
      </span>
      <span className={`hidden md:inline ${NUM} text-xs text-muted-foreground whitespace-nowrap`}>
        {record.uploadedAt ? format(new Date(record.uploadedAt), "dd/MM/yyyy HH:mm") : "—"}
      </span>
      <div className="ml-auto shrink-0">
        <ActionButtons
          record={record}
          vaultToken={vaultToken}
          selectMode={selectMode && record.source === "personal"}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onDelete={
            record.source === "personal" && canDelete
              ? async () => {
                  try {
                    await deletePersonalVaultFile(record.sourceId, vaultToken);
                    toast.success("File deleted");
                    onChanged?.();
                  } catch (e: any) {
                    toast.error(e.message || "Failed to delete file");
                  }
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function AddFilesButton({
  folderName,
  onUploaded,
  vaultToken,
}: {
  folderName: string;
  onUploaded?: () => void;
  vaultToken?: string | null;
}) {
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      await uploadMoreToPersonalVault(folderName, files, vaultToken);
      toast.success(`${files.length} file${files.length !== 1 ? "s" : ""} added`);
      onUploaded?.();
    } catch (e: any) {
      toast.error(e.message || "Failed to upload files");
    } finally {
      setUploading(false);
    }
  };

  return (
    <label className={`${KEY_INK} h-8 px-3 cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
      {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
      {uploading ? "Uploading…" : "Add files"}
      <input
        type="file"
        multiple
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

// ─── Personal Vault — folder unlock screen ─────────────────────────────────

function VaultUnlockPanel({
  folderName,
  onUnlocked,
}: {
  folderName: string;
  onUnlocked: (token: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleUnlock = async () => {
    if (!password) return;
    setBusy(true);
    try {
      const { token } = await unlockPersonalVaultFolder(folderName, password);
      toast.success("Folder unlocked");
      onUnlocked(token);
    } catch (e: any) {
      toast.error(e.message || "Wrong password");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!accountPassword || !newPassword) {
      toast.error("Fill in both fields");
      return;
    }
    setBusy(true);
    try {
      const { token } = await resetPersonalVaultFolderPassword(folderName, accountPassword, newPassword);
      toast.success("Password reset");
      if (token) onUnlocked(token);
      setForgotOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
      <div className="flex items-center justify-center w-11 h-11 border border-foreground text-foreground">
        <Lock size={18} />
      </div>
      <p className={LBL}>Password-protected</p>
      <p className="text-sm font-heading font-semibold text-foreground -mt-1">{folderName}</p>
      {!forgotOpen ? (
        <>
          <div className="flex items-center gap-2 mt-1 w-full max-w-sm">
            <PasswordInput
              autoFocus
              value={password}
              onChange={setPassword}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Folder password"
            />
            <button onClick={handleUnlock} disabled={busy || !password} className={`${KEY_INK} h-9 px-4 shrink-0`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
              Unlock
            </button>
          </div>
          <button
            onClick={() => setForgotOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Forgot password?
          </button>
        </>
      ) : (
        <div className="flex flex-col items-stretch gap-2 mt-1 w-full max-w-xs">
          <p className="text-xs text-muted-foreground">Verify your account password to reset this folder's password.</p>
          <PasswordInput value={accountPassword} onChange={setAccountPassword} placeholder="Your account password" />
          <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="New folder password" />
          <div className="flex items-center gap-2 mt-1">
            <button onClick={() => setForgotOpen(false)} className={`${KEY_LINE} h-9 flex-1`}>
              Back
            </button>
            <button onClick={handleReset} disabled={busy} className={`${KEY_INK} h-9 flex-1`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : "Reset"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Personal Vault — set/change password dialog ───────────────────────────

function VaultSetPasswordDialog({
  open,
  folderName,
  hasPassword,
  vaultToken,
  onClose,
  onSaved,
}: {
  open: boolean;
  folderName: string;
  hasPassword: boolean;
  vaultToken?: string | null;
  onClose: () => void;
  onSaved: (token: string | null) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setNewPassword("");
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { token } = await setPersonalVaultFolderPassword(folderName, newPassword || null, vaultToken);
      toast.success(newPassword ? "Password set" : "Password removed");
      onSaved(token ?? null);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={`${DIALOG} max-w-sm`} style={{ border: RULE }}>
        <DialogHeader>
          <p className={LBL}>Personal vault · {folderName}</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight">
            {hasPassword ? "Change password" : "Set password"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {hasPassword ? "Leave it blank and save to remove the password." : "You'll need it — or your account password — to open this folder."}
          </DialogDescription>
        </DialogHeader>
        <PasswordInput
          autoFocus
          value={newPassword}
          onChange={setNewPassword}
          placeholder={hasPassword ? "New password (blank to remove)" : "New password"}
        />
        <div className="flex justify-end gap-2 pt-4" style={{ borderTop: RULE_SOFT }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-4`}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordsFolderBrowser({
  records,
  searchActive,
  onChanged,
  rights,
}: {
  records: UnifiedRecord[];
  searchActive: boolean;
  onChanged?: () => void;
  rights: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}) {
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [docRefKey, setDocRefKey] = useState<string | null>(null);

  // Personal Vault folder metadata (HasPassword) + session-only unlock
  // tokens, keyed by folder name. Tokens are never persisted — a reload
  // re-locks any protected folder, which is the point of a lock.
  const [vaultFolders, setVaultFolders] = useState<PersonalVaultFolder[]>([]);
  const [vaultTokens, setVaultTokens] = useState<Record<string, string>>({});
  const [passwordDialogFolder, setPasswordDialogFolder] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Said out loud when it fails: without it a protected folder can't show as locked.
  const refreshVaultFolders = () => {
    getPersonalVaultFolders()
      .then(setVaultFolders)
      .catch((e) => toast.error(e?.message || "Couldn't load your Personal Vault folders"));
  };

  useEffect(() => {
    refreshVaultFolders();
  }, []);

  const tree = useMemo(() => buildFolderTree(records), [records]);

  const currentModule = moduleKey ? tree.find((m) => m.key === moduleKey) : null;
  const currentDocRef =
    currentModule && docRefKey
      ? currentModule.docRefGroups.find((d) => d.key === docRefKey)
      : null;

  const vaultMeta = currentDocRef
    ? vaultFolders.find((f) => f.FolderName === currentDocRef.docRef)
    : null;
  const currentToken = currentDocRef ? vaultTokens[currentDocRef.docRef] : undefined;
  const isLocked = !!(currentModule?.source === "personal" && vaultMeta?.HasPassword && !currentToken);

  // Reset dangling selections if the underlying data changed underneath
  // (e.g. a refresh removed the module/doc-ref currently drilled into).
  useEffect(() => {
    if (moduleKey && !currentModule) {
      setModuleKey(null);
      setDocRefKey(null);
    } else if (docRefKey && currentModule && !currentDocRef) {
      setDocRefKey(null);
    }
  }, [moduleKey, docRefKey, currentModule, currentDocRef]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [docRefKey]);

  const handleChanged = () => {
    onChanged?.();
    refreshVaultFolders();
  };

  // Mid-search, folder navigation doesn't make sense (matches can span
  // every module/doc) — drop straight to a flat list of matching files.
  if (searchActive) {
    const flat = [...records].sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
    return (
      <div className="divide-y divide-foreground/10">
        {flat.map((r) => (
          <FileRow
            key={r.id}
            record={r}
            onChanged={handleChanged}
            vaultToken={r.source === "personal" ? vaultTokens[r.docRef] : undefined}
            canDelete={rights.canDelete}
          />
        ))}
      </div>
    );
  }

  const crumbs: { label: string; onClick: () => void }[] = [
    { label: "All attachments", onClick: () => { setModuleKey(null); setDocRefKey(null); } },
  ];
  if (currentModule) {
    crumbs.push({ label: currentModule.module, onClick: () => setDocRefKey(null) });
  }
  if (currentDocRef) {
    crumbs.push({ label: currentDocRef.docRef, onClick: () => {} });
  }

  const goBack = () => {
    if (currentDocRef) setDocRefKey(null);
    else if (currentModule) setModuleKey(null);
  };

  const handleDeleteFolder = async (folderName: string, token?: string | null) => {
    if (!window.confirm(`Delete the entire "${folderName}" folder and all its files? This can't be undone.`)) return;
    try {
      await deletePersonalVaultFolder(folderName, token);
      toast.success(`"${folderName}" deleted`);
      setDocRefKey(null);
      handleChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete folder — unlock it first if it's protected");
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected file${selectedIds.size !== 1 ? "s" : ""}? This can't be undone.`)) return;
    setBulkDeleting(true);
    try {
      await deletePersonalVaultFilesBulk(Array.from(selectedIds), currentToken);
      toast.success(`${selectedIds.size} file${selectedIds.size !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      handleChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete files");
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div>
      {/* Breadcrumb trail */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 text-xs overflow-x-auto" style={{ borderBottom: RULE_SOFT }}>
        {currentModule && (
          <button onClick={goBack} title="Back" aria-label="Back" className={`${ACT} mr-0.5 shrink-0`}>
            <ArrowLeft size={14} />
          </button>
        )}
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={12} className="text-muted-foreground/50 shrink-0" />}
            <button
              onClick={c.onClick}
              disabled={i === crumbs.length - 1}
              className={`whitespace-nowrap font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
                i === crumbs.length - 1 ? "text-foreground cursor-default" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="p-4">
        {!currentModule ? (
          tree.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No attachments yet.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {tree.map((mg) => (
                <FolderCard
                  key={mg.key}
                  icon={MODULE_META[mg.source]?.icon ?? File}
                  label={mg.module}
                  count={mg.fileCount}
                  size={mg.totalSize}
                  onClick={() => setModuleKey(mg.key)}
                />
              ))}
            </div>
          )
        ) : !currentDocRef ? (
          currentModule.docRefGroups.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">This folder is empty.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {currentModule.docRefGroups.map((dg) => {
                const isPersonal = currentModule.source === "personal";
                const meta = isPersonal ? vaultFolders.find((f) => f.FolderName === dg.docRef) : null;
                const token = vaultTokens[dg.docRef];
                const menu = isPersonal
                  ? [
                      ...(rights.canEdit
                        ? [{ label: meta?.HasPassword ? "Change password" : "Set password", onClick: () => setPasswordDialogFolder(dg.docRef) }]
                        : []),
                      ...(rights.canDelete
                        ? [{ label: "Delete folder", danger: true, onClick: () => handleDeleteFolder(dg.docRef, token) }]
                        : []),
                    ]
                  : undefined;
                return (
                  <FolderCard
                    key={dg.key}
                    icon={Folder}
                    label={dg.docRef}
                    sublabel={dg.docLabel !== dg.docRef ? dg.docLabel : undefined}
                    count={dg.files.length}
                    size={dg.totalSize}
                    locked={isPersonal && !!meta?.HasPassword && !token}
                    onClick={() => setDocRefKey(dg.key)}
                    menuItems={menu}
                  />
                );
              })}
            </div>
          )
        ) : isLocked ? (
          <VaultUnlockPanel
            folderName={currentDocRef.docRef}
            onUnlocked={(token) => setVaultTokens((prev) => ({ ...prev, [currentDocRef.docRef]: token }))}
          />
        ) : (
          <div className="space-y-3">
            {currentModule.source === "personal" && (rights.canCreate || rights.canEdit || rights.canDelete) && (
              <div className="flex items-center gap-2 flex-wrap">
                {rights.canCreate && (
                  <AddFilesButton folderName={currentDocRef.docRef} onUploaded={handleChanged} vaultToken={currentToken} />
                )}
                {rights.canEdit && (
                  <button onClick={() => setPasswordDialogFolder(currentDocRef.docRef)} className={`${KEY_LINE} h-8 px-3`}>
                    <KeyRound size={12} />
                    {vaultMeta?.HasPassword ? "Change password" : "Set password"}
                  </button>
                )}
                {rights.canDelete && selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className={`${KEY} h-8 px-3 border border-destructive text-destructive hover:bg-destructive/10`}
                  >
                    {bulkDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Delete {selectedIds.size} selected
                  </button>
                )}
              </div>
            )}
            <div className="divide-y divide-foreground/10" style={{ border: RULE_SOFT }}>
              {currentDocRef.files.map((r) => (
                <FileRow
                  key={r.id}
                  record={r}
                  onChanged={handleChanged}
                  vaultToken={currentToken}
                  selectMode={currentModule.source === "personal" && rights.canDelete}
                  selected={selectedIds.has(r.sourceId)}
                  onToggleSelect={() => toggleSelect(r.sourceId)}
                  canDelete={rights.canDelete}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <VaultSetPasswordDialog
        open={!!passwordDialogFolder}
        folderName={passwordDialogFolder || ""}
        hasPassword={!!vaultFolders.find((f) => f.FolderName === passwordDialogFolder)?.HasPassword}
        vaultToken={passwordDialogFolder ? vaultTokens[passwordDialogFolder] : undefined}
        onClose={() => setPasswordDialogFolder(null)}
        onSaved={(token) => {
          if (!passwordDialogFolder) return;
          setVaultTokens((prev) => {
            const next = { ...prev };
            if (token) next[passwordDialogFolder] = token;
            else delete next[passwordDialogFolder];
            return next;
          });
          refreshVaultFolders();
        }}
      />
    </div>
  );
}

// ─── New Folder dialog — Personal Vault ────────────────────────────────────────
// Private, per-user storage for files unrelated to any project record —
// any format (images, PDFs, Office docs, CSV, etc). A "folder" is created
// implicitly the first time a file is uploaded under that name.

function NewFolderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [folderName, setFolderName] = useState("");
  const [password, setPassword] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // Deliberately NOT reset via a useEffect keyed on `open` — that pattern
  // clears the form on every re-render where the dialog happens to still be
  // open (e.g. a records refresh firing mid-fill), wiping what the user just
  // typed before they'd even clicked Create. Reset only on the two actions
  // that actually end the "filling in a folder" session: a successful create,
  // or an explicit cancel.
  const resetForm = () => {
    setFolderName("");
    setPassword("");
    setFiles([]);
  };

  const handleCreate = async () => {
    const name = folderName.trim();
    if (!name) {
      toast.error("Give the folder a name — e.g. \"XYZ Vault\"");
      return;
    }
    if (files.length === 0) {
      toast.error("Pick at least one file to create the folder with");
      return;
    }
    setSaving(true);
    try {
      await uploadToPersonalVault(name, files, password.trim() || undefined);
      toast.success(`"${name}" created`);
      onCreated();
      resetForm();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to create folder");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className={DIALOG} style={{ border: RULE }}>
        <DialogHeader>
          <p className={LBL}>Personal vault</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight">New folder</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Private to you — unrelated to any project record. Any file type is accepted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="pv-folder-name" className={`${LBL} block mb-1.5`}>Folder name</label>
            <input
              id="pv-folder-name"
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. XYZ Vault"
              className={INP}
            />
          </div>
          <div>
            <p className={`${LBL} mb-1.5`}>
              Password <span className="normal-case tracking-normal font-normal">(optional)</span>
            </p>
            <PasswordInput value={password} onChange={setPassword} placeholder="Leave blank for no password" />
            <p className="text-[0.6875rem] text-muted-foreground mt-1">
              You'll need it — or your account password to reset it — to open this folder later.
            </p>
          </div>
          <div>
            <p className={`${LBL} mb-1.5`}>Files</p>
            <label className={`${KEY_LINE} h-9 px-3 cursor-pointer`}>
              <Upload size={12} /> {files.length ? "Choose other files" : "Choose files"}
              <input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </label>
            {files.length > 0 && (
              <p className={`${NUM} text-[0.6875rem] text-muted-foreground mt-1.5`}>
                {files.length} file{files.length !== 1 ? "s" : ""} selected · {formatFileSize(files.reduce((s, f) => s + f.size, 0))}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4" style={{ borderTop: RULE_SOFT }}>
          <button onClick={handleCancel} className={`${KEY_LINE} h-9 px-4`}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={saving} className={`${KEY_INK} h-9 px-4`}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {saving ? "Uploading…" : "Create folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Records() {
  const rights = usePageRights("records");
  const { records, failedSources, loading, error, refreshRecords } = useRecords();
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const counts = useMemo(() => {
    const byModule: Record<string, number> = {};
    for (const r of records) byModule[r.source] = (byModule[r.source] ?? 0) + 1;
    return byModule;
  }, [records]);

  const filteredByModule = useMemo(
    () => (moduleFilter ? records.filter((r) => r.source === moduleFilter) : records),
    [records, moduleFilter],
  );

  // Search across doc ref, reference label, filename, module, and uploader —
  // layered on top of the module filter.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByModule;
    return filteredByModule.filter((r) =>
      [r.docRef, r.docLabel, r.filename, r.module, r.uploadedBy ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [filteredByModule, search]);

  const totalSize = records.reduce((s, r) => s + (r.size || 0), 0);

  const figures = [
    { label: "Total files", value: String(records.length), note: `${Object.keys(counts).length} sources` },
    { label: "Tickets", value: String(counts.ticket ?? 0), note: "ticket attachments" },
    { label: "Vehicle In/Out", value: String(counts.vehicle ?? 0), note: "gate photos and papers" },
    { label: "Storage used", value: formatFileSize(totalSize), note: "across everything listed" },
  ];
  // Filter chips: only sources that have something to show (plus the one selected, so it can be cleared).
  const chipKeys = Object.keys(MODULE_META).filter((k) => (counts[k] ?? 0) > 0 || moduleFilter === k);

  return (
    <>
      <Breadcrumbs items={["Records"]} />
      <SheetShell
        eyebrow="CivilierERP · Records"
        title="Records"
        subtitle="Every attachment across the ERP — tickets, vehicle entries, GRNs, loans, contracts — and your own Personal Vault, in one searchable place."
        action={
          <div className="flex items-center gap-2">
            {rights.canCreate && (
              <button onClick={() => setNewFolderOpen(true)} className={`${KEY_INK} h-9 px-4`}>
                <FolderPlus size={12} /> New folder
              </button>
            )}
            <button onClick={refreshRecords} className={`${KEY_LINE} h-9 w-9`} title="Refresh" aria-label="Refresh">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{loading ? "…" : x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            Couldn't load records: {error}
          </div>
        )}
        {failedSources.length > 0 && (
          <div className="px-4 py-2.5 text-xs bg-card" style={{ border: RULE, boxShadow: "inset 3px 0 0 hsl(var(--destructive))" }}>
            Some attachments couldn't be loaded ({failedSources.map((k) => MODULE_META[k]?.label ?? k).join(", ")}) — the
            rest are listed. Refresh to try again.
          </div>
        )}

        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
              All attachments <span className={`${NUM} font-normal text-muted-foreground ml-1`}>{searched.length}</span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setModuleFilter(null)} aria-pressed={moduleFilter === null} className={chip(moduleFilter === null)}>
                All
              </button>
              {chipKeys.map((key) => (
                <button
                  key={key}
                  onClick={() => setModuleFilter(moduleFilter === key ? null : key)}
                  aria-pressed={moduleFilter === key}
                  className={chip(moduleFilter === key)}
                >
                  {MODULE_META[key].label} <span className={NUM}>{counts[key] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Search — doc ref, filename, module, uploader */}
          <div className="px-4 py-3" style={{ borderBottom: RULE_SOFT }}>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 inset-y-0 my-auto text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by document number, filename, module, or uploader…"
                className={`${INP} pl-8 pr-8`}
                aria-label="Search attachments"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 inset-y-0 my-auto h-5 text-muted-foreground hover:text-foreground"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading records…</div>
          ) : searched.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {records.length === 0
                ? "No attachments yet. Files uploaded in Tickets, Vehicle In/Out, GRNs, Loans, Contracts or your Personal Vault appear here automatically."
                : "No attachments match your search."}
            </div>
          ) : (
            <RecordsFolderBrowser
              records={searched}
              searchActive={search.trim().length > 0}
              onChanged={refreshRecords}
              rights={{ canCreate: rights.canCreate, canEdit: rights.canEdit, canDelete: rights.canDelete }}
            />
          )}
        </div>
      </SheetShell>
      <NewFolderDialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)} onCreated={refreshRecords} />
    </>
  );
}
