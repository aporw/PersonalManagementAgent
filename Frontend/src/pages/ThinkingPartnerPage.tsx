import { useThreads } from "../hooks/useThreads";
import { useCurrentSession } from "../hooks/useCurrentSession";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { useUserPreferences } from "../hooks/useUserPreferences";
import React from "react";
import LeftPanel from "../components/layout/LeftPanel";
import ChatPanel from "../components/chat/ChatPanel";
import RightPanel from "../components/layout/RightPanel";

export default function ThinkingPartnerPage() {
  // 🧠 STATE OWNERSHIP LIVES HERE
  const {
    threads,
    activeThread,
    setActiveThreadId,
    addThread,
  } = useThreads();

  const { session } = useCurrentSession(activeThread?.thread_id);
  const { summary } = useSessionSummary(session?.session_id);
  const preferences = useUserPreferences();

  return (
    <div className="app-layout">
      <LeftPanel
        threads={threads}
        activeThreadId={activeThread?.thread_id}
        onThreadSelect={setActiveThreadId}
        onCreateThread={(title, desc) => addThread(title, desc)}
      />

      <ChatPanel
        activeThread={activeThread}
        session={session}
        preferences={preferences}
      />

      <RightPanel
        mode={session?.detected_mode}
        summary={summary}
      />
    </div>
  );
}
