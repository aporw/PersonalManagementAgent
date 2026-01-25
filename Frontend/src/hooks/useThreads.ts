import { useEffect, useState } from "react";
import { threads as mockThreads } from "../data/threads";
import { Thread } from "../types/thinking";

const API_BASE = (typeof window !== "undefined" && (window as any).API_BASE) || (process.env.REACT_APP_API_BASE as string) || "http://localhost:8000";

export function useThreads() {
  // load threads from localStorage first, then fall back to mockThreads
  const stored = typeof window !== "undefined" ? localStorage.getItem("ai_threads") : null;
  const initial = stored ? (JSON.parse(stored) as Thread[]) : mockThreads;

  const [threads, setThreads] = useState<Thread[]>(initial);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initial[0]?.thread_id ?? null
  );

  const activeThread = threads.find((t) => t.thread_id === activeThreadId) ?? null;

  function persist(next: Thread[]) {
    setThreads(next);
    try {
      localStorage.setItem("ai_threads", JSON.stringify(next));
    } catch (e) {}
  }

  async function fetchServerThreadsForUser(uid: string) {
    try {
      const resp = await fetch(`${API_BASE}/threads/${encodeURIComponent(uid)}`, { credentials: 'include' });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const data = await resp.json();
      const serverThreads = Array.isArray(data.threads) ? data.threads as Thread[] : [];
      if (serverThreads.length > 0) {
        persist(serverThreads);
        setActiveThreadId((prev) => prev ?? serverThreads[0].thread_id);
        return serverThreads;
      }
    } catch (e) {
      // fall back to whatever we have locally
    }
    return null;
  }

  // Listen for user changes (sign-out / sign-in) to reset threads when needed.
  // On sign-in, fetch server-side threads and show a toast while loading.
  useEffect(() => {
    const handler = () => {
      try {
        const uid = typeof window !== 'undefined' ? localStorage.getItem('user_id') : null;
        if (!uid) {
          // signed out: revert to local/demo threads
          const s = localStorage.getItem('ai_threads');
          const nxt = s ? JSON.parse(s) as Thread[] : mockThreads;
          setThreads(nxt);
          setActiveThreadId(nxt[0]?.thread_id ?? null);
          // show a small toast
          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Signed out — showing local threads.', kind: 'info' } }));
          return;
        }

        if (uid.startsWith('anon_')) {
          // anonymous: keep local threads
          const s = localStorage.getItem('ai_threads');
          const nxt = s ? JSON.parse(s) as Thread[] : mockThreads;
          setThreads(nxt);
          setActiveThreadId(nxt[0]?.thread_id ?? null);
          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Signed in anonymously.', kind: 'info' } }));
          return;
        }

        // authenticated user: fetch server-side threads
        window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Signed in — loading your chats...', kind: 'info' } }));
        void fetchServerThreadsForUser(uid).then((st) => {
          if (!st) {
            // fallback toast if none found
            window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'No server threads found — showing local threads.', kind: 'info' } }));
          } else {
            window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Loaded your chats.', kind: 'success' } }));
          }
        });
      } catch (e) {
        setThreads(mockThreads);
        setActiveThreadId(mockThreads[0]?.thread_id ?? null);
      }
    };

    if (typeof window !== 'undefined') window.addEventListener('ai_user_changed', handler as EventListener);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('ai_user_changed', handler as EventListener); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: if authenticated user already present, attempt to fetch threads
  useEffect(() => {
    try {
      const uid = typeof window !== 'undefined' ? localStorage.getItem('user_id') : null;
      if (uid && !uid.startsWith('anon_')) {
        void (async () => {
          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Loading your chats...', kind: 'info' } }));
          const st = await fetchServerThreadsForUser(uid);
          if (st) window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Loaded your chats.', kind: 'success' } }));
        })();
      }
    } catch (e) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addThread(title: string, description = "") {
    const id = `t${Date.now()}`;
    const now = new Date().toISOString();
    const t: Thread = { thread_id: id, title, description, status: "active", created_at: now, last_active_at: now };
    const next = [t, ...threads];
    persist(next);
    setActiveThreadId(id);
    return t;
  }

  return {
    threads,
    activeThread,
    activeThreadId,
    setActiveThreadId,
    addThread,
  };
}
