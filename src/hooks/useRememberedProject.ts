// A page's project, kept in the address (?project=) so a refresh or a shared
// link opens it, and remembered on this device (localStorage — a per-viewer
// convenience) so opening the page from the menu lands on the project last
// viewed. With just one project it opens that one; a project no longer in
// `projects` (removed, or access lost) is dropped. Storage can be unavailable
// (private window, blocked site data) — the page then simply starts empty.
import { useEffect } from "react";
import { useUrlParam } from "./useUrlParam";

const read = (key: string) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };
const write = (key: string, v: string) => { try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* storage unavailable */ } };

export function useRememberedProject(page: string, projects: { Id: number | string }[]) {
  const key = `last-project:${page}`;
  const [projectId, setUrlProject] = useUrlParam("project");
  const setProjectId = (v: string) => { setUrlProject(v); write(key, v); };

  useEffect(() => {
    if (!projects.length) return;
    const known = (id: string) => projects.some((p) => String(p.Id) === id);
    if (projectId) {
      if (!known(projectId)) setProjectId(projects.length === 1 ? String(projects[0].Id) : "");
      else write(key, projectId);
      return;
    }
    const remembered = read(key);
    if (remembered && known(remembered)) setUrlProject(remembered);
    else if (projects.length === 1) setProjectId(String(projects[0].Id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, projectId]);

  return [projectId, setProjectId] as const;
}
