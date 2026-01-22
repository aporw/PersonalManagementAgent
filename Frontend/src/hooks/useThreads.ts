import { useState } from "react";
import { threads as mockThreads } from "../data/threads";
import { Thread } from "../types/thinking";

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
