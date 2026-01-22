import React, { useState, useRef, useEffect } from "react";
import { Thread } from "../../types/thinking";
import { currentUser, User } from "../../data/userDb";
import { timeAgo } from "../../utils/time";

interface LeftPanelProps {
  threads: Thread[];
  activeThreadId?: string;
  onThreadSelect: (id: string) => void;
  onCreateThread?: (title: string, description?: string) => void;
}

export default function LeftPanel({
  threads,
  activeThreadId,
  onThreadSelect,
  onCreateThread,
}: LeftPanelProps) {
  const [showSettings, setShowSettings] = useState(false);

  const iconMap: Record<string, React.ReactNode> = {
    t1: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M3 7a2 2 0 0 1 2-2h3V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    t2: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  };

  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useThreadKeyboardNavigation(btnRefs);
  // tick to force periodic re-render so relative times refresh every minute
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  function renderUserInfo(user: User) {
    return (
      <>
        <div className="user-info-top">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt={`${user.name} avatar`} className="settings-avatar" />
          )}
          <div className="user-meta">
            <div className="user-name">{user.name}</div>
            <div className="user-role muted">{user.role}</div>
          </div>
        </div>

        <div className="user-bio">{user.bio}</div>
        <div className="user-email muted">{user.email}</div>

        <div className="user-actions">
          <button className="prompt-btn" onClick={() => alert("Edit profile (demo)")}>Edit Profile</button>
          <button className="prompt-btn" onClick={() => alert("Sign out (demo)")}>Sign out</button>
          <button className="prompt-btn close-btn" onClick={() => setShowSettings(false)}>Close</button>
        </div>
      </>
    );
  }

  return (
    <aside className="left-panel">
      <div className="left-panel-inner">
        <h3>Active Threads</h3>

        <div className="thread-grid" role="list" aria-describedby="threads-help">
          {threads.map((t, i) => (
            <button
              key={t.thread_id}
              data-thread-id={t.thread_id}
              ref={(el) => { btnRefs.current[i] = el; }}
              role="listitem"
              className={`thread-btn ${t.thread_id === activeThreadId ? "active" : ""}`}
              onClick={() => onThreadSelect(t.thread_id)}
              aria-pressed={t.thread_id === activeThreadId}
              onKeyDown={(e) => {
                // let container-level handler manage navigation; keep default here
              }}
            >
              <div className="thread-icon" aria-hidden>{iconMap[t.thread_id] ?? (<span aria-hidden>💬</span>)}</div>
              <div className="thread-title">{t.title}</div>
              <div className="thread-desc muted">{t.description}</div>
              <div className="thread-time muted" title={t.last_active_at}>{timeAgo(t.last_active_at)}</div>
            </button>
          ))}
        </div>
        <div id="threads-help" className="sr-only">Use arrow keys to move between threads and Enter to select.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="prompt-btn" onClick={() => {
            const title = window.prompt('New thread title', 'New thread');
            if (!title) return;
            const desc = window.prompt('Description (optional)', '');
            if (onCreateThread) onCreateThread(title, desc || '');
          }}>+ New Thread</button>
          <div style={{ marginLeft: 'auto' }} />
        </div>

          <div className="settings-container">
            <button className="settings-btn" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings} aria-controls="user-settings">
              {currentUser.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="Your avatar" className="settings-avatar" />
              ) : (
                <span aria-hidden>⚙️</span>
              )}
              <span className="settings-label">Settings</span>
            </button>
          </div>
      </div>

      <div id="user-settings" className={`user-info-panel ${showSettings ? "open" : "closed"}`} role="dialog" aria-hidden={!showSettings}>
        {renderUserInfo(currentUser)}
      </div>
    </aside>
  );
}

  // keyboard navigation handler for the thread grid (left panel)
  // We attach a global keydown on mount to improve arrow-key navigation
  // scoped to this left panel's buttons.
  function useThreadKeyboardNavigation(btnRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>) {
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        const active = document.activeElement;
        const idx = btnRefs.current.findIndex((b) => b === active);
        if (idx === -1) return; // not inside our buttons

        const len = btnRefs.current.length;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          const next = (idx + 1) % len;
          btnRefs.current[next]?.focus();
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          const prev = (idx - 1 + len) % len;
          btnRefs.current[prev]?.focus();
        } else if (e.key === "Enter" || e.key === " ") {
          // let normal button activation handle it
        }
      }

      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [btnRefs]);
  }
