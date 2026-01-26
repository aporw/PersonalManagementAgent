import { Thread, Session, UserPreferences } from "../../types/thinking";
import { useEffect, useRef, useState } from "react";

interface ChatPanelProps {
  activeThread?: Thread | null;
  session?: Session | null;
  preferences: UserPreferences;
}

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
  streaming?: boolean;
};

function makeId(prefix = "m") {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export default function ChatPanel({ activeThread, session, preferences }: ChatPanelProps) {
  const API_BASE = (typeof window !== "undefined" && (window as any).API_BASE) || (process.env.REACT_APP_API_BASE as string) || "http://localhost:8000";
  const DEBUG = false;
  const getAuthHeader = () => {
    try { const t = localStorage.getItem('auth_token_fallback') || localStorage.getItem('token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch (e) { return {}; }
  };

  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userMessageCount, setUserMessageCount] = useState<number>(0);
  const [welcomeShown, setWelcomeShown] = useState<boolean>(false);
  const welcomeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showSignupModal, setShowSignupModal] = useState<boolean>(false);
  // signupName / signupEmail removed: not used in UI (lint cleanup)
  const [authMode, setAuthMode] = useState<'login'|'create'>('create');
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [createName, setCreateName] = useState<string>("");
  const [createEmail, setCreateEmail] = useState<string>("");
  const [createPassword, setCreatePassword] = useState<string>("");
  const [createBirthYear, setCreateBirthYear] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [hideModeToggle, setHideModeToggle] = useState<boolean>(false);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const prevFocusedRef = useRef<HTMLElement | null>(null);

  // Ensure a user_id exists (anonymous) so messages can be stored server-side
  useEffect(() => {
    const existing = localStorage.getItem("user_id");
    if (!existing) {
      const anon = `anon_${Date.now()}`;
      localStorage.setItem("user_id", anon);
      localStorage.setItem("ai_user_msg_count", "0");
      setUserMessageCount(0);
    } else {
      const cnt = Number(localStorage.getItem("ai_user_msg_count") || "0") || 0;
      setUserMessageCount(cnt);
    }
    try {
      const shown = localStorage.getItem('ai_welcome_shown');
      setWelcomeShown(Boolean(shown));
    } catch (e) {}
  }, []);

  // Focus the welcome dismiss button when banner is shown for accessibility
  useEffect(() => {
    try {
      const uid = typeof window !== 'undefined' ? localStorage.getItem('user_id') : null;
      const isAnon = !!uid && uid.startsWith('anon_');
      const isNewUser = isAnon && messages.length === 0 && (userMessageCount === 0);
      if (!welcomeShown && isNewUser) {
        setTimeout(() => {
          try { welcomeButtonRef.current?.focus(); } catch (e) {}
        }, 50);
      }
    } catch (e) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcomeShown, messages.length, userMessageCount]);

  // listen for suggestion updates from RightPanel
  useEffect(() => {
    function handler(e: any) {
      try {
        const arr = (e?.detail?.suggestions || []).map((s: any) => String(s).trim()).filter(Boolean);
        setSuggestions(arr);
      } catch (err) {
        // ignore
      }
    }
    window.addEventListener("ai_suggestions", handler as EventListener);
    return () => window.removeEventListener("ai_suggestions", handler as EventListener);
  }, []);

  // listen for settings-triggered signup/login events (from LeftPanel)
  useEffect(() => {
    function openSignup(e: any) {
      setShowSignupModal(true);
      setHideModeToggle(false);
      // set desired auth mode if provided in the event; if a mode is provided
      // we treat this as a direct open and hide the top toggle to focus the selected form.
      try {
        const mode = e?.detail?.mode;
        if (mode === 'login' || mode === 'create') {
          setAuthMode(mode);
          setHideModeToggle(true);
        }
      } catch (err) {}
    }
    window.addEventListener('open_signup_modal', openSignup as EventListener);
    return () => window.removeEventListener('open_signup_modal', openSignup as EventListener);
  }, []);

  // Manage focus when modal opens/closes (accessibility)
  useEffect(() => {
    if (showSignupModal) {
      try {
        prevFocusedRef.current = document.activeElement as HTMLElement;
        setTimeout(() => {
          // focus the first relevant input depending on mode
          if (firstInputRef.current) {
            firstInputRef.current.focus();
          } else if (modalRef.current) {
            modalRef.current.focus();
          }
        }, 0);
      } catch (e) {}
    } else {
      // restore focus
      try {
        prevFocusedRef.current?.focus();
      } catch (e) {}
    }
  }, [showSignupModal]);

  // basic focus trap: keep tab inside modal
  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const container = modalRef.current;
    if (!container) return;
    const focusable = container.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      (first as HTMLElement).focus();
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      (last as HTMLElement).focus();
    }
  }

  // For anonymous / new users with no messages, show thread-specific starter suggestions
  useEffect(() => {
    try {
      const uid = typeof window !== "undefined" ? localStorage.getItem('user_id') : null;
      if (!uid || !uid.startsWith('anon_')) return; // only for anonymous new users
    } catch (e) {
      return;
    }

    if (!activeThread) return;
    if (messages.length > 0) return; // user already has messages
    if (suggestions && suggestions.length > 0) return; // don't override existing suggestions

    const starterByThread: Record<string, string[]> = {
      t1: ["I'm thinking about changing roles but unsure which direction feels right."],
      t2: ["I keep ruminating at night and can't fall asleep."],
    };

    const defaults = starterByThread[activeThread.thread_id] || [];
    if (defaults.length) setSuggestions(defaults);
  }, [activeThread, messages, suggestions]);

  useEffect(() => {
    if (session?.messages && Array.isArray(session.messages)) {
      const mapped = session.messages.map((m: any) => ({
        id: m.entry_id ? String(m.entry_id) : makeId("s"),
        role: m.role ?? (m.source === "assistant" ? "assistant" : "user"),
        content: m.content ?? m.text ?? "",
        created_at: m.created_at ?? undefined,
      }));
      setMessages(mapped);
    } else {
      setMessages([]);
    }
  }, [session]);

  // auto-scroll to bottom when messages change
  useEffect(() => {
    try {
      const el = messagesRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    } catch (e) {}
  }, [messages]);

  function updateMessage(id: string, patch: Partial<Message>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function pushMessage(msg: Message) {
    setMessages((prev) => [...prev, msg]);
  }

  function pushDebug(_entry: string) {
    // debug disabled — no-op to preserve call sites
    if (DEBUG) console.debug("DEBUG_LOG:", _entry);
  }

  // legacy debug setter (no-op) kept so existing code that calls setRawReply doesn't break
  const setRawReply = (_: any) => {};

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    pushDebug(`handleSend invoked — text length ${text.length}`);

    const userMsg: Message = { id: makeId("u"), role: "user", content: text, created_at: new Date().toISOString() };
    pushMessage(userMsg);
    setInput("");

    const userId = localStorage.getItem("user_id") || "u1";
    const threadId = activeThread?.thread_id ?? "t1";

    try {
      const userPayload = { user_id: userId, thread_id: threadId, role: "user", content: text };
      if (DEBUG) console.debug("POST /message (user):", userPayload);
      pushDebug(`POST /message (user) -> ${API_BASE}/message`);
                        try {
                          const headers: any = { "Content-Type": "application/json", ...(getAuthHeader()) };
                          void fetch(`${API_BASE}/message`, {
                            method: "POST",
                            headers,
                            credentials: 'include',
                            body: JSON.stringify(userPayload),
                          });
                        } catch (e) {}
    } catch (e) {
      pushDebug(`POST /message (user) failed: ${String(e)}`);
    }

      // increment anonymous user message count and persist
      try {
        const prev = Number(localStorage.getItem("ai_user_msg_count") || "0") || 0;
        const next = prev + 1;
        localStorage.setItem("ai_user_msg_count", String(next));
        setUserMessageCount(next);
        // after 5 user messages, prompt signup/login
        if (next >= 5) {
          setShowSignupModal(true);
        }
      } catch (e) {}

    const assistantId = makeId("a");
    const assistantPlaceholder: Message = { id: assistantId, role: "assistant", content: "", created_at: new Date().toISOString(), streaming: true };
    pushMessage(assistantPlaceholder);

    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setSending(true);
    let finalAssistantContent = "";
    try {
      const res = await fetch(`${API_BASE}/chat?stream=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(getAuthHeader()) },
        body: JSON.stringify({ user_id: userId, thread_id: threadId, message: text }),
        signal: ac.signal,
        credentials: 'include',
      });

      pushDebug(`/chat response status: ${res.status} content-type=${res.headers.get("content-type")}`);

      if (!res.ok) {
        let fallbackText = `Assistant error (${res.status})`;
        try {
          const json = await res.json();
          fallbackText = json?.reply ?? json?.message ?? fallbackText;
        } catch (e) {
          // ignore
        }
        const fallback = getFakeResponse(text, preferences) + `\n\n(${fallbackText})`;
        updateMessage(assistantId, { content: fallback, streaming: false });
        setRawReply(fallback);
        pushDebug(`/chat non-ok -> ${res.status} fallback set`);
        return;
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      pushDebug(`/chat content-type resolved: ${contentType}`);

      if (contentType.includes("text/event-stream")) {
        // stream as SSE
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let accumulated = "";
        let done = false;
        while (!done) {
          const { value, done: d } = await reader.read();
          if (d) {
            done = true;
            pushDebug("stream reader signalled done");
          }
          if (value) {
            const chunkStr = decoder.decode(value, { stream: true });
            pushDebug(`stream chunk len ${chunkStr.length}`);
            sseBuffer += chunkStr;

            let sepIndex;
            while ((sepIndex = sseBuffer.indexOf("\n\n")) !== -1) {
              const rawEvent = sseBuffer.slice(0, sepIndex);
              sseBuffer = sseBuffer.slice(sepIndex + 2);

              const lines = rawEvent.split(/\r?\n/);
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.startsWith("data:")) {
                  const payload = trimmed.slice(5).trim();
                  if (payload === "[DONE]") {
                    done = true;
                    break;
                  }
                  try {
                    const obj = JSON.parse(payload);
                    const delta = obj?.delta ?? "";
                    if (delta) {
                      accumulated += delta;
                      pushDebug(`delta appended len ${delta.length}`);
                      updateMessage(assistantId, { content: accumulated, streaming: true });
                    }
                  } catch (e) {
                    accumulated += payload;
                    pushDebug(`raw payload appended len ${payload.length}`);
                    updateMessage(assistantId, { content: accumulated, streaming: true });
                  }
                }
              }
            }
          }
        }
        pushDebug(`stream finished total length ${accumulated.length}`);
        updateMessage(assistantId, { content: accumulated, streaming: false });
        finalAssistantContent = accumulated;
        setRawReply(accumulated);
      } else {
        // non-streaming (JSON) response
        const data = await res.json();
        const reply = data?.reply ?? data?.message ?? getFakeResponse(text, preferences);
        updateMessage(assistantId, { content: reply, streaming: false });
        finalAssistantContent = reply;
        setRawReply(typeof reply === "string" ? reply : JSON.stringify(reply));
        pushDebug(`/chat non-stream reply length ${String(finalAssistantContent).length}`);
      }

      try {
        const assistantPayload = { user_id: userId, thread_id: threadId, role: "assistant", content: finalAssistantContent ?? messages.find((m) => m.id === assistantId)?.content ?? "" };
        pushDebug(`POST /message (assistant) -> ${API_BASE}/message (content len ${String(assistantPayload.content).length})`);
      try {
        const headers: any = { "Content-Type": "application/json", ...(getAuthHeader()) };
        void fetch(`${API_BASE}/message`, {
          method: "POST",
          headers,
          credentials: 'include',
          body: JSON.stringify(assistantPayload),
        });
      } catch (e) {}
      } catch (e) {
        pushDebug(`POST /message (assistant) failed: ${String(e)}`);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        updateMessage(assistantId, { content: "(stream aborted)", streaming: false });
        pushDebug("stream aborted (AbortError)");
      } else {
        const fallback = getFakeResponse(text, preferences) + " (offline fallback)";
        updateMessage(assistantId, { content: fallback, streaming: false });
        finalAssistantContent = fallback;
        setRawReply(fallback);
        pushDebug(`handleSend error: ${String(err)}`);
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="chat-panel">
      {/* Welcome banner for new anonymous users */}
      {(() => {
        try {
          const uid = typeof window !== 'undefined' ? localStorage.getItem('user_id') : null;
          const isAnon = !!uid && uid.startsWith('anon_');
          const isNewUser = isAnon && messages.length === 0 && (userMessageCount === 0);
          if (isNewUser && !welcomeShown) {
            return (
              <div className="welcome-banner" role="region" aria-label="Welcome">
                <div className="welcome-text">
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 6, color: '#ffffff' }}>Welcome to Altar</div>
                  <div style={{ color: '#e6f3ff', marginBottom: 6 }}>Use this to:</div>
                  <ul>
                    <li>untangle work or career thoughts</li>
                    <li>talk through stress or anxiety</li>
                    <li>plan your day or week</li>
                    <li>get conversation summarized and suggested next steps</li>
                    <li>write privately in your journal</li>
                  </ul>
                </div>
                <div className="welcome-actions">
                  <button ref={welcomeButtonRef} className="prompt-btn" onClick={() => {
                    try { localStorage.setItem('ai_welcome_shown', '1'); } catch (e) {}
                    setWelcomeShown(true);
                  }}>Got it</button>
                </div>
              </div>
            );
          }
        } catch (e) {}
        return null;
      })()}
      <div className="chat-header">
        <h3>{activeThread?.title ?? "Thinking space"}</h3>
      </div>

      <div className="messages" aria-live="polite" ref={messagesRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="msg-meta" style={{ fontSize: 12, color: "#666" }}>
              {m.role}
              {m.created_at ? ` • ${new Date(m.created_at).toLocaleTimeString()}` : ""}
            </div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{m.content}</pre>
            {m.streaming && <div style={{ fontSize: 12, color: "#666" }}>Streaming…</div>}
          </div>
        ))}
      </div>

      <div className="chat-input" style={{ display: "flex", gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
        <textarea
          id="chat-input"
          name="chat_input"
          aria-label="Chat input"
          value={input}
          placeholder="Let's untangle this"
          ref={inputRef}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{ flex: 1, minHeight: 80 }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={handleSend} disabled={sending || !input.trim() || userMessageCount >= 5} style={{ minWidth: 100 }}>
              {sending ? "Sending…" : "Send"}
            </button>
          <button
            onClick={() => {
              if (abortRef.current) abortRef.current.abort();
            }}
            disabled={!abortRef.current}
            style={{ minWidth: 100 }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Signup modal shown after anonymous user reaches limit */}
      {showSignupModal && (
        <div style={{ position: 'fixed', left: 0, right: 0, top: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Account dialog"
            ref={modalRef}
            tabIndex={-1}
            onKeyDown={onModalKeyDown}
            style={{
              background: 'linear-gradient(180deg, #06223a, #041a2b)',
              padding: 18,
              borderRadius: 12,
              width: 520,
              maxWidth: '96%',
              boxShadow: '0 10px 40px rgba(2,6,23,0.65)',
              border: '1px solid rgba(255,255,255,0.04)',
              fontSize: 13,
              color: '#e6f3ff'
            }}>
              <h3 style={{ marginTop: 0, marginBottom: 6, fontSize: 16, fontWeight: 700, color: '#dbeeff' }}>Account</h3>
              <p style={{ marginTop: 0, marginBottom: 12, color: '#c7ddff', fontSize: 13 }}>Create an account to save your threads, summaries and journals, or log in to view your existing data.</p>
              {!hideModeToggle && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button style={{ padding: '8px 12px', borderRadius: 8, border: authMode === 'login' ? '1px solid #f3c13a' : '1px solid transparent', background: authMode === 'login' ? '#fff6e6' : 'transparent', fontWeight: 600 }} onClick={() => setAuthMode('login')}>Log in</button>
                  <button style={{ padding: '8px 12px', borderRadius: 8, border: authMode === 'create' ? '1px solid #4aa3ff' : '1px solid transparent', background: authMode === 'create' ? '#eaf6ff' : 'transparent', fontWeight: 600 }} onClick={() => setAuthMode('create')}>Create account</button>
                </div>
              )}

                  {authMode === 'login' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input ref={firstInputRef} placeholder="Email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#072433', color: '#eaf4ff', fontSize: 13 }} />
                  <input placeholder="Password" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#072433', color: '#eaf4ff', fontSize: 13 }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={{ background: '#ffd166', border: 'none', padding: '9px 14px', borderRadius: 8, fontWeight: 700, color: '#0f1720' }} className="prompt-btn" disabled={authLoading} onClick={async () => {
                      try {
                        setAuthLoading(true);
                        const payload = { email: (loginEmail || "").trim(), password: loginPassword };
                        pushDebug(`login attempt ${payload.email}`);
                        const res = await fetch(`${API_BASE}/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
                        if (!res.ok) {
                          const txt = await res.text().catch(() => '');
                          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Login failed: ${res.status} ${txt}`, kind: 'error' } }));
                          return;
                        }
                        const data = await res.json();
                        const user = data.user;
                        // persist fallback token for environments where cookies are blocked
                        try { if (data.token) localStorage.setItem('auth_token_fallback', data.token); } catch (e) {}
                        if (user && user.user_id) {
                          localStorage.setItem('user_id', user.user_id);
                          // store token returned by server for authenticated requests
                          // server also sets httpOnly cookie; do not persist token in localStorage
                          localStorage.setItem('ai_user_msg_count', '0');
                          setUserMessageCount(0);
                          setShowSignupModal(false);
                          setHideModeToggle(false);
                          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Logged in as ${user.name}`, kind: 'success' } }));
                          // notify other components (LeftPanel) that the user changed
                          window.dispatchEvent(new CustomEvent('ai_user_changed'));
                        }
                      } catch (e) {
                        window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Login failed: ${String(e)}`, kind: 'error' } }));
                      } finally { setAuthLoading(false); }
                    }}>Log in</button>
                    <button style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', padding: '8px 12px', borderRadius: 8, color: '#dbeeff' }} className="prompt-btn" onClick={() => { localStorage.setItem('ai_user_msg_count', '0'); setUserMessageCount(0); setShowSignupModal(false); }}>Continue as guest</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input ref={firstInputRef} placeholder="Name" value={createName} onChange={(e) => setCreateName(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#072433', color: '#eaf4ff', fontSize: 13 }} />
                  <input placeholder="Email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#072433', color: '#eaf4ff', fontSize: 13 }} />
                  <input placeholder="Password" type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#072433', color: '#eaf4ff', fontSize: 13 }} />
                  <input placeholder="Birth year (e.g. 1990)" value={createBirthYear} onChange={(e) => setCreateBirthYear(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', background: '#072433', color: '#eaf4ff', fontSize: 13 }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={{ background: '#2ea0ff', border: 'none', padding: '9px 14px', borderRadius: 8, fontWeight: 700, color: '#04253b' }} className="prompt-btn" disabled={authLoading} onClick={async () => {
                      try {
                        setAuthLoading(true);
                        const payload: any = { name: (createName || "").trim(), email: (createEmail || "").trim(), password: createPassword };
                        if (createBirthYear) payload.birth_year = createBirthYear;
                        const res = await fetch(`${API_BASE}/users/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
                        if (!res.ok) {
                          const txt = await res.text().catch(() => '');
                          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Create account failed: ${res.status} ${txt}`, kind: 'error' } }));
                          return;
                        }
                        const data = await res.json();
                        const newUser = data.user;
                        try { if (data.token) localStorage.setItem('auth_token_fallback', data.token); } catch (e) {}
                        if (newUser && newUser.user_id) {
                          localStorage.setItem('user_id', newUser.user_id);
                          // server also sets httpOnly cookie; do not persist token in localStorage
                          localStorage.setItem('ai_user_msg_count', '0');
                          setUserMessageCount(0);
                          setShowSignupModal(false);
                          setHideModeToggle(false);
                          window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Account created: ${newUser.name}`, kind: 'success' } }));
                          // notify other components (LeftPanel) that the user changed
                          window.dispatchEvent(new CustomEvent('ai_user_changed'));
                        }
                      } catch (e) {
                        window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Create account failed: ${String(e)}`, kind: 'error' } }));
                      } finally { setAuthLoading(false); }
                    }}>Create account</button>
                    <button style={{ background: '#2ea0ff', border: 'none', padding: '9px 14px', borderRadius: 8, fontWeight: 700, color: '#04253b' }} className="prompt-btn" onClick={() => { localStorage.setItem('ai_user_msg_count', '0'); setUserMessageCount(0); setShowSignupModal(false); }}>Continue as guest</button>
                  </div>
                </div>
              )}
            </div>
        </div>
      )}

      {/* Suggestion bar populated from RightPanel summary processing */}
      {suggestions && suggestions.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              className="suggestion-chip"
              onClick={() => {
                  // insert suggestion at the current caret position (or append) and focus
                  const area = inputRef.current;
                  if (!area) {
                    setInput(s);
                  } else {
                    const start = area.selectionStart ?? area.value.length;
                    const end = area.selectionEnd ?? start;
                    const before = area.value.slice(0, start);
                    const after = area.value.slice(end);
                    const nextVal = (before + s + after).trimStart();
                    setInput(nextVal);
                    // set caret right after inserted suggestion
                    setTimeout(() => {
                      area.focus();
                      const caret = (before + s).length;
                      area.setSelectionRange(caret, caret);
                    }, 0);
                  }
                }}
              style={{ padding: '6px 10px', borderRadius: 6 }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* debug UI removed */}

      <div style={{ marginTop: 8 }}>
        <button
          className="prompt-btn"
          onClick={async () => {
            if (!activeThread) return;
            if (!window.confirm("Delete this chat history for the selected thread?")) return;
            const userId = localStorage.getItem("user_id") || "u1";
            try {
              const resp = await fetch(`${API_BASE}/messages/${encodeURIComponent(userId)}/${encodeURIComponent(activeThread.thread_id)}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json", ...(getAuthHeader()) },
                credentials: 'include',
              });
              if (!resp.ok) {
                const body = await resp.text().catch(() => "");
                window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Failed to delete chat: ${resp.status} ${body}`, kind: 'error' } }));
                return;
              }
              setMessages([]);
              window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Chat history deleted.', kind: 'success' } }));
            } catch (e) {
              window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: `Delete failed: ${String(e)}`, kind: 'error' } }));
            }
          }}
        >
          Delete Chat
        </button>
      </div>
    </div>
  );
}

function getFakeResponse(input: string, preferences?: UserPreferences): string {
  if (!preferences) return "I’m here to listen.";
  if ((preferences as any).default_tone === "direct") {
    return "Let’s simplify this. What decision are you actually trying to make?";
  }
  if ((preferences as any).depth_level === "deep") {
    return "Let me reflect this back. It sounds like you’re torn between safety and growth. What’s driving that tension right now?";
  }
  return "I’m hearing a few competing thoughts here. Want to slow down and look at them one by one?";
}

