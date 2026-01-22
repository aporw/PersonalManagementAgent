# ...existing code...
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import os
from pathlib import Path
from dotenv import load_dotenv, dotenv_values
from openai import OpenAI
import json
import typing as t
from datetime import datetime

# Load environment variables from Backend/.env and override any existing shell vars
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path, override=True)
for k, v in dotenv_values(env_path).items():
    if v is not None:
        os.environ[k] = v

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

# === CORS Setup ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Data Models -----

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str

class Message(BaseModel):
    role: str   # "user" or "assistant"
    content: str
    ts: t.Optional[str] = None

class SummaryRequest(BaseModel):
    conversation: t.List[Message]
    last_summary: t.Optional[str] = None

class SummaryResponse(BaseModel):
    summary: str

class NewMessage(BaseModel):
    user_id: str
    thread_id: str
    role: str
    content: str
    ts: t.Optional[str] = None

# ----- Storage helpers -----
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(exist_ok=True)

def _thread_path(user_id: str, thread_id: str) -> Path:
    safe_user = "".join(ch for ch in user_id if ch.isalnum() or ch in "-_")
    safe_thread = "".join(ch for ch in thread_id if ch.isalnum() or ch in "-_")
    return DATA_DIR / f"{safe_user}__{safe_thread}.json"


def _summary_path(user_id: str, thread_id: str) -> Path:
    safe_user = "".join(ch for ch in user_id if ch.isalnum() or ch in "-_")
    safe_thread = "".join(ch for ch in thread_id if ch.isalnum() or ch in "-_")
    return DATA_DIR / f"{safe_user}__{safe_thread}__summary.json"


def load_saved_summary(user_id: str, thread_id: str) -> t.Optional[dict]:
    p = _summary_path(user_id, thread_id)
    if not p.exists():
        return None
    try:
        with p.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_summary(user_id: str, thread_id: str, summary: dict):
    p = _summary_path(user_id, thread_id)
    with p.open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

