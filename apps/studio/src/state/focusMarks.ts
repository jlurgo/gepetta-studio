import { create } from "zustand";

/** Named lens positions (fine steps from infinity), per camera, to come back to or animate between. */
export interface FocusMark {
  id: string;
  name: string;
  position: number;
}

const KEY = "gepetta.focusMarks";

function load(): Record<string, FocusMark[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

interface FocusMarksState {
  byCamera: Record<string, FocusMark[]>;
  add(camera: string, position: number): void;
  remove(camera: string, id: string): void;
}

export const useFocusMarks = create<FocusMarksState>((set, get) => {
  const save = (byCamera: Record<string, FocusMark[]>) => {
    set({ byCamera });
    try {
      localStorage.setItem(KEY, JSON.stringify(byCamera));
    } catch {
      // Marks are a convenience; losing them is not fatal.
    }
  };
  return {
    byCamera: load(),
    add(camera, position) {
      const marks = get().byCamera[camera] ?? [];
      const name = String.fromCharCode(65 + (marks.length % 26));
      save({ ...get().byCamera, [camera]: [...marks, { id: crypto.randomUUID(), name, position }] });
    },
    remove(camera, id) {
      save({ ...get().byCamera, [camera]: (get().byCamera[camera] ?? []).filter((m) => m.id !== id) });
    },
  };
});
