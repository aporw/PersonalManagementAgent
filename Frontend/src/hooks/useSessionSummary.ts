import { sessionSummaries } from "../data/sessionSummaries";
import { SessionSummary } from "../types/thinking";

export function useSessionSummary(sessionId?: string) {
  if (!sessionId) return { summary: null };

  const summary: SessionSummary | undefined =
    sessionSummaries.find((s) => s.session_id === sessionId);

  return { summary };
}