def load_messages(user_id: str, thread_id: str) -> t.List[dict]:
    p = _thread_path(user_id, thread_id)
    if not p.exists():
        return []
    try:
        with p.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_messages(user_id: str, thread_id: str, messages: t.List[dict]):
    p = _thread_path(user_id, thread_id)
    with p.open("w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)

# ----- Helpers / Validation -----

MAX_MESSAGE_LENGTH = 4000
MAX_CONVERSATION_MESSAGES = 500

def validate_message_text(text: str) -> t.Optional[JSONResponse]:
    if text is None:
        return JSONResponse(status_code=400, content={"detail": "message is required"})
    txt = str(text).strip()
    if not txt:
        return JSONResponse(status_code=400, content={"detail": "message cannot be empty"})
    if len(txt) > MAX_MESSAGE_LENGTH:
        return JSONResponse(status_code=400, content={"detail": f"message too long (>{MAX_MESSAGE_LENGTH} chars)"})
    return None


def is_personal_topic(text: str) -> bool:
    """Heuristic check whether the user's text appears to be about personal management,
    mental state, career, relationships, or anxiety. This is intentionally lightweight
    — consider replacing with a classifier or safety check for production."""
    if not text:
        return False
    txt = str(text).lower()
    # keywords indicating personal topics
    keywords = [
        "career",
        "job",
        "work",
        "promotion",
        "manager",
        "anxiety",
        "anxious",
        "depress",
        "depressed",
        "mental",
        "feeling",
        "feel",
        "stress",
        "therapy",
        "relationship",
        "partner",
        "breakup",
        "decision",
        "choices",
        "stuck",
        "overwhelm",
        "overwhelmed",
        "procrastin",
        "goal",
        "habit",
        "routine",
        "wellbeing",
        "well-being",
    ]
    for k in keywords:
        if k in txt:
            return True
    # also consider first-person phrases about feelings
    if any(phr in txt for phr in ("i feel", "i'm feeling", "i am feeling", "i am worried", "i'm worried", "i'm stressed", "i feel anxious")):
        return True
    return False

def validate_conversation(conv: list) -> t.Optional[JSONResponse]:
    if not isinstance(conv, list) or len(conv) == 0:
        return JSONResponse(status_code=400, content={"detail": "conversation must be a non-empty list"})
    if len(conv) > MAX_CONVERSATION_MESSAGES:
        return JSONResponse(status_code=400, content={"detail": f"conversation too long (>{MAX_CONVERSATION_MESSAGES} messages)"})
    for m in conv:
        # support both raw dicts and pydantic model instances
        if isinstance(m, dict):
            role = m.get("role")
            content = m.get("content")
        else:
            role = getattr(m, "role", None)
            content = getattr(m, "content", None)
        if not role or not content:
            return JSONResponse(status_code=400, content={"detail": "each message must have role and content"})
    return None

def extract_delta_text(chunk) -> str:
    try:
        ch = chunk.choices[0]
        delta = getattr(ch, "delta", None) or (ch.get("delta") if isinstance(ch, dict) else None)
        if not delta:
            return ""
        content = delta.get("content") if isinstance(delta, dict) else getattr(delta, "content", None)
        return content or ""
    except Exception:
        try:
            return str(chunk)
        except Exception:
            return ""

# ----- Prompt templates (override via ENV if needed) -----
CURRENT_PROMPT = os.getenv("CURRENT_PROMPT") or (
    "Summarize the user's CURRENT STATE in a personal, second-person tone. "
    "Address the user directly (use 'You are...' phrasing where appropriate). "
    "Keep the summary concise and empathetic — 2–3 short sentences describing their present situation."
)
UNCOVERED_PROMPT = os.getenv("UNCOVERED_PROMPT") or (
    "List up to three key insights or problems uncovered in the conversation. "
    "Use short bullet points written in second-person (address the user as 'You ...'). Keep each bullet one short sentence."
)
SUGGESTED_PROMPT = os.getenv("SUGGESTED_PROMPT") or (
    "Provide up to four practical next-step titles the user can take, formatted as short titles (no descriptions). "
    "Write in a direct, second-person voice (imperative or short phrase)."
)

# ----- Routes -----

@app.get("/")
def health_check():
    return {"status": "ok"}


@app.post("/message")
async def append_message(msg: NewMessage, request: Request):
    # Log the incoming payload for debugging when validation fails
    try:
        raw = await request.json()
    except Exception:
        raw = None

    # validate
    if not msg.user_id or not msg.thread_id:
        print("[append_message] missing user_id/thread_id; raw payload:", raw)
        return JSONResponse(status_code=400, content={"detail": "user_id and thread_id are required"})
    v = validate_message_text(msg.content)
    if v:
        print("[append_message] validate_message_text failed; payload:", raw)
        return v
    try:
        messages = load_messages(msg.user_id, msg.thread_id)
        entry = {
            "role": msg.role,
            "content": msg.content,
            "ts": msg.ts or datetime.utcnow().isoformat(),
        }
        messages.append(entry)
        save_messages(msg.user_id, msg.thread_id, messages)
        return {"ok": True, "count": len(messages)}
    except Exception as e:
        print(f"[append_message] error saving messages: {e}; payload: {raw}")
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.get("/messages/{user_id}/{thread_id}")
def get_messages(user_id: str, thread_id: str):
    msgs = load_messages(user_id, thread_id)
    return {"messages": msgs, "count": len(msgs)}


@app.delete("/messages/{user_id}/{thread_id}")
def delete_messages(user_id: str, thread_id: str):
    """Delete all stored messages for a user/thread. Returns count 0 on success."""
    try:
        save_messages(user_id, thread_id, [])
        return {"ok": True, "count": 0}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request):
    # keep original behavior: single-message chat proxied to OpenAI
    err = validate_message_text(req.message)
    if err:
        return err

    # Restrict usage: only forward to OpenAI when the user's message is about
    # personal management / career / mental state / relationships, etc.
    if not is_personal_topic(req.message):
        # Do not call OpenAI; return a short informative reply
        return {"reply": "This assistant is restricted to personal topics (career, mental state, relationships, decision-making). For coding, general information, or other topics please use the appropriate tool or a general-purpose assistant."}

    system_prompt = os.getenv("SYSTEM_PROMPT") or (
        "You are an empathetic coaching assistant. Speak directly to the user in a warm, second-person tone (use 'You...' phrasing). Be concise, supportive, and practical."
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.message},
    ]

    stream_query = request.query_params.get("stream", "false").lower() == "true"
    accept_header = request.headers.get("accept", "")
    wants_sse = "text/event-stream" in accept_header

    if stream_query or wants_sse:
        def event_generator():
            try:
                resp_iter = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages,
                        temperature=0.7,
                        max_tokens=100,
                    stream=True,
                )
                for chunk in resp_iter:
                    text = extract_delta_text(chunk)
                    if text:
                        yield f"data: {json.dumps({'delta': text})}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    try:
        response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.7,
                max_tokens=100,
            )
        reply_text = ""
        try:
            reply_text = response.choices[0].message.content
        except Exception:
            reply_text = str(response)
        return {"reply": reply_text}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"OpenAI error: {str(e)}"})

