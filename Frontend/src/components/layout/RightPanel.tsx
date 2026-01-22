import { DetectedMode, SessionSummary, JournalEntry } from "../../types/thinking";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { journalEntries as seededJournal } from "../../data/journal";
import "./RightPanel.css";

interface ThreadRef {
  thread_id: string;
  title: string;
}

interface RightPanelProps {
  mode?: DetectedMode;
  summary?: SessionSummary | null;
  threads?: ThreadRef[];
}

const MODE_HINTS: Record<
  DetectedMode,
  {
    label: string;
    description: string;
    suggestions: string[];
  }
> = {
  exploring_options: {
    label: "Exploration",
    description: "Exploring options and clarifying ideas.",
    suggestions: [
      "Ask why this problem matters",
      "Challenge your assumptions",
      "Explore alternative angles",
    ],
  },
  overwhelmed: {
    label: "Overwhelmed",
    description: "You're feeling overloaded or uncertain about where to start.",
    suggestions: [
      "Identify the smallest next step",
      "Prioritize ruthlessly",
      "Take a short break and return with fresh eyes",
    ],
  },
  reflective: {
    label: "Reflection",
    description: "You're processing past actions or thoughts.",
    suggestions: [
      "What worked well?",
      "What would you change?",
      "What pattern do you notice?",
    ],
  },
  decisive: {
    label: "Decision Making",
    description: "You're evaluating options and moving toward a choice.",
    suggestions: [
      "List pros and cons",
      "Define success criteria",
      "Identify irreversible decisions",
    ],
  },
};

