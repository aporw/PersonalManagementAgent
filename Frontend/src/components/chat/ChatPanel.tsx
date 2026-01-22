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

  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
      void fetch(`${API_BASE}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userPayload),
      });
    } catch (e) {
      pushDebug(`POST /message (user) failed: ${String(e)}`);
    }

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
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ user_id: userId, thread_id: threadId, message: text }),
        signal: ac.signal,
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
        void fetch(`${API_BASE}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(assistantPayload),
        });
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
      <div className="chat-header">
        <h3>{activeThread?.title ?? "Thinking space"}</h3>
      </div>

      <div className="messages" aria-live="polite">
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
          placeholder="Think out loud…"
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
          <button onClick={handleSend} disabled={sending || !input.trim()} style={{ minWidth: 100 }}>
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
                headers: { "Content-Type": "application/json" },
              });
              if (!resp.ok) {
                const body = await resp.text().catch(() => "");
                alert("Failed to delete chat: " + resp.status + " " + body);
                return;
              }
              setMessages([]);
              alert("Chat history deleted.");
            } catch (e) {
              alert("Delete failed: " + String(e));
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

