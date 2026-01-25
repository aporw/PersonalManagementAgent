import { sessions } from "../data/sessions";
import { Session } from "../types/thinking";
import { useEffect, useState } from "react";

const API_BASE = (typeof window !== "undefined" && (window as any).API_BASE) || (process.env.REACT_APP_API_BASE as string) || "http://localhost:8000";

export function useCurrentSession(activeThreadId?: string) {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!activeThreadId) {
      setSession(null);
      return;
    }

    // helper to fetch the server session; also used by the ai_user_changed listener
    const fetchSession = async () => {
      try {
        const uid = typeof window !== "undefined" ? localStorage.getItem("user_id") : null;
        if (!uid || uid.startsWith("anon_")) {
          // leave as null for anonymous users
          setSession(null);
          return;
        }

        const resp = await fetch(`${API_BASE}/messages/${encodeURIComponent(uid)}/${encodeURIComponent(activeThreadId)}`);
        if (!mounted) return;
        if (!resp.ok) {
          // fallback to local static sessions if backend unavailable
          const s: Session | undefined = [...sessions]
            .filter((s) => s.thread_id === activeThreadId)
            .sort((a, b) => (a.start_time < b.start_time ? 1 : -1))[0];
          setSession(s ?? null);
          return;
        }
        const data = await resp.json();
        const msgs = data.messages || [];
        const mapped: Session = {
          session_id: activeThreadId,
          thread_id: activeThreadId,
          start_time: new Date().toISOString(),
          detected_mode: 'reflective',
          confidence_score: 0.5,
          messages: msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content, timestamp: m.ts || m.created_at })),
        };
        setSession(mapped);
      } catch (e) {
        const s: Session | undefined = [...sessions]
          .filter((s) => s.thread_id === activeThreadId)
          .sort((a, b) => (a.start_time < b.start_time ? 1 : -1))[0];
        setSession(s ?? null);
      }
    };

    // initial fetch
    void fetchSession();

    // Also re-fetch when user changes (e.g., after login/sign-in)
    const handleUserChanged = () => {
      void fetchSession();
    };
    if (typeof window !== 'undefined') window.addEventListener('ai_user_changed', handleUserChanged as EventListener);

    return () => { mounted = false; if (typeof window !== 'undefined') window.removeEventListener('ai_user_changed', handleUserChanged as EventListener); };
  }, [activeThreadId]);

  return { session };
}
