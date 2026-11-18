// Notices from HR for this employee (all employees, or their department). Opening one marks it as read.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pin } from "lucide-react";
import { getMyNotices, markNoticeRead, type MyNotice } from "@/api/employeeNoticeApi";
import { Card, Loading, Note, PageHeader, fmtDate, isViewOnly } from "./employeeUi";

export function NoticeItem({ n, open, onOpen }: { n: MyNotice; open: boolean; onOpen: () => void }) {
  return (
    <li className={`px-4 py-3 ${n.Priority === "Important" ? "border-l-4 border-l-red-500" : ""}`}>
      <button className="w-full text-left" onClick={onOpen} aria-expanded={open}>
        <span className="flex items-center gap-2">
          {!n.IsRead && <span className="w-2 h-2 rounded-full bg-[hsl(var(--ep-gold))] shrink-0" aria-label="Unread" />}
          {n.IsPinned && <Pin size={13} className="shrink-0" />}
          <span className={`text-sm truncate ${n.IsRead ? "font-medium" : "font-bold"}`}>{n.Title}</span>
          {n.Priority === "Important" && <span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-red-600 border border-red-500 rounded px-1.5 shrink-0">Important</span>}
        </span>
        <span className="block text-[0.6875rem] text-muted-foreground mt-0.5">{fmtDate(n.PublishFrom)} · {n.ForWhom} · {n.PostedBy ?? "HR"}</span>
      </button>
      {open && <p className="text-sm mt-2 whitespace-pre-wrap">{n.Body}</p>}
    </li>
  );
}

export function useNotices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ep-notices"], queryFn: getMyNotices, staleTime: 60_000 });
  const read = useMutation({ mutationFn: markNoticeRead, onSuccess: () => qc.invalidateQueries({ queryKey: ["ep-notices"] }) });
  const [openId, setOpenId] = useState<number | null>(null);
  const toggle = (n: MyNotice) => {
    setOpenId((id) => (id === n.NoticeId ? null : n.NoticeId));
    if (!n.IsRead && !isViewOnly()) read.mutate(n.NoticeId);
  };
  return { ...q, openId, toggle };
}

export default function EmployeeNotices() {
  const { data, isLoading, isError, error, openId, toggle } = useNotices();
  const unread = (data ?? []).filter((n) => !n.IsRead).length;
  return (
    <>
      <PageHeader title="Notices" subtitle={unread ? `${unread} unread` : "Announcements from HR"} />
      <Card>
        {isLoading && <Loading />}
        {isError && <Note tone="error">{(error as Error).message}</Note>}
        {data && data.length === 0 && <Note><span className="inline-flex items-center gap-2"><Megaphone size={14} /> No notices right now.</span></Note>}
        {data && data.length > 0 && <ul className="divide-y divide-foreground/15">{data.map((n) => <NoticeItem key={n.NoticeId} n={n} open={openId === n.NoticeId} onOpen={() => toggle(n)} />)}</ul>}
      </Card>
    </>
  );
}