@app.get("/summary/{user_id}/{thread_id}")
def summary_for_thread(user_id: str, thread_id: str):
    """
    Generate three structured summaries for the given user/thread:
      - current_state
      - uncovered
      - suggested_next_steps
    Results come from OpenAI (non-streaming).
    """
    msgs = load_messages(user_id, thread_id)
    if not msgs:
        return JSONResponse(status_code=404, content={"detail": "no messages for this user/thread"})

    # build conversation for model: include system then the messages
    conversation = [{"role": "system", "content": "You are a helpful assistant that summarizes conversations."}]
    for m in msgs:
        conversation.append({"role": m.get("role", "user"), "content": m.get("content", "")})

    def call_openai(prompt_template: str) -> str:
        # send the conversation plus instruction as last system message
        msgs_for_request = list(conversation)
        msgs_for_request.append({"role": "system", "content": prompt_template})
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=msgs_for_request,
                temperature=0.5,
                max_tokens=50,
            )
            try:
                return resp.choices[0].message.content
            except Exception:
                return str(resp)
        except Exception as e:
            return f"ERROR: {str(e)}"

    current = call_openai(CURRENT_PROMPT)
    uncovered = call_openai(UNCOVERED_PROMPT)
    suggested = call_openai(SUGGESTED_PROMPT)

    # Post-process to enforce length and shape server-side
    def limit_sentences(text: str, max_sentences: int = 3, max_words: int = 60) -> str:
        if not text:
            return ""
        cleaned = str(text).replace("\n", " ").strip()
        if not cleaned:
            return ""
        import re
        sentences = re.split(r'(?<=[.!?])\s+', cleaned)
        taken = " ".join(sentences[:max_sentences])
        words = taken.split()
        if len(words) > max_words:
            return " ".join(words[:max_words]) + "…"
        return taken

    def extract_list_items(text: str):
        if not text:
            return []
        normalized = str(text).replace('\r\n', '\n').strip()
        if not normalized:
            return []
        lines = [l.strip() for l in normalized.split('\n') if l.strip()]
        bullets = [l for l in lines if l.startswith('-') or l.startswith('•') or l[0].isdigit()]
        if bullets:
            cleaned = [re.sub(r'^[-•*\d\.\)\s]+', '', l).strip() for l in bullets]
            return cleaned
        # fallback to sentence split
        import re as _re
        sents = _re.split(r'(?<=[.!?])\s+', normalized)
        if len(sents) > 1:
            return sents
        # fallback split by semicolon
        parts = [p.strip() for p in normalized.split(';') if p.strip()]
        return parts if parts else [normalized]

    def process_current(text: str) -> str:
        return limit_sentences(text, max_sentences=3, max_words=60)

    def process_uncovered(text: str):
        items = extract_list_items(text)
        return items[:3]

    def process_suggested(text: str):
        items = extract_list_items(text)
        # shorten titles to first clause and cap length
        out = []
        for it in items[:4]:
            title = it.split(':')[0].split(' - ')[0].strip()
            words = title.split()[:12]
            out.append(' '.join(words))
        return out

    processed = {
        "current_state": process_current(current),
        "what_we_uncovered": process_uncovered(uncovered),
        "suggested_next_steps": process_suggested(suggested),
        "message_count": len(msgs),
    }

    return processed


