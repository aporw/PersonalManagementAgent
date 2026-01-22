import { sessions } from "../data/sessions";
import { Session } from "../types/thinking";

export function useCurrentSession(activeThreadId?: string) {
  if (!activeThreadId) return { session: null };

  // For now: most recent session for thread
  const session: Session | undefined = [...sessions]
    .filter((s) => s.thread_id === activeThreadId)
    .sort((a, b) => (a.start_time < b.start_time ? 1 : -1))[0];

  return { session };
}
