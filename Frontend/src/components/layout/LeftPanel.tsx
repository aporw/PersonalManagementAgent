import React, { useState, useRef, useEffect } from "react";
import { Thread } from "../../types/thinking";
import { User } from "../../data/userDb";
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
  const API_BASE = (typeof window !== "undefined" && (window as any).API_BASE) || (process.env.REACT_APP_API_BASE as string) || "http://localhost:8000";
  const [me, setMe] = useState<User | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    // when modal opens, set source and attempt autoplay
    if (showVideoModal) {
      setTriedFallback(false);
      const localUrl = `${window.location.origin}/101724-video-720.mp4`;
      setVideoSrc(localUrl);
      // try autoplay shortly after src is set
      setTimeout(() => {
        try {
          const v = videoRef.current;
          if (v) {
            // attempt muted autoplay first (more likely to succeed)
            v.muted = true;
            const p = v.play();
            if (p && typeof p.then === 'function') {
              p.then(() => { setIsPlaying(true); }).catch(() => {
                // if muted autoplay fails, unmute and expect user interaction (browser policy)
                try { v.muted = false; } catch (e) {}
                setIsPlaying(false);
              });
            }
          }
        } catch (e) {}
      }, 150);
    } else {
      // cleanup when modal closed
      setVideoSrc(null);
      setIsPlaying(false);
      setVideoProgress(0);
    }
  }, [showVideoModal]);

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
  }, [API_BASE]);

  function renderUserInfo(user: User | null) {
    function handleSignOut() {
      try {
      // remove the stored user id
      localStorage.removeItem('user_id');
        // reset message count and clear ai-related local state
        localStorage.setItem('ai_user_msg_count', '0');
        // clear ai-related local state to return to first-time user experience
        const keysToClear: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          if (k.startsWith('ai_')) keysToClear.push(k);
          if (k.startsWith('ai_edited_summary_')) keysToClear.push(k);
        }
        keysToClear.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      } catch (e) {}
      // create a fresh anonymous id so the app switches to guest flows
      try {
        const anon = `anon_${Date.now()}`;
        localStorage.setItem('user_id', anon);
        localStorage.setItem('ai_user_msg_count', '0');
      } catch (e) {}
      setMe(null);
      // inform other parts of the app and fully refresh to ensure panels reset
      window.dispatchEvent(new CustomEvent('ai_user_changed'));
      window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Signed out', kind: 'info' } }));
      // reload so components that only initialize on mount (e.g., RightPanel) reset
      try { window.location.reload(); } catch (e) {}
    }

    // compute messages left: if server provides messages_left use it, otherwise
    // fall back to anonymous allowance (5 messages) minus local ai_user_msg_count.
    let messagesLeft = undefined as number | undefined;
    try {
      const serverVal = (user as any)?.messages_left;
      if (typeof serverVal === 'number') {
        messagesLeft = serverVal;
      } else {
        const countStr = localStorage.getItem('ai_user_msg_count') || '0';
        const used = parseInt(countStr || '0', 10) || 0;
        const ALLOW = 5;
        messagesLeft = Math.max(0, ALLOW - used);
      }
    } catch (e) {
      messagesLeft = undefined;
    }

    return (
      <>
        <div className="user-info-top">
          <div className="user-name-row">
            <div className="user-name">{user ? user.name : 'Guest'}</div>
          </div>

          <div className="user-email-row">
            <div className="user-email">{user?.email ?? ''}</div>
          </div>

          <div className="user-actions-row">
              {user ? (
              <>
                <button className="prompt-btn" onClick={() => window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Update password (demo)', kind: 'info' } }))}>Update password</button>
                <button className="prompt-btn" onClick={() => window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Go ad-free (demo)', kind: 'info' } }))}>Go ad-free</button>
                <button className="prompt-btn" onClick={handleSignOut}>Sign out</button>
              </>
            ) : (
              <>
                <button className="prompt-btn" onClick={() => window.dispatchEvent(new CustomEvent('open_signup_modal', { detail: { mode: 'login' } }))}>Log in</button>
                <button className="prompt-btn" onClick={() => window.dispatchEvent(new CustomEvent('open_signup_modal', { detail: { mode: 'create' } }))}>Create account</button>
                <button className="prompt-btn" onClick={() => setShowVideoModal(true)}>Watch credits ({messagesLeft ?? '—'})</button>
              </>
            )}
          </div>
        </div>

        <div className="user-bio">{user?.bio ?? ''}</div>
      </>
    );
  }

  useEffect(() => {
    // Prefer a server-backed user when available. If localStorage contains an anon id,
    // show Guest instead of the hard-coded demo user so incognito/private windows don't
    // surface the demo account. Listen for `ai_user_changed` events so we refresh when
    // the user logs in or creates an account elsewhere in the app.

    async function loadMe() {
      const uid = localStorage.getItem("user_id");
      if (!uid) {
        setMe(null);
        return;
      }
      if (uid.startsWith("anon_")) {
        setMe(null);
        return;
      }
      try {
        const resp = await fetch(`${API_BASE}/users/${encodeURIComponent(uid)}`, { credentials: 'include' });
        if (!resp.ok) {
          setMe(null);
          return;
        }
        const data = await resp.json();
        setMe(data.user ?? null);
      } catch (e) {
        setMe(null);
      }
    }

    loadMe();
    function onUserChanged() {
      loadMe();
    }
    window.addEventListener('ai_user_changed', onUserChanged);
    return () => window.removeEventListener('ai_user_changed', onUserChanged);
  }, [API_BASE]);

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
          {/* New thread tile integrated into the same grid so it matches other tiles visually */}
          <button
            key="new-thread"
            className={`thread-btn new-thread-btn`}
            onClick={() => {
              const title = window.prompt('New thread title', 'New thread');
              if (!title) return;
              const desc = window.prompt('Description (optional)', '');
              if (onCreateThread) onCreateThread(title, desc || '');
            }}
            aria-label="Create new thread"
          >
            <div className="thread-icon" aria-hidden style={{ background: 'linear-gradient(180deg,#fff,#fbfdff)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="thread-title">New thread</div>
            <div className="thread-desc muted">Create a new thinking space</div>
          </button>
        </div>
        <div id="threads-help" className="sr-only">Use arrow keys to move between threads and Enter to select.</div>

          {me ? (
            <div className="settings-container">
              <button className="settings-btn" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings} aria-controls="user-settings">
                {me && me.avatarUrl ? (
                  <img src={me.avatarUrl} alt="Your avatar" className="settings-avatar" />
                ) : (
                  <span aria-hidden>⚙️</span>
                )}
                <span className="settings-label">Settings</span>
              </button>
            </div>
          ) : (
            <div className="settings-container">
              <button className="prompt-btn account-btn" onClick={() => window.dispatchEvent(new CustomEvent('open_signup_modal', { detail: { mode: 'login' } }))}>
                Log in
              </button>
              <button className="prompt-btn account-btn" onClick={() => window.dispatchEvent(new CustomEvent('open_signup_modal', { detail: { mode: 'create' } }))}>
                <span style={{display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1}}>
                  <span style={{fontSize: '0.98rem', fontWeight: 700}}>Create</span>
                  <span style={{fontSize: '0.9rem'}}>Account</span>
                </span>
              </button>
            </div>
          )}
        {/* Quick-access watch-to-earn button (always visible) */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.03)', marginTop: 8 }}>
          <button className="prompt-btn" onClick={() => setShowVideoModal(true)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Watch to earn credits</span>
            <span style={{ opacity: 0.9, fontSize: '0.95rem' }}>{me ? (Number((me as any).tokens_left || (me as any).messages_left || 0)) : (Number(localStorage.getItem('ai_credits') || '0') || '—')}</span>
          </button>
        </div>
      </div>
        <div id="user-settings" className={`user-info-panel ${showSettings ? "open" : "closed"}`} role="dialog" aria-hidden={!showSettings} style={{ position: 'absolute' }}>
          {showSettings && (
            <button
              aria-label="Close settings"
              onClick={() => setShowSettings(false)}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'transparent',
                border: 'none',
                color: '#6b7280',
                fontSize: 18,
                cursor: 'pointer',
                padding: 6,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
          {renderUserInfo(me)}
      </div>
      {/* Video modal for watching credits (dummy player) */}
      {showVideoModal && (
        <div style={{ position: 'fixed', left: 0, right: 0, top: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ width: 540, maxWidth: '96%', background: '#041827', padding: 16, borderRadius: 10, color: '#e6f3ff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>Watch to earn credits</h4>
              <button onClick={() => { setShowVideoModal(false); setVideoProgress(0); }} style={{ background: 'transparent', border: 'none', color: '#dbeeff' }}>✕</button>
            </div>
            <div style={{ marginTop: 12, background: '#021423', height: 260, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Video player */}
              <div style={{ width: '100%' }}>
                <video
                  ref={videoRef}
                  src={videoSrc ?? undefined}
                  style={{ width: '100%', height: 260, objectFit: 'cover', borderRadius: 8, background: '#000' }}
                  controls
                  onTimeUpdate={() => {
                    try {
                      const v = videoRef.current;
                      if (!v || !v.duration || isNaN(v.duration)) return;
                      const pct = Math.round((v.currentTime / v.duration) * 100);
                      setVideoProgress(pct);
                    } catch (e) {}
                  }}
                  onEnded={async () => {
                    setIsPlaying(false);
                    setVideoProgress(100);
                    // award credits when finished
                    const AWARD = 3;
                    const uid = localStorage.getItem('user_id');
                    if (uid && !uid.startsWith('anon_')) {
                      try {
                        const headers: any = { 'Content-Type': 'application/json' };
                        const r = await fetch(`${API_BASE}/users/${encodeURIComponent(uid)}/credits`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ amount: AWARD }) });
                        if (r.ok) {
                          const resp = await fetch(`${API_BASE}/users/${encodeURIComponent(uid)}`, { credentials: 'include' });
                          if (resp.ok) {
                            const data = await resp.json().catch(() => ({}));
                            setMe(data.user ?? null);
                          }
                          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `You earned ${AWARD} credits`, kind: 'success' } }));
                        } else {
                          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Failed to award credits (${r.status})`, kind: 'error' } }));
                        }
                      } catch (e) {
                        window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Credit award failed`, kind: 'error' } }));
                      }
                    } else {
                      try {
                        const prev = Number(localStorage.getItem('ai_credits') || '0') || 0;
                        localStorage.setItem('ai_credits', String(prev + AWARD));
                        window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `You earned ${AWARD} credits`, kind: 'success' } }));
                      } catch (e) {}
                    }
                    setTimeout(() => { setShowVideoModal(false); setVideoProgress(0); setVideoSrc(null); }, 700);
                  }}
                  onLoadedMetadata={() => {
                    try { setVideoProgress(0); } catch (e) {}
                  }}
                  onCanPlay={() => {
                    // auto play if we requested playback
                    try {
                      const v = videoRef.current;
                      if (v && !isPlaying) {
                        const p = v.play();
                        if (p && typeof p.then === 'function') {
                          p.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
                        }
                      }
                    } catch (e) {}
                  }}
                  onError={async () => {
                    try {
                      const v = videoRef.current;
                      const src = v?.currentSrc || videoSrc || '';
                      // if we tried the local file and it failed, attempt fallback once
                      if (!triedFallback && src.includes('101724-video-720.mp4')) {
                        setTriedFallback(true);
                        const fallback = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
                        setVideoSrc(fallback);
                        // allow the src to update before attempting play
                        setTimeout(() => { try { videoRef.current?.play(); } catch (e) {} }, 150);
                        return;
                      }
                      window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Video playback failed', kind: 'error' } }));
                    } catch (e) {}
                  }}
                />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
                <div style={{ height: 8, background: '#083240', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ width: `${videoProgress}%`, height: '100%', background: 'linear-gradient(90deg,#4aa3ff,#7b61ff)' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <button className="prompt-btn" onClick={async () => {
                  // prepare and play video: try local asset in public/, fall back to sample
                  try {
                    const localUrl = `${window.location.origin}/101724-video-720.mp4`;
                    // quick probe: try fetch HEAD
                    let useUrl = localUrl;
                    try {
                      const probe = await fetch(localUrl, { method: 'HEAD' });
                      if (!probe.ok) {
                        useUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
                      }
                    } catch (e) {
                      useUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
                    }
                    setVideoSrc(useUrl);
                    await new Promise((res) => setTimeout(res, 80));
                    const v = videoRef.current;
                    if (v) {
                      try { await v.play(); setIsPlaying(true); } catch (e) { setIsPlaying(false); }
                    }
                  } catch (e) {
                    window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Unable to play video', kind: 'error' } }));
                  }
                }}>{isPlaying ? 'Playing…' : 'Play'}</button>
                <div style={{ color: '#9fd7ff' }}>{videoProgress}%</div>
                <div style={{ marginLeft: 'auto', color: '#9fd7ff' }}>Completing awards credits</div>
              </div>
            </div>
          </div>
        </div>
      )}
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
