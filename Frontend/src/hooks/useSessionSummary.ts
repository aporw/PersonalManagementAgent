import { sessionSummaries } from "../data/sessionSummaries";
import { SessionSummary } from "../types/thinking";
import { useEffect, useState } from "react";

const API_BASE = (typeof window !== "undefined" && (window as any).API_BASE) || (process.env.REACT_APP_API_BASE as string) || "http://localhost:8000";

export function useSessionSummary(sessionId?: string) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!sessionId) {
      setSummary(null);
      return;
    }

    const fetchSummary = async () => {
      try {
        const uid = typeof window !== "undefined" ? localStorage.getItem("user_id") : null;
        if (!uid || uid.startsWith("anon_")) {
          // fallback to static summaries for anonymous users
          const s = sessionSummaries.find((ss) => ss.session_id === sessionId) || null;
          setSummary(s as SessionSummary | null);
          return;
        }

        // sessionId is used as thread id in this app
        const resp = await fetch(`${API_BASE}/summary/saved/${encodeURIComponent(uid)}/${encodeURIComponent(sessionId)}`);
        if (!mounted) return;
        if (!resp.ok) {
          const s = sessionSummaries.find((ss) => ss.session_id === sessionId) || null;
          setSummary(s as SessionSummary | null);
          return;
        }
        const data = await resp.json();
        const serverSummary = data.summary || null;
        setSummary(serverSummary as SessionSummary | null);
      } catch (e) {
        const s = sessionSummaries.find((ss) => ss.session_id === sessionId) || null;
        setSummary(s as SessionSummary | null);
      }
    };

    // initial fetch
    void fetchSummary();

    // re-fetch when user signs in/out
    const handleUserChanged = () => { void fetchSummary(); };
    if (typeof window !== 'undefined') window.addEventListener('ai_user_changed', handleUserChanged as EventListener);

    return () => { mounted = false; if (typeof window !== 'undefined') window.removeEventListener('ai_user_changed', handleUserChanged as EventListener); };
  }, [sessionId]);

  return { summary };
}
