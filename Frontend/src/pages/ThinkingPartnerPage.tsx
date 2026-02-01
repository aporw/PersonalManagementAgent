import { useThreads } from "../hooks/useThreads";
import { useCurrentSession } from "../hooks/useCurrentSession";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { useUserPreferences } from "../hooks/useUserPreferences";
import React from "react";
import LeftPanel from "../components/layout/LeftPanel";
import ChatPanel from "../components/chat/ChatPanel";
import RightPanel from "../components/layout/RightPanel";
import MobileLanding from "./MobileLanding";
import { useState, useEffect } from 'react';

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

  // show landing page first (left-panel style) on all viewports until user enters
  const [entered, setEntered] = useState<boolean>(false);
  const [rightOverlayOpen, setRightOverlayOpen] = useState<boolean>(false);
  const [isNarrow, setIsNarrow] = useState<boolean>(false);
  const [showSignupModal, setShowSignupModal] = useState<boolean>(false);

  useEffect(() => {
    function check() {
      try { setIsNarrow(window.innerWidth <= 600); } catch (e) { setIsNarrow(false); }
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Ensure signup/login events dispatched from LeftPanel on page1 are handled:
  // if the user clicks Login/Create on the left panel while on page1, the
  // `open_signup_modal` event should bring the user into the chat page so
  // ChatPanel (the component that renders the modal) can mount and handle it.
  useEffect(() => {
    function onOpenSignup(e: any) {
      try {
        // clear any active thread so ChatPanel doesn't auto-select the first thread,
        // then mount chat page and show the modal (ChatPanel will receive props)
        try { setActiveThreadId(null); } catch (e) {}
        // prevent automatic selection of server threads while user is authenticating
        try { if (typeof window !== 'undefined') (window as any).__preventThreadAutoSelect = true; } catch (e) {}
        setShowSignupModal(true);
        // optionally set mode if provided (we re-dispatch a small event so ChatPanel can set authMode)
        const mode = e?.detail?.mode;
        if (mode) {
          // let ChatPanel observe this via a short-lived event after mount
          setTimeout(() => { try { window.dispatchEvent(new CustomEvent('open_signup_modal_hint', { detail: { mode } })); } catch (e) {} }, 120);
        }
      } catch (err) {}
    }

    function onAuthCompleted() {
      try {
        // ensure we return to landing and clear any active thread selection
        try { setActiveThreadId(null); } catch (e) {}
        setShowSignupModal(false);
        setRightOverlayOpen(false);
        setEntered(false);
        // clear the temporary suppression flag after a short delay so thread auto-selection
        // remains disabled for the immediate post-auth cycle but can resume afterwards
        try { if (typeof window !== 'undefined') setTimeout(() => { try { (window as any).__preventThreadAutoSelect = false; } catch (e) {} }, 500); } catch (e) {}
      } catch (e) {}
    }

    window.addEventListener('open_signup_modal', onOpenSignup as EventListener);
    window.addEventListener('auth_completed', onAuthCompleted as EventListener);
    return () => {
      window.removeEventListener('open_signup_modal', onOpenSignup as EventListener);
      window.removeEventListener('auth_completed', onAuthCompleted as EventListener);
    };
  }, []);

  return (
    <div>
      {!entered ? (
        <>
          <MobileLanding threads={threads} onSelect={(tid) => { setActiveThreadId(tid); setEntered(true); }} />
          {showSignupModal && (
            <ChatPanel
              activeThread={null}
              session={null}
              preferences={preferences}
              showSignupModal={showSignupModal}
              setShowSignupModal={setShowSignupModal}
              onlyShowModal={true}
            />
          )}
        </>
      ) : (
        <div
          className="app-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: !isNarrow && rightOverlayOpen ? '1fr minmax(240px, 38vw)' : '1fr',
            gap: 12,
            alignItems: 'start',
            padding: 0,
            transition: 'grid-template-columns 260ms ease',
          }}
        >
          {/* Chat column */}
          <div style={{ padding: 12, minWidth: 0 }}>
            <ChatPanel
              activeThread={showSignupModal ? null : activeThread}
              session={showSignupModal ? null : session}
              preferences={preferences}
              onOpenRight={() => setRightOverlayOpen((s) => !s)}
              showSignupModal={showSignupModal}
              setShowSignupModal={setShowSignupModal}
              onBack={() => {
                try {
                  setActiveThreadId(null);
                } catch (e) {}
                setRightOverlayOpen(false);
                setEntered(false);
              }}
            />
          </div>

          {/* Right panel behavior: side-by-side on wide screens, overlay on narrow */}
          {!isNarrow ? (
            rightOverlayOpen ? (
              <div style={{ padding: 12, minWidth: 0 }}>
                <RightPanel mode={session?.detected_mode} summary={summary} />
              </div>
            ) : null
          ) : (
            // on narrow screens, render overlay when open
            rightOverlayOpen ? (
              <div className="mobile-right-overlay">
                <div className="overlay open" onClick={() => setRightOverlayOpen(false)} />
                <div className="mobile-right-drawer">
                  <RightPanel mode={session?.detected_mode} summary={summary} />
                  <div style={{ marginTop: 8 }}>
                    <button className="prompt-btn" onClick={() => setRightOverlayOpen(false)}>Close</button>
                  </div>
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
