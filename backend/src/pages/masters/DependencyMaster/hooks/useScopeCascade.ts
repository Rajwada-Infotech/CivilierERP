import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getProjectOptions,
  getTowerOptions,
  getFloorOptions,
  getFlatOptions,
  getRoomOptions,
  type ScopeOption,
  type DependencyScope,
} from "@/api/dependencyMasterApi";

export interface ScopeSelection {
  projectId: number | null;
  towerId: number | null;
  floor: string | null;
  flatId: number | null;
  roomId: number | null;
}

const EMPTY: ScopeSelection = {
  projectId: null,
  towerId: null,
  floor: null,
  flatId: null,
  roomId: null,
};

/**
 * Drives the Project -> Tower -> Floor -> Flat -> Room cascade: each level's
 * options only load once its parent is picked, and picking a level clears
 * everything below it (a new Tower invalidates whatever Floor/Flat/Room was
 * chosen under the old one).
 */
export function useScopeCascade(initial?: Partial<ScopeSelection>) {
  const [selection, setSelection] = useState<ScopeSelection>({ ...EMPTY, ...initial });

  const projectsQ = useQuery({ queryKey: ["dep-scope-projects"], queryFn: getProjectOptions });
  const towersQ = useQuery({
    queryKey: ["dep-scope-towers", selection.projectId],
    queryFn: () => getTowerOptions(selection.projectId as number),
    enabled: !!selection.projectId,
  });
  const floorsQ = useQuery({
    queryKey: ["dep-scope-floors", selection.towerId],
    queryFn: () => getFloorOptions(selection.towerId as number),
    enabled: !!selection.towerId,
  });
  const flatsQ = useQuery({
    queryKey: ["dep-scope-flats", selection.towerId, selection.floor],
    queryFn: () => getFlatOptions(selection.towerId as number, selection.floor as string),
    enabled: !!selection.towerId && !!selection.floor,
  });
  const roomsQ = useQuery({
    queryKey: ["dep-scope-rooms", selection.flatId, selection.floor],
    queryFn: () => getRoomOptions(selection.flatId as number, selection.floor as string),
    enabled: !!selection.flatId && !!selection.floor,
  });

  const setProject = (id: number | null) =>
    setSelection({ ...EMPTY, projectId: id });
  const setTower = (id: number | null) =>
    setSelection((s) => ({ ...s, towerId: id, floor: null, flatId: null, roomId: null }));
  const setFloor = (floor: string | null) =>
    setSelection((s) => ({ ...s, floor, flatId: null, roomId: null }));
  const setFlat = (id: number | null) =>
    setSelection((s) => ({ ...s, flatId: id, roomId: null }));
  const setRoom = (id: number | null) => setSelection((s) => ({ ...s, roomId: id }));

  // Re-sync when a caller passes fresh `initial` values (e.g. opening the
  // form to edit an existing record after its own data has loaded).
  useEffect(() => {
    if (initial && initial.projectId) setSelection({ ...EMPTY, ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.projectId, initial?.towerId, initial?.floor, initial?.flatId, initial?.roomId]);

  const isComplete =
    !!selection.projectId &&
    !!selection.towerId &&
    !!selection.floor &&
    !!selection.flatId &&
    !!selection.roomId;

  const resolvedScope: DependencyScope | null = isComplete
    ? {
        projectId: selection.projectId as number,
        towerId: selection.towerId as number,
        floor: selection.floor as string,
        flatId: selection.flatId as number,
        roomId: selection.roomId as number,
      }
    : null;

  // Human-readable "Tower A > Floor 3 > Flat 302 > Bedroom 1" trail, built
  // from whichever option lists are already in cache — no extra round trip.
  const resolvedPath = useMemo(() => {
    const find = (list: ScopeOption[] | undefined, id: number | string | null) =>
      list?.find((o) => String(o.id) === String(id))?.label ?? null;
    const parts = [
      find(projectsQ.data, selection.projectId),
      find(towersQ.data, selection.towerId),
      selection.floor ? `Floor ${selection.floor}` : null,
      find(flatsQ.data, selection.flatId),
      find(roomsQ.data, selection.roomId),
    ].filter(Boolean);
    return parts.join(" > ");
  }, [projectsQ.data, towersQ.data, flatsQ.data, roomsQ.data, selection]);

  return {
    selection,
    setProject,
    setTower,
    setFloor,
    setFlat,
    setRoom,
    options: {
      projects: projectsQ.data ?? [],
      towers: towersQ.data ?? [],
      floors: (floorsQ.data ?? []).map((f) => String(f.label)),
      flats: flatsQ.data ?? [],
      rooms: roomsQ.data ?? [],
    },
    loading: {
      projects: projectsQ.isLoading,
      towers: towersQ.isLoading,
      floors: floorsQ.isLoading,
      flats: flatsQ.isLoading,
      rooms: roomsQ.isLoading,
    },
    isComplete,
    resolvedScope,
    resolvedPath,
  };
}