@app.post("/summary", response_model=SummaryResponse)
def summary_from_conversation(req: SummaryRequest):
    # validate conversation
    v = validate_conversation(req.conversation)
    if v:
        return v

    def call_openai(prompt_template: str) -> str:
        msgs_for_request = [{"role": "system", "content": "You are a helpful assistant that summarizes conversations."}]
        # If a last_summary is provided, include it to preserve prior context
        if getattr(req, "last_summary", None):
            msgs_for_request.append({"role": "system", "content": f"Previous summary: {req.last_summary}"})
        msgs_for_request.extend(req.conversation)
        msgs_for_request.append({"role": "system", "content": prompt_template})
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=msgs_for_request,
                temperature=0.5,
                max_tokens=400,
            )
            try:
                return resp.choices[0].message.content
            except Exception:
                return str(resp)
        except Exception as e:
            return f"ERROR: {str(e)}"

    current = call_openai(CURRENT_PROMPT)
    uncovered = call_openai(UNCOVERED_PROMPT)
    suggested = call_openai(SUGGESTED_PROMPT)

    # server-side truncation and shaping
    def limit_sentences(text: str, max_sentences: int = 3, max_words: int = 60) -> str:
        if not text:
            return ""
        cleaned = str(text).replace("\n", " ").strip()
        if not cleaned:
            return ""
        import re
        sentences = re.split(r'(?<=[.!?])\s+', cleaned)
        taken = " ".join(sentences[:max_sentences])
        words = taken.split()
        if len(words) > max_words:
            return " ".join(words[:max_words]) + "…"
        return taken

    def extract_list_items(text: str):
        if not text:
            return []
        normalized = str(text).replace('\r\n', '\n').strip()
        if not normalized:
            return []
        lines = [l.strip() for l in normalized.split('\n') if l.strip()]
        bullets = [l for l in lines if l.startswith('-') or l.startswith('•') or l[0].isdigit()]
        if bullets:
            import re as _re
            cleaned = [_re.sub(r'^[-•*\d\.\)\s]+', '', l).strip() for l in bullets]
            return cleaned
        import re as _re
        sents = _re.split(r'(?<=[.!?])\s+', normalized)
        if len(sents) > 1:
            return sents
        parts = [p.strip() for p in normalized.split(';') if p.strip()]
        return parts if parts else [normalized]

    def process_current(text: str) -> str:
        return limit_sentences(text, max_sentences=3, max_words=60)

    def process_uncovered(text: str):
        items = extract_list_items(text)
        return items[:3]

    def process_suggested(text: str):
        items = extract_list_items(text)
        out = []
        for it in items[:4]:
            title = it.split(':')[0].split(' - ')[0].strip()
            words = title.split()[:12]
            out.append(' '.join(words))
        return out

    processed = {
        "current_state": process_current(current),
        "what_we_uncovered": process_uncovered(uncovered),
        "suggested_next_steps": process_suggested(suggested),
    }

    return {"summary": json.dumps(processed)}


@app.post("/summary/save")
def summary_save(payload: dict):
    """Persist an edited summary for a user/thread. Expects payload with keys:
       - user_id (str)
       - thread_id (str)
       - summary (object with current_state, what_we_uncovered, suggested_next_steps)
    """
    user_id = payload.get("user_id")
    thread_id = payload.get("thread_id")
    summary = payload.get("summary")
    if not user_id or not thread_id or not isinstance(summary, dict):
        return JSONResponse(status_code=400, content={"detail": "user_id, thread_id and summary object are required"})
    try:
        save_summary(user_id, thread_id, summary)
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.get("/summary/saved/{user_id}/{thread_id}")
def get_saved_summary(user_id: str, thread_id: str):
    s = load_saved_summary(user_id, thread_id)
    # If there's no saved summary yet, return an empty summary object (200)
    # This keeps client-side logic simpler and avoids noisy 404 logs.
    if not s:
        return {"summary": {}}
    return {"summary": s}
# ...existing code...