export default function RightPanel({
  mode,
  summary: propSummary = null,
  threads = [],
}: RightPanelProps) {
  const modeConfig = mode ? MODE_HINTS[mode] : null;

  // API base: allow overriding via `REACT_APP_API_BASE` or window.API_BASE
  const API_BASE = (typeof window !== "undefined" && (window as any).API_BASE) || (process.env.REACT_APP_API_BASE as string) || "http://localhost:8000";

  const [openFull, setOpenFull] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [modalWidth, setModalWidth] = useState<number>(75); // vw
  const [showNewForm, setShowNewForm] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [fontChoice, setFontChoice] = useState<string>("Patrick Hand");

  // editing state
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  // summary / threads
  const [selectedThreadId, setSelectedThreadId] = useState<string>(
    threads?.[0]?.thread_id ?? "t1"
  );
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [fetchedSummary, setFetchedSummary] = useState<{
    current_state?: string;
    what_we_uncovered?: string;
    suggested_next_steps?: string;
  }>({});
  const [editingSection, setEditingSection] = useState<null | "current" | "uncovered" | "suggested">(null);
  const [draftCurrent, setDraftCurrent] = useState<string | undefined>(undefined);
  const [draftUncovered, setDraftUncovered] = useState<string | undefined>(undefined);
  const [draftSuggested, setDraftSuggested] = useState<string | undefined>(undefined);
  const [recentlyAdded, setRecentlyAdded] = useState<{ entry_id: string; section: "current" | "uncovered" | "suggested" } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const EDIT_KEY_PREFIX = "ai_edited_summary_";

  function loadEditedSummary(threadId: string) {
    try {
      const key = `${EDIT_KEY_PREFIX}${threadId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function persistEditedSummary(threadId: string, data: any) {
    try {
      const key = `${EDIT_KEY_PREFIX}${threadId}`;
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  // load entries from localStorage or seeded
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ai_journal_entries");
      if (raw) {
        setEntries(JSON.parse(raw));
      } else {
        setEntries(seededJournal);
      }
    } catch (e) {
      setEntries(seededJournal);
    }
  }, []);

  // persist helper
  function persistEntries(next: JournalEntry[]) {
    setEntries(next);
    try {
      localStorage.setItem("ai_journal_entries", JSON.stringify(next));
    } catch (e) {
      /* ignore */
    }
  }

  function startEdit(entry: JournalEntry) {
    setSelectedEntry(entry);
    setEditingEntryId(entry.entry_id);
    setEditTitle(entry.title);
    setEditContent(entry.content);
  }

  function saveEdit(entryId: string) {
    const next = entries.map((en) =>
      en.entry_id === entryId ? { ...en, title: editTitle, content: editContent } : en
    );
    persistEntries(next);
    setEditingEntryId(null);
    const updated = next.find((n) => n.entry_id === entryId) ?? null;
    setSelectedEntry(updated);
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setEditTitle("");
    setEditContent("");
  }

  function deleteEntry(entryId: string) {
    if (!window.confirm("Delete this journal entry?")) return;
    const next = entries.filter((e) => e.entry_id !== entryId);
    persistEntries(next);
    if (selectedEntry?.entry_id === entryId) {
      setSelectedEntry(next[0] ?? null);
    }
  }

  const latestEntry = entries[0] ?? null;

  // modal width + font choice persistence
  useEffect(() => {
    try {
      const w = localStorage.getItem("ai_journal_modal_width");
      if (w) setModalWidth(Number(w));
    } catch (e) {}
  }, []);

  useEffect(() => {
    try {
      const f = localStorage.getItem("ai_journal_font");
      if (f) setFontChoice(f);
    } catch (e) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("ai_journal_modal_width", String(modalWidth));
    } catch (e) {}
  }, [modalWidth]);

  useEffect(() => {
    try {
      localStorage.setItem("ai_journal_font", fontChoice);
    } catch (e) {}
  }, [fontChoice]);

  // keep selectedThreadId in sync if threads prop changes
  useEffect(() => {
    if (threads && threads.length > 0) {
      setSelectedThreadId((s) => s || threads[0].thread_id);
    }
  }, [threads]);

  // --- Summary post-processing helpers (client-side truncation/formatting) ---
  const limitSentences = (text: string | undefined | null, maxSentences = 3, maxWords = 40) => {
    if (!text) return "";
    const cleaned = String(text).replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    // split on end-of-sentence punctuation followed by space
    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const taken = sentences.slice(0, maxSentences).join(' ');
    const words = taken.split(/\s+/).filter(Boolean);
    if (words.length > maxWords) return words.slice(0, maxWords).join(' ') + '…';
    return taken;
  };

  const extractListItems = (text: string | undefined | null) => {
    if (!text) return [] as string[];
    const normalized = String(text).replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    // detect explicit bullets or numbered lines
    const bullets = lines.filter((l) => /^[-•*]\s+/.test(l) || /^\d+[\.\)]\s+/.test(l));
    if (bullets.length) {
      return bullets.map((l) => l.replace(/^[-•*\d\.\)\s]+/, '').trim());
    }
    // fallback: split into sentences
    const sentences = normalized.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length > 1) return sentences;
    // fallback: split by semicolons or pipes
    const parts = normalized.split(/[;|\u2022]/).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts : [normalized];
  };

  const processCurrentState = (text: string | undefined | null) => {
    // 2-3 short sentences, roughly capped to ~40 words
    return limitSentences(text, 3, 40);
  };

  const processWhatWeUncovered = (text: string | undefined | null) => {
    const items = extractListItems(text);
    const take = items.slice(0, 3);
    if (take.length === 0) return '';
    // return as dash-list so renderRichText shows bullets
    return take.map((it) => `- ${it}`).join('\n');
  };

  const processSuggestedNextSteps = (text: string | undefined | null) => {
    const items = extractListItems(text);
    const take = items.slice(0, 4).map((it) => {
      // keep only the short title before ':' or ' - '
      const short = it.split(/[:\-|–—]/)[0].trim();
      // cap title length to reasonable words
      const words = short.split(/\s+/).slice(0, 12).join(' ');
      return words;
    });
    if (take.length === 0) return '';
    return take.map((t) => `- ${t}`).join('\n');
  };

  async function fetchSummaryForThread(threadId: string) {
    // debounce guard: prevent repeat calls within short window (60s)
    const now = Date.now();
    if (lastFetchRef.current && now - lastFetchRef.current < 60000) {
      window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Please wait a moment before updating highlights again.', kind: 'warn' } }));
      return;
    }
    lastFetchRef.current = now;

    setLoadingSummary(true);
    const USER_ID = localStorage.getItem("user_id") || "u1";
    try {
      // fetch stored messages for the thread, then POST them to /summary so we explicitly pass the chat
      const msgsRes = await fetch(`${API_BASE}/messages/${encodeURIComponent(USER_ID)}/${encodeURIComponent(threadId)}`);
      if (!msgsRes.ok) {
        throw new Error("Failed to load messages");
      }
      const msgsJson = await msgsRes.json();
      const conversation = (msgsJson.messages || []).map((m: any) => ({ role: m.role || "user", content: m.content || "" }));

      // fetch any server-saved summary first so we can include it as prior context
      let serverSavedSummary: any = {};
      try {
        const savedRes = await fetch(`${API_BASE}/summary/saved/${encodeURIComponent(USER_ID)}/${encodeURIComponent(threadId)}`);
        if (savedRes.ok) {
          const sv = await savedRes.json();
          serverSavedSummary = sv?.summary || {};
        }
      } catch (e) {
        // ignore
      }

      const summaryRes = await fetch(`${API_BASE}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ conversation, last_summary: serverSavedSummary && (typeof serverSavedSummary === 'string' ? serverSavedSummary : JSON.stringify(serverSavedSummary)) }),
      });

      if (!summaryRes.ok) {
        // try to extract error details from the response body
        let errBody = "";
        try {
          const t = await summaryRes.text();
          errBody = t;
        } catch (e) {
          errBody = String(e);
        }
        console.error("summary error", summaryRes.status, errBody);
        setFetchedSummary({
          current_state: `Error loading summary (${summaryRes.status}): ${errBody}`,
          what_we_uncovered: "",
          suggested_next_steps: "",
        });
        } else {
        const data = await summaryRes.json();
        // backend returns a JSON string in `summary` field (structured inside); handle both shapes
        let parsed: any = {};
        try {
          parsed = typeof data.summary === "string" ? JSON.parse(data.summary) : data;
        } catch (e) {
          parsed = data;
        }
        const base = {
          current_state: parsed.current_state || parsed.summary?.current_state || "",
          what_we_uncovered: parsed.what_we_uncovered || parsed.summary?.what_we_uncovered || "",
          suggested_next_steps: parsed.suggested_next_steps || parsed.summary?.suggested_next_steps || "",
        };
        // Normalize fields: backend may return arrays (for bullets) or strings.
        const normalizeField = (v: any) => {
          if (Array.isArray(v)) return v.join("\n");
          if (v === null || v === undefined) return "";
          return String(v);
        };
        const normBase = {
          current_state: normalizeField(base.current_state),
          what_we_uncovered: normalizeField(base.what_we_uncovered),
          suggested_next_steps: normalizeField(base.suggested_next_steps),
        };
        // Post-process summary fields to keep outputs concise and readable
        const processedBase = {
          current_state: processCurrentState(normBase.current_state),
          what_we_uncovered: processWhatWeUncovered(normBase.what_we_uncovered),
          suggested_next_steps: processSuggestedNextSteps(normBase.suggested_next_steps),
        };
        // apply any locally edited overrides and server-saved overrides (edits override processed defaults)
        const edited = loadEditedSummary(threadId) || {};
        let merged = { ...processedBase, ...edited };
        try {
          const USER_ID = localStorage.getItem("user_id") || "u1";
          const savedRes = await fetch(`${API_BASE}/summary/saved/${encodeURIComponent(USER_ID)}/${encodeURIComponent(threadId)}`);
          if (savedRes.ok) {
            const sv = await savedRes.json();
            const serverSummary = sv?.summary || {};
            // normalize server-saved fields as well (they might be arrays)
            const serverNorm: any = {};
            if (serverSummary.current_state !== undefined) serverNorm.current_state = normalizeField(serverSummary.current_state);
            if (serverSummary.what_we_uncovered !== undefined) serverNorm.what_we_uncovered = normalizeField(serverSummary.what_we_uncovered);
            if (serverSummary.suggested_next_steps !== undefined) serverNorm.suggested_next_steps = normalizeField(serverSummary.suggested_next_steps);
            merged = { ...merged, ...serverNorm };
          }
        } catch (e) {
          // ignore server-side fetch errors and continue with local/processed summary
        }
        setFetchedSummary(merged);

        // Dispatch suggestions to the ChatPanel so they become available as clickable inserts
        try {
          // helper: split concatenated Title-Case suggestions when punctuation is missing
          const splitConcatenatedSuggestions = (txt: string) => {
            if (!txt) return [] as string[];
            const s = String(txt).replace(/\s+/g, " ").trim();
            // if there are obvious separators, split on them
            if (/[•\-–—\n,;|]/.test(s)) {
              return s.split(/[\n,;|•\-–—]+/).map((t) => t.trim()).filter(Boolean);
            }
            // Heuristic: split where a lowercase/number is followed by a capitalized word
            const parts = s.replace(/([a-z0-9])\s+(?=[A-Z])/g, '$1|||').split('|||').map((t) => t.trim()).filter(Boolean);
            if (parts.length > 1) return parts;
            // Fallback: return the original as single-item array
            return [s];
          };

          const rawSuggested = merged.suggested_next_steps || "";
          let candidates = splitConcatenatedSuggestions(rawSuggested);
          if (!candidates || candidates.length <= 1) {
            // fallback to existing list extraction logic
            candidates = extractListItems(rawSuggested);
          }
          // Stronger fallback: if we still have one long Title-Case string, try splitting on common action verbs
          if (candidates.length === 1) {
            const long = String(candidates[0] || "").trim();
            const verbRegex = /\b(Identify|Assess|Research|Define|Plan|Create|Organize|Explore|List|Set|Develop|Prioritize|Evaluate|Write|Map|Schedule|Clarify)\b/gi;
            const matches: { idx: number; word: string }[] = [];
            // Use exec loop to avoid needing downlevelIteration / matchAll compatibility
            verbRegex.lastIndex = 0;
            let mm: RegExpExecArray | null;
            while ((mm = verbRegex.exec(long)) !== null) {
              matches.push({ idx: mm.index ?? 0, word: mm[0] });
            }
            if (matches.length > 1) {
              const splits: string[] = [];
              for (let i = 0; i < matches.length; i++) {
                const start = matches[i].idx as number;
                const end = i + 1 < matches.length ? matches[i+1].idx as number : long.length;
                const piece = long.slice(start, end).trim();
                if (piece) splits.push(piece);
              }
              if (splits.length > 1) candidates = splits;
            }
          }

          const suggestionItems = candidates
            .slice(0, 8)
            .map((s) => {
              const cleaned = String(s).replace(/^\*+/, "").replace(/\*+$/, "").trim();
              return cleaned.slice(0, 120);
            })
            .filter(Boolean);
          window.dispatchEvent(new CustomEvent("ai_suggestions", { detail: { suggestions: suggestionItems } }));
        } catch (e) {
          // ignore dispatch errors
        }
      }
    } catch (e) {
      console.error(e);
      setFetchedSummary({
        current_state: "Error contacting server",
        what_we_uncovered: "",
        suggested_next_steps: "",
      });
    } finally {
      setLoadingSummary(false);
    }
  }

  // prevent accidental repeated Update Highlights calls by debouncing client-side
  const lastFetchRef = useRef<number>(0);
  function debouncedFetchSummary(threadId: string) {
    // keep a light guard here; the main debounce/guard lives inside fetchSummaryForThread
    const now = Date.now();
    if (lastFetchRef.current && now - lastFetchRef.current < 60000) {
      window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Please wait a moment before updating highlights again.', kind: 'warn' } }));
      return;
    }
    void fetchSummaryForThread(threadId);
  }

  // auto-load initial thread summary when selectedThreadId changes
  useEffect(() => {
    if (selectedThreadId) {
      fetchSummaryForThread(selectedThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId]);

  // helpers to start editing and save/cancel
  function startEditSection(section: "current" | "uncovered" | "suggested") {
    setEditingSection(section);
    if (section === "current") setDraftCurrent(fetchedSummary.current_state ?? "");
    if (section === "uncovered") setDraftUncovered(fetchedSummary.what_we_uncovered ?? "");
    if (section === "suggested") setDraftSuggested(fetchedSummary.suggested_next_steps ?? "");
  }

  function cancelEditSection() {
    setEditingSection(null);
    setDraftCurrent(undefined);
    setDraftUncovered(undefined);
    setDraftSuggested(undefined);
  }

  function saveEditSection(section: "current" | "uncovered" | "suggested") {
    const threadId = selectedThreadId;
    const next = { ...fetchedSummary } as any;
    if (section === "current") next.current_state = draftCurrent ?? next.current_state;
    if (section === "uncovered") next.what_we_uncovered = draftUncovered ?? next.what_we_uncovered;
    if (section === "suggested") next.suggested_next_steps = draftSuggested ?? next.suggested_next_steps;
    setFetchedSummary(next);
    // persist per-thread edits
    persistEditedSummary(threadId, {
      current_state: next.current_state,
      what_we_uncovered: next.what_we_uncovered,
      suggested_next_steps: next.suggested_next_steps,
    });
    // also POST edits to the backend so summaries persist across devices
    try {
      const USER_ID = localStorage.getItem("user_id") || "u1";
      void fetch(`${API_BASE}/summary/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, thread_id: threadId, summary: {
          current_state: next.current_state,
          what_we_uncovered: next.what_we_uncovered,
          suggested_next_steps: next.suggested_next_steps,
        }}),
      });
    } catch (e) {
      // ignore network errors; client still has local copy
    }
    setEditingSection(null);
  }

  // Add the content of a summary tile as a new journal entry
  function addTileToJournal(section: "current" | "uncovered" | "suggested") {
    const titleMap: Record<string, string> = {
      current: "Current state",
      uncovered: "What we’ve uncovered",
      suggested: "Suggested next steps",
    };
    let body = "";
    if (section === "current") body = editingSection === "current" ? (draftCurrent ?? "") : (fetchedSummary.current_state ?? "");
    if (section === "uncovered") body = editingSection === "uncovered" ? (draftUncovered ?? "") : (fetchedSummary.what_we_uncovered ?? "");
    if (section === "suggested") body = editingSection === "suggested" ? (draftSuggested ?? "") : (fetchedSummary.suggested_next_steps ?? "");

    const text = (body || "").toString().trim();
    if (!text) {
      window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Nothing to add to journal.', kind: 'warn' } }));
      return;
    }

    const entry: JournalEntry = {
      entry_id: `j${Date.now()}`,
      linked_session_id: "",
      title: titleMap[section] || "Summary",
      content: text,
      created_at: new Date().toISOString(),
      source: "ai_suggested",
    };
    const next = [entry, ...entries];
    persistEntries(next);
    // show toast with Undo action wired to a global undo event
    window.dispatchEvent(new CustomEvent('ai_toast', {
      detail: {
        message: `Added \"${entry.title}\" to your journal.`,
        kind: 'success',
        actionLabel: 'Undo',
        actionEvent: 'undo_journal_add',
        actionPayload: { entry_id: entry.entry_id },
      }
    }));

    // also set a local recentlyAdded state so the + button becomes an inline Undo for a short window
    try {
      setRecentlyAdded({ entry_id: entry.entry_id, section });
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current as any);
      undoTimerRef.current = window.setTimeout(() => {
        setRecentlyAdded(null);
        undoTimerRef.current = null;
      }, 6000) as unknown as number;
    } catch (e) {
      // ignore timer errors in some environments
    }
  }

  // local undo handler (used when user clicks inline Undo button)
  function undoRecentAdd(entryId?: string) {
    const id = entryId || recentlyAdded?.entry_id;
    if (!id) return;
    setEntries((prev) => {
      const next = prev.filter((p) => p.entry_id !== id);
      try { localStorage.setItem('ai_journal_entries', JSON.stringify(next)); } catch (err) {}
      return next;
    });
    setRecentlyAdded(null);
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current as any);
      undoTimerRef.current = null;
    }
    window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Removed entry.', kind: 'info' } }));
  }

  // Listen for undo events from the toast manager and remove the corresponding entry
  useEffect(() => {
    function handleUndo(e: any) {
      const id = e.detail?.entry_id;
      if (!id) return;
      setEntries((prev) => {
        const next = prev.filter((p) => p.entry_id !== id);
        try { localStorage.setItem('ai_journal_entries', JSON.stringify(next)); } catch (err) {}
        return next;
      });
      // inform user
      window.dispatchEvent(new CustomEvent('ai_toast', { detail: { message: 'Removed entry.', kind: 'info' } }));
    }
    window.addEventListener('undo_journal_add', handleUndo as EventListener);
    return () => window.removeEventListener('undo_journal_add', handleUndo as EventListener);
  }, []);

  // helper to render returned summary text as paragraphs or lists
  const renderRichText = (txt?: string | null) => {
    if (!txt) return <span className="muted">—</span>;
    // normalize line endings
    const normalized = String(txt).replace(/\r\n/g, "\n").trim();
    if (!normalized) return <span className="muted">—</span>;

    const lines = normalized.split(/\n+/).map((s) => s.trim()).filter(Boolean);

    // detect bullet list (lines starting with '- ')
    const isDashList = lines.every((l) => /^[-•*]\s+/.test(l));
    if (isDashList) {
      return <ul>{lines.map((l, i) => <li key={i}>{l.replace(/^[-•*]\s+/, "")}</li>)}</ul>;
    }

    // detect numbered list (lines starting with '1.' etc)
    const isNumbered = lines.every((l) => /^\d+\./.test(l));
    if (isNumbered) {
      return <ol>{lines.map((l, i) => <li key={i}>{l.replace(/^\d+\.\s*/, "")}</li>)}</ol>;
    }

    // otherwise render paragraphs for double-newline separated blocks
    if (lines.length > 1) {
      return <div>{lines.map((p, i) => <p key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>{p}</p>)}</div>;
    }

    // single-line text
    return <div>{normalized}</div>;
  };

  return (
    <aside className="right-panel" style={{ maxHeight: "calc(100vh - 48px)", overflow: "auto" }}>
      <section className="right-panel__section">
        <div className="info-tile current-state">
          <div className="current-state-head">
            <div>
              <div>
                <button
                  className="highlights-btn"
                  onClick={() => debouncedFetchSummary(selectedThreadId)}
                  disabled={loadingSummary}
                  aria-label="Update Highlights"
                >
                  {loadingSummary ? <span className="ai-spinner" aria-hidden /> : "Update Highlights"}
                </button>
              </div>
              
            </div>

            <div className="state-controls" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="state-ornament" aria-hidden>
                {/* decorative SVG */}
                <svg width="54" height="54" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2v6l4 2" stroke="rgba(123,97,255,0.18)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="9" stroke="rgba(123,97,255,0.06)" strokeWidth="1.2" />
                </svg>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {threads.length > 0 ? (
                  <select
                    value={selectedThreadId}
                    onChange={(e) => setSelectedThreadId(e.target.value)}
                    className="thread-selector"
                  >
                    {threads.map((t) => (
                      <option key={t.thread_id} value={t.thread_id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>

          <div className="info-body">
            {/* mode hint removed as requested (removed 'Exploring options...' short description) */}

            <div className="info-section uncovered uncovered-what">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600 }}>Current state</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {editingSection === 'current' ? (
                    <>
                      <button className="prompt-btn" onClick={() => saveEditSection('current')}>Save</button>
                      <button className="prompt-btn" onClick={cancelEditSection}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="prompt-btn" onClick={() => startEditSection('current')} aria-label="Edit">✏️</button>
                      {recentlyAdded?.section === 'current' && recentlyAdded.entry_id ? (
                        <button className="prompt-btn undo-btn" onClick={() => undoRecentAdd(recentlyAdded.entry_id)}>Undo</button>
                      ) : (
                        <button className="prompt-btn add-btn" onClick={() => addTileToJournal('current')} aria-label="Add to journal">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="summary-text" style={{ fontSize: 16, lineHeight: 1.5, marginTop: 8 }}>
                {editingSection === 'current' ? (
                  <textarea value={draftCurrent ?? ''} onChange={(e) => setDraftCurrent(e.target.value)} style={{ width: '100%', minHeight: 120 }} />
                ) : (
                  renderRichText(fetchedSummary.current_state ?? (propSummary as any)?.current_state ?? (propSummary as any)?.summary_text ?? "No summary yet. Click 'Update Highlights'.")
                )}
              </div>
            </div>


            <div className="info-section uncovered">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>What we’ve uncovered</h4>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {editingSection === 'uncovered' ? (
                    <>
                      <button className="prompt-btn" onClick={() => saveEditSection('uncovered')}>Save</button>
                      <button className="prompt-btn" onClick={cancelEditSection}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="prompt-btn" onClick={() => startEditSection('uncovered')} aria-label="Edit">✏️</button>
                      {recentlyAdded?.section === 'uncovered' && recentlyAdded.entry_id ? (
                        <button className="prompt-btn undo-btn" onClick={() => undoRecentAdd(recentlyAdded.entry_id)}>Undo</button>
                      ) : (
                        <button className="prompt-btn add-btn" onClick={() => addTileToJournal('uncovered')} aria-label="Add to journal">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="summary-text" style={{ fontSize: 16, lineHeight: 1.5, marginTop: 8 }}>
                {editingSection === 'uncovered' ? (
                  <textarea value={draftUncovered ?? ''} onChange={(e) => setDraftUncovered(e.target.value)} style={{ width: '100%', minHeight: 120 }} />
                ) : (
                  renderRichText(fetchedSummary.what_we_uncovered ?? (propSummary && propSummary.key_points?.length ? propSummary.key_points.join("\n") : "—"))
                )}
              </div>
            </div>

            <div className="info-section suggestions">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>Suggested next steps</h4>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {editingSection === 'suggested' ? (
                    <>
                      <button className="prompt-btn" onClick={() => saveEditSection('suggested')}>Save</button>
                      <button className="prompt-btn" onClick={cancelEditSection}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="prompt-btn" onClick={() => startEditSection('suggested')} aria-label="Edit">✏️</button>
                      {recentlyAdded?.section === 'suggested' && recentlyAdded.entry_id ? (
                        <button className="prompt-btn undo-btn" onClick={() => undoRecentAdd(recentlyAdded.entry_id)}>Undo</button>
                      ) : (
                        <button className="prompt-btn add-btn" onClick={() => addTileToJournal('suggested')} aria-label="Add to journal">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="summary-text" style={{ fontSize: 16, lineHeight: 1.5, marginTop: 8 }}>
                {editingSection === 'suggested' ? (
                  <textarea value={draftSuggested ?? ''} onChange={(e) => setDraftSuggested(e.target.value)} style={{ width: '100%', minHeight: 120 }} />
                ) : (
                  renderRichText(fetchedSummary.suggested_next_steps ?? "—")
                )}

              {/* suggestion chips removed here — suggestions are dispatched to ChatPanel for insertion into the chat input */}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Journal tile */}
      <section className="right-panel__section">
        <div
          className="journal-tile"
          role="button"
          onClick={() => setOpenFull(true)}
          aria-pressed={openFull}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setOpenFull(true);
          }}
        >
          <div className="journal-icon big" aria-hidden>
            📔
          </div>
          <div className="journal-label">Your Journal</div>
        </div>
      </section>

      {openFull && typeof document !== "undefined" && document.body
        ? createPortal(
            <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setOpenFull(false)}>
              <div
                className={`modal full-journal`}
                style={{ width: `${modalWidth}vw` }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h3>Your Journal</h3>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <label className="muted" style={{ fontSize: "0.85rem" }}>Width</label>
                    <input
                      type="range"
                      min={60}
                      max={95}
                      value={modalWidth}
                      onChange={(e) => setModalWidth(Number(e.target.value))}
                    />
                    <label className="muted" style={{ fontSize: "0.85rem" }}>Font</label>
                    <select className="font-picker" value={fontChoice} onChange={(e) => setFontChoice(e.target.value)} aria-label="Journal font picker">
                      <option value="Patrick Hand">Patrick Hand</option>
                      <option value="Indie Flower">Indie Flower</option>
                      <option value="Caveat">Caveat</option>
                    </select>
                    <button className="prompt-btn" onClick={() => setOpenFull(false)}>Close</button>
                  </div>
                </div>

                <div className="modal-body" style={{ alignItems: "stretch" }}>
                  <div className="journal-list" style={{ width: "300px" }}>
                    <div className="journal-list-header muted">Entries</div>
                    <ul>
                      {entries.map((e) => (
                        <li key={e.entry_id} className={`journal-list-item ${selectedEntry?.entry_id === e.entry_id ? "active" : ""}`} onClick={() => setSelectedEntry(e)}>
                          <div className="jl-title">{e.title}</div>
                          <div className="jl-date muted">{new Date(e.created_at).toLocaleDateString()}</div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="journal-right" style={{ flex: 1 }}>
                    <div className="journal-new-row" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h4 style={{ margin: 0 }}>New Entry</h4>
                        <button className="prompt-btn" onClick={() => { setShowNewForm((s) => !s); setNewTitle(""); setNewContent(""); }}>
                          {showNewForm ? "Cancel" : "New"}
                        </button>
                      </div>

                      {showNewForm && (
                        <div style={{ display: "flex", gap: 12 }}>
                          <div style={{ width: 160 }}>
                            <input className="journal-input title-input" placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <textarea className="journal-textarea" placeholder="Write your entry..." value={newContent} onChange={(e) => setNewContent(e.target.value)} style={{ fontFamily: fontChoice }} />
                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                              <button className="prompt-btn" onClick={() => {
                                const t = newTitle;
                                const c = newContent;
                                if (!t.trim() && !c.trim()) return;
                                const entry: JournalEntry = { entry_id: `j${Date.now()}`, linked_session_id: "", title: t.trim() || "Untitled", content: c.trim(), created_at: new Date().toISOString(), source: "user_written" };
                                const next = [entry, ...entries];
                                persistEntries(next);
                                setSelectedEntry(entry);
                                setShowNewForm(false);
                                setNewTitle("");
                                setNewContent("");
                              }}>Save Entry</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="journal-preview" style={{ marginTop: 12 }}>
                      {selectedEntry ? (
                        editingEntryId === selectedEntry.entry_id ? (
                          <div className="notebook-card">
                            <div className="note-head">
                              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                <input className="journal-input title-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                                  <button className="prompt-btn" onClick={() => saveEdit(selectedEntry.entry_id)}>Save</button>
                                  <button className="prompt-btn" onClick={cancelEdit}>Cancel</button>
                                </div>
                              </div>
                              <div className="muted">{new Date(selectedEntry.created_at).toLocaleString()}</div>
                            </div>
                            <div className="note-body">
                              <textarea className="journal-textarea" value={editContent} onChange={(e) => setEditContent(e.target.value)} style={{ fontFamily: fontChoice }} />
                            </div>
                          </div>
                        ) : (
                          <div className="notebook-card">
                            <div className="note-head" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <strong>{selectedEntry.title}</strong>
                              <div className="muted">{new Date(selectedEntry.created_at).toLocaleString()}</div>
                              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                                <button className="prompt-btn" onClick={() => startEdit(selectedEntry)}>Edit</button>
                                <button className="prompt-btn" onClick={() => deleteEntry(selectedEntry.entry_id)}>Delete</button>
                              </div>
                            </div>
                            <div className="note-body">
                              {selectedEntry.content.split("\n").map((ln, i) => (
                                <div key={i} className="note-line" style={{ fontFamily: fontChoice }}>{ln}</div>
                              ))}
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="muted">Select an entry from the left to view it here.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </aside>
  );
}

// Small form component for creating a journal entry (kept local)
function JournalForm({ onSave }: { onSave: (e: JournalEntry) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  function handleSave() {
    if (!title.trim() && !content.trim()) return;
    const entry: JournalEntry = {
      entry_id: `j${Date.now()}`,
      linked_session_id: "",
      title: title.trim() || "Untitled",
      content: content.trim(),
      created_at: new Date().toISOString(),
      source: "user_written",
    };
    onSave(entry);
    setTitle("");
    setContent("");
  }

  return (
    <div>
      <input className="journal-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="journal-textarea" placeholder="Write your entry..." value={content} onChange={(e) => setContent(e.target.value)} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="prompt-btn" onClick={handleSave}>Save Entry</button>
      </div>
    </div>
  );
}