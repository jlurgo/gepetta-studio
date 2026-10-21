import { create } from "zustand";

export interface BusyTask {
  label: string;
  done: number;
  total: number;
}

interface BusyState {
  task: BusyTask | null;
  message: { text: string; tone: "info" | "error" } | null;
  setTask(task: BusyTask | null): void;
  notify(text: string, tone?: "info" | "error"): void;
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;

/** Long-running jobs (imports, exports) and short toast messages. */
export const useBusy = create<BusyState>((set) => ({
  task: null,
  message: null,
  setTask: (task) => set({ task }),
  notify(text, tone = "info") {
    clearTimeout(messageTimer);
    set({ message: { text, tone } });
    messageTimer = setTimeout(() => set({ message: null }), 4000);
  },
}));

/** Runs `fn` while showing progress; reports failures as a toast. */
export async function runTask<T>(label: string, total: number, fn: (progress: (done: number) => void) => Promise<T>): Promise<T | undefined> {
  const { setTask, notify } = useBusy.getState();
  setTask({ label, done: 0, total });
  try {
    return await fn((done) => setTask({ label, done, total }));
  } catch (e) {
    console.error(`[gepetta] ${label}`, e);
    notify(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  } finally {
    setTask(null);
  }
}
