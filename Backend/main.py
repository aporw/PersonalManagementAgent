# ...existing code...
from fastapi import FastAPI, Request, Response
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
import jwt
import re
from datetime import timedelta
from passlib.context import CryptContext

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

USERS_FILE = DATA_DIR / "users.json"

def load_users() -> dict:
    if not USERS_FILE.exists():
        return {}
    try:
        with USERS_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_users(users: dict):
    with USERS_FILE.open("w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

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

# --- JWT helpers (dev-only simple tokens)
JWT_SECRET = os.getenv("JWT_SECRET") or "dev_jwt_secret"
JWT_ALGO = "HS256"
JWT_EXP_DAYS = int(os.getenv("JWT_EXP_DAYS") or "7")

# Password hashing context: prefer PBKDF2-SHA256 and support bcrypt for compatibility.
# Using PBKDF2 as the primary scheme avoids bcrypt's 72-byte input limit and platform
# backend detection quirks during migration; bcrypt remains supported for verification.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")

# Environment flags
ENVIRONMENT = os.getenv("ENV", os.getenv("APP_ENV", "development")).lower()
COOKIE_SECURE = ENVIRONMENT == "production"
RETURN_TOKEN_IN_JSON = str(os.getenv("RETURN_TOKEN_IN_JSON", "true")).lower() in ("1", "true", "yes")

def create_token_for_user(user_id: str) -> str:
    exp = datetime.utcnow() + timedelta(days=JWT_EXP_DAYS)
    payload = {"sub": user_id, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def verify_token(token: str) -> t.Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload.get("sub")
    except Exception:
        return None

def estimate_tokens_for_text(text: str) -> int:
    # Very rough heuristic: 1 token ~= 4 characters (approx). Use ceil.
    try:
        l = len(str(text) or "")
        return max(1, (l + 3) // 4)
    except Exception:
        return 1

def estimate_tokens_for_summary(conversation: list) -> int:
    # Sum tokens for conversation content plus a fixed overhead for model processing
    try:
        total = 0
        for m in conversation:
            if isinstance(m, dict):
                total += estimate_tokens_for_text(m.get("content", ""))
            else:
                total += estimate_tokens_for_text(getattr(m, "content", ""))
        # overhead for response generation
        return total + 200
    except Exception:
        return 200

def _get_auth_subject_from_request(request: Request) -> t.Optional[str]:
    try:
        # prefer cookie auth_token (httpOnly cookie)
        try:
            cookie_token = request.cookies.get("auth_token")
            if cookie_token:
                sub = verify_token(cookie_token)
                if sub:
                    return sub
        except Exception:
            pass
        auth_hdr = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth_hdr and auth_hdr.lower().startswith("bearer "):
            token = auth_hdr.split(None, 1)[1]
            return verify_token(token)
    except Exception:
        return None
    return None


# --- Basic in-memory rate limiter (per-subject or per-ip)
import time

RATE_LIMIT_STORE: dict = {}

def _rate_limit_key_for_request(request: Request) -> str:
    # prefer token subject; fall back to remote IP
    try:
        sub = _get_auth_subject_from_request(request)
        if sub:
            return f"user:{sub}"
    except Exception:
        pass
    try:
        client = request.client
        if client and client.host:
            return f"ip:{client.host}"
    except Exception:
        pass
    return "ip:unknown"

def check_rate_limit(request: Request, limit: int = 60, window_seconds: int = 60) -> t.Tuple[bool, int]:
    """Returns (allowed:bool, remaining:int)"""
    key = _rate_limit_key_for_request(request)
    now = int(time.time())
    entry = RATE_LIMIT_STORE.get(key)
    if not entry or now - entry.get("ts", 0) >= window_seconds:
        RATE_LIMIT_STORE[key] = {"ts": now, "count": 1}
        return True, limit - 1
    entry["count"] = entry.get("count", 0) + 1
    RATE_LIMIT_STORE[key] = entry
    if entry["count"] > limit:
        return False, 0
    return True, max(0, limit - entry["count"]) 

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


def _is_greeting_or_smalltalk(text: str) -> bool:
    if not text:
        return False
    txt = text.strip().lower()
    # common short greetings or smalltalk that should be allowed
    greetings = [
        r"^hi\b",
        r"^hello\b",
        r"^hey\b",
        r"^hiya\b",
        r"^howdy\b",
        r"^good (morning|afternoon|evening)\b",
        r"what's up\b",
        r"^yo\b",
    ]
    for g in greetings:
        try:
            if re.search(g, txt):
                # allow very short greetings even when not personal
                return True
        except Exception:
            continue

    small_phrases = [
        "how are you",
        "how are things",
        "what's up",
        "what is up",
        "how's it going",
        "thanks",
        "thank you",
        "thanks!",
    ]
    for p in small_phrases:
        if p in txt:
            return True
    return False


def _is_code_like(text: str) -> bool:
    if not text:
        return False
    txt = text.strip()
    # detect code fences or presence of multiple codey tokens
    if txt.startswith("```") or txt.endswith("```"):
        return True
    code_indicators = ["def ", "function ", "console.log", "<html", "<div", "var ", "let ", "const ", "import ", "class ", "#include"]
    hits = 0
    for ci in code_indicators:
        if ci in txt:
            hits += 1
            if hits >= 2:
                return True
    # also detect lots of symbols typical in code
    sym_count = sum(1 for ch in txt if ch in '{}[]<>;=()')
    if sym_count >= 3:
        return True
    return False


def _is_factoid_question(text: str) -> bool:
    if not text:
        return False
    txt = text.strip().lower()
    # common interrogatives starting a factoid question
    if re.match(r"^(where|when|who|what|which|how)\b", txt):
        # short greetings like "how are you" are handled in smalltalk helper
        # treat explicit 'how to' as non-factoid (tutorial/code) - leave for code detector
        if txt.startswith("how to") or txt.startswith("how do"):
            return False
        return True
    # explicit question mark often indicates a factoid question
    if "?" in txt:
        # exclude obvious smalltalk phrasing
        if _is_greeting_or_smalltalk(txt):
            return False
        return True
    # keyword-based heuristics
    keys = ["where is", "located", "address", "coordinates", "what is the capital", "population", "distance to", "timezone", "how many", "how much", "what is", "who is"]
    if any(k in txt for k in keys):
        # try to avoid matching personal questions that use 'what is' (e.g., "what is making me anxious") by checking for first-person
        if "i " in txt or txt.startswith("i"):
            return False
        return True
    return False


def is_allowed_for_assistant(text: str) -> bool:
    """Allow passage to the assistant when the text is clearly a personal-topic query
    or when it's simple conversational smalltalk/greeting. Block (return False)
    for messages that appear to be code or clearly non-personal (redirects to other tools).
    This is a lightweight in-text classifier built from simple heuristics.
    """
    if not text:
        return False
    # if it looks like code, do not allow here
    if _is_code_like(text):
        return False
    # block simple factoid/general-knowledge questions (e.g., "where is eiffel tower")
    if _is_factoid_question(text):
        return False

    # greetings and short smalltalk should be allowed
    if _is_greeting_or_smalltalk(text):
        return True
    # otherwise allow if it appears to be about personal topics
    return is_personal_topic(text)


# --- ML model loading (optional) ---
_MODEL_PATH = Path(__file__).resolve().parent / "topic_classifier.pkl"
_topic_pipe = None
try:
    # import joblib lazily so the server can run without this optional dependency
    import joblib as _joblib
    _topic_pipe = _joblib.load(_MODEL_PATH)
    print("Loaded topic classifier from", _MODEL_PATH)
except Exception:
    _topic_pipe = None


def ml_is_allowed_for_assistant(text: str, threshold: float = 0.7):
    """Return tuple (allow: bool|None, label: str, prob: float, source: str).
    If model not loaded, return (None, '', 0.0, 'none')."""
    if not _topic_pipe:
        return None, "", 0.0, 'none'
    try:
        probs = _topic_pipe.predict_proba([text])[0]
        labels = list(_topic_pipe.classes_)
        prob_map = dict(zip(labels, probs))
        # consider allowed if personal or smalltalk probability is high
        personal_prob = prob_map.get("personal", 0.0) + prob_map.get("smalltalk", 0.0)
        allow = personal_prob >= threshold
        # choose top label
        top_idx = int(probs.argmax()) if hasattr(probs, 'argmax') else probs.index(max(probs))
        top_label = labels[top_idx]
        return allow, top_label, float(personal_prob), 'ml'
    except Exception:
        return None, "", 0.0, 'error'

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
    # Authorization: if Authorization header provided, validate token and ensure
    # token subject matches the supplied user_id. Allow anonymous 'anon_*' ids
    # without a token (client-side anon logic remains). If token valid,
    # enforce and decrement server-side credits/messages_left on user messages.
    auth = None
    try:
        auth_hdr = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth_hdr and auth_hdr.lower().startswith("bearer "):
            token = auth_hdr.split(None, 1)[1]
            auth = verify_token(token)
    except Exception:
        auth = None
    try:
        # If a token was provided, ensure it matches the user being written to
        if auth and auth != msg.user_id:
            return JSONResponse(status_code=403, content={"detail": "token does not match user"})

        # Message saving does not itself consume tokens. OpenAI calls (e.g., /chat or /summary)
        # will perform token accounting and decrement `tokens_left` accordingly.

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


@app.post("/users/create")
def create_user(payload: dict, response: Response):
    name = payload.get("name")
    email = payload.get("email")
    password = payload.get("password")
    birth_year = payload.get("birth_year")
    if not name or not email or not password:
        return JSONResponse(status_code=400, content={"detail": "name, email and password are required"})
    users = load_users()
    # simple uniqueness check on email
    for uid, u in users.items():
        if u.get("email") == email:
            return JSONResponse(status_code=400, content={"detail": "email already exists", "user_id": uid})
    user_id = f"u{int(datetime.utcnow().timestamp())}"
    # Hash the password before storing
    hashed = pwd_context.hash(password)
    # Default tokens: 500 tokens to start, except for Asha Patel (special case: 0)
    default_tokens = 0 if (str(name).strip().lower() == 'asha patel' or str(email).strip().lower() == 'asha.patel@example.com') else 500
    user_obj = {
        "user_id": user_id,
        "name": name,
        "email": email,
        "password": hashed,
        "tokens_left": default_tokens,
        "birth_year": birth_year,
        "created_at": datetime.utcnow().isoformat(),
    }
    users[user_id] = user_obj
    try:
        save_users(users)
        # return user without password for safety
        out = dict(user_obj)
        out.pop("password", None)
        token = create_token_for_user(user_id)
        # set httpOnly cookie for the token
        try:
            response.set_cookie("auth_token", token, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=JWT_EXP_DAYS * 24 * 3600)
        except Exception:
            pass
        result = {"ok": True, "user": out}
        if RETURN_TOKEN_IN_JSON:
            result["token"] = token
        return result
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.post("/users/login")
def login_user(payload: dict, response: Response):
    """Simple dev-only login: checks email + password against users.json.
    Passwords are stored in plaintext in `users.json` for local dev only.
    """
    email = payload.get("email")
    password = payload.get("password")
    if not email or not password:
        return JSONResponse(status_code=400, content={"detail": "email and password are required"})
    users = load_users()
    for uid, u in users.items():
        if u.get("email") != email:
            continue
        stored = u.get("password")
        # If stored password appears to be a hash that passlib recognizes, verify it.
        try:
            if stored and pwd_context.identify(stored):
                if pwd_context.verify(password, stored):
                    # Optionally upgrade hash if needed
                    if pwd_context.needs_update(stored):
                        try:
                            u["password"] = pwd_context.hash(password)
                            users[uid] = u
                            save_users(users)
                        except Exception:
                            pass
                    ucopy = dict(u)
                    ucopy.pop("password", None)
                    token = create_token_for_user(uid)
                    try:
                        response.set_cookie("auth_token", token, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=JWT_EXP_DAYS * 24 * 3600)
                    except Exception:
                        pass
                    result = {"ok": True, "user": ucopy}
                    if RETURN_TOKEN_IN_JSON:
                        result["token"] = token
                    return result
            else:
                # legacy plaintext password (migration path)
                if stored == password:
                    try:
                        # re-hash and save
                        u["password"] = pwd_context.hash(password)
                        users[uid] = u
                        save_users(users)
                    except Exception:
                        pass
                    ucopy = dict(u)
                    ucopy.pop("password", None)
                    token = create_token_for_user(uid)
                    try:
                        response.set_cookie("auth_token", token, httponly=True, secure=COOKIE_SECURE, samesite="lax", max_age=JWT_EXP_DAYS * 24 * 3600)
                    except Exception:
                        pass
                    result = {"ok": True, "user": ucopy}
                    if RETURN_TOKEN_IN_JSON:
                        result["token"] = token
                    return result
        except Exception:
            # fallback: plain equality check
            if stored == password:
                try:
                    u["password"] = pwd_context.hash(password)
                    users[uid] = u
                    save_users(users)
                except Exception:
                    pass
                ucopy = dict(u)
                ucopy.pop("password", None)
                token = create_token_for_user(uid)
                try:
                    response.set_cookie("auth_token", token, httponly=True, samesite="lax", max_age=JWT_EXP_DAYS * 24 * 3600)
                except Exception:
                    pass
                return {"ok": True, "user": ucopy, "token": token}
    return JSONResponse(status_code=401, content={"detail": "invalid credentials"})


@app.get("/users/{user_id}")
def get_user(user_id: str):
    users = load_users()
    u = users.get(user_id)
    if not u:
        return JSONResponse(status_code=404, content={"detail": "user not found"})
    # do not expose stored password field to callers
    ucopy = dict(u)
    ucopy.pop("password", None)
    return {"user": ucopy}

@app.get("/users/find")
def find_user_by_email(email: str):
    users = load_users()
    for uid, u in users.items():
        if u.get("email") == email:
            # redact password before returning
            ucopy = dict(u)
            ucopy.pop("password", None)
            return {"user": ucopy}
    return JSONResponse(status_code=404, content={"detail": "not found"})


@app.post("/users/{user_id}/credits")
def add_user_credits(user_id: str, payload: dict, request: Request):
    """Increment (or set) a user's credits/messages_left. Payload: { amount: int }
       This is a simple dev-only endpoint to simulate awarding credits (e.g., after watching an ad).
    """
    # require Authorization via cookie or header: allow httpOnly cookie (fastapi request.cookies)
    sub = None
    # check cookie first
    try:
        cookie_token = request.cookies.get("auth_token")
        if cookie_token:
            sub = verify_token(cookie_token)
    except Exception:
        sub = None
    # fallback to Authorization header
    if not sub:
        try:
            auth_hdr = request.headers.get("authorization") or request.headers.get("Authorization")
            if auth_hdr and auth_hdr.lower().startswith("bearer "):
                token = auth_hdr.split(None, 1)[1]
                sub = verify_token(token)
        except Exception:
            sub = None
    if not sub or sub != user_id:
        return JSONResponse(status_code=403, content={"detail": "invalid token or unauthorized"})

    try:
        amt = int(payload.get("amount", 0))
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "amount must be an integer"})
    if amt <= 0:
        return JSONResponse(status_code=400, content={"detail": "amount must be > 0"})
    users = load_users()
    u = users.get(user_id)
    if not u:
        return JSONResponse(status_code=404, content={"detail": "user not found"})
    # update tokens_left field
    cur = u.get("tokens_left")
    try:
        cur_num = int(cur) if cur is not None else 0
    except Exception:
        cur_num = 0
    new_val = cur_num + amt
    u["tokens_left"] = new_val
    users[user_id] = u
    try:
        save_users(users)
        ucopy = dict(u)
        ucopy.pop("password", None)
        return {"ok": True, "tokens_left": new_val, "user": ucopy}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.get("/messages/{user_id}/{thread_id}")
def get_messages(user_id: str, thread_id: str, request: Request):
    # Require auth for non-anonymous users
    sub = _get_auth_subject_from_request(request)
    if not user_id.startswith("anon_"):
        if not sub:
            return JSONResponse(status_code=401, content={"detail": "authorization required"})
        if sub != user_id:
            return JSONResponse(status_code=403, content={"detail": "forbidden"})
    msgs = load_messages(user_id, thread_id)
    return {"messages": msgs, "count": len(msgs)}


@app.delete("/messages/{user_id}/{thread_id}")
def delete_messages(user_id: str, thread_id: str, request: Request):
    """Delete all stored messages for a user/thread. Returns count 0 on success.
       Requires authorization for non-anonymous users.
    """
    sub = _get_auth_subject_from_request(request)
    if not user_id.startswith("anon_"):
        if not sub:
            return JSONResponse(status_code=401, content={"detail": "authorization required"})
        if sub != user_id:
            return JSONResponse(status_code=403, content={"detail": "forbidden"})
    try:
        save_messages(user_id, thread_id, [])
        return {"ok": True, "count": 0}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.get("/threads/{user_id}")
def get_threads(user_id: str, request: Request):
    """Return a lightweight list of threads for the given user_id.
    Each thread contains thread_id, title (first user message snippet), created_at and last_active_at.
    Requires authorization for non-anonymous users.
    """
    sub = _get_auth_subject_from_request(request)
    if not user_id.startswith("anon_"):
        if not sub:
            return JSONResponse(status_code=401, content={"detail": "authorization required"})
        if sub != user_id:
            return JSONResponse(status_code=403, content={"detail": "forbidden"})

    safe_user = "".join(ch for ch in user_id if ch.isalnum() or ch in "-_")
    threads: list = []
    try:
        for p in DATA_DIR.iterdir():
            name = p.name
            # match files like <user>__<thread>.json but skip summary files
            if not name.startswith(f"{safe_user}__"):
                continue
            if name.endswith("__summary.json"):
                continue
            # extract thread id (strip prefix and extension)
            rest = name.split("__", 1)[1]
            thread_id = rest.rsplit(".", 1)[0]
            # load messages to infer title / timestamps
            try:
                with p.open("r", encoding="utf-8") as f:
                    msgs = json.load(f)
            except Exception:
                msgs = []
            title = "Conversation"
            created_at = None
            last_active_at = None
            if isinstance(msgs, list) and len(msgs) > 0:
                # created_at from first message
                first = msgs[0]
                created_at = first.get("ts") or first.get("created_at") or None
                last = msgs[-1]
                last_active_at = last.get("ts") or last.get("created_at") or None
                # pick first non-empty user message as title/snippet
                for m in msgs:
                    if isinstance(m, dict) and m.get("role") == "user" and m.get("content"):
                        title = str(m.get("content"))[:120]
                        break
                if not title and isinstance(first, dict) and first.get("content"):
                    title = str(first.get("content"))[:120]

            threads.append({
                "thread_id": thread_id,
                "title": title,
                "created_at": created_at,
                "last_active_at": last_active_at,
            })

        # sort by last_active_at desc (nulls last)
        def sort_key(t):
            v = t.get("last_active_at") or t.get("created_at") or ""
            return v

        threads.sort(key=sort_key, reverse=True)
        return {"threads": threads}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request):
    # rate-limit per user/ip
    allowed, remaining = check_rate_limit(request, limit=30, window_seconds=60)
    if not allowed:
        return JSONResponse(status_code=429, content={"detail": "rate limit exceeded"})
    # keep original behavior: single-message chat proxied to OpenAI
    err = validate_message_text(req.message)
    if err:
        return err

    # Restrict usage: only forward to OpenAI when the user's message is allowed.
    # Try ML model first (if loaded), otherwise fall back to heuristics.
    subject = _get_auth_subject_from_request(request)
    allow_ml, ml_label, ml_prob, ml_source = ml_is_allowed_for_assistant(req.message, threshold=0.5)
    if allow_ml is None:
        # model not available or errored — use heuristics
        allowed = is_allowed_for_assistant(req.message)
        decision_source = 'heuristic'
        label = 'heuristic'
        prob = 1.0 if allowed else 0.0
    else:
        allowed = bool(allow_ml)
        decision_source = ml_source
        label = ml_label
        prob = ml_prob

    # Log gateway decision for later analysis
    try:
        log_path = Path(__file__).resolve().parent / "gateway_log.jsonl"
        entry = {
            "ts": datetime.utcnow().isoformat(),
            "subject": subject or None,
            "text": (req.message[:1000] + '...') if len(req.message) > 1000 else req.message,
            "allowed": bool(allowed),
            "label": label,
            "prob": float(prob),
            "source": decision_source,
        }
        with log_path.open('a', encoding='utf8') as lf:
            lf.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

    if not allowed:
        # Do not call OpenAI; return a short informative reply
        return {"reply": "This assistant is restricted to personal topics (career, mental state, relationships, decision-making). For coding, general information, or other topics please use the appropriate tool or a general-purpose assistant."}

    # Determine token budget required and enforce for authenticated users
    subject = _get_auth_subject_from_request(request)
    est_needed = estimate_tokens_for_text(req.message) + 100  # include model/response overhead
    if subject:
        users = load_users()
        u = users.get(subject)
        try:
            avail = int(u.get("tokens_left", 0) or 0)
        except Exception:
            avail = 0
        if avail < est_needed:
            return JSONResponse(status_code=403, content={"detail": "insufficient tokens"})
        # reserve tokens
        u["tokens_left"] = avail - est_needed
        users[subject] = u
        save_users(users)

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
        # On error, refund reserved tokens for authenticated user
        try:
            if subject:
                users = load_users()
                u = users.get(subject)
                if u:
                    try:
                        cur = int(u.get("tokens_left", 0) or 0)
                    except Exception:
                        cur = 0
                    u["tokens_left"] = cur + est_needed
                    users[subject] = u
                    save_users(users)
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"detail": f"OpenAI error: {str(e)}"})

@app.get("/summary/{user_id}/{thread_id}")
def summary_for_thread(user_id: str, thread_id: str, request: Request):
    """
    Generate three structured summaries for the given user/thread:
      - current_state
      - uncovered
      - suggested_next_steps
    Results come from OpenAI (non-streaming).
    """
    msgs = load_messages(user_id, thread_id)
    if not msgs:
        # No messages: return an empty structured summary rather than a 404
        return {
            "current_state": "",
            "what_we_uncovered": [],
            "suggested_next_steps": [],
            "message_count": 0,
        }

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

    # enforce token budget for authenticated users; require cookie or bearer token
    needed = estimate_tokens_for_summary(conversation)
    if not user_id.startswith("anon_"):
        subject = _get_auth_subject_from_request(request)
        if not subject:
            return JSONResponse(status_code=401, content={"detail": "authorization required"})
        if subject != user_id:
            return JSONResponse(status_code=403, content={"detail": "forbidden"})
        users = load_users()
        u = users.get(user_id)
        if not u:
            return JSONResponse(status_code=404, content={"detail": "user not found"})
        try:
            cur = int(u.get("tokens_left", 0) or 0)
        except Exception:
            cur = 0
        if cur < needed:
            return JSONResponse(status_code=403, content={"detail": "insufficient tokens for summary"})
        # reserve tokens
        u["tokens_left"] = cur - needed
        users[user_id] = u
        save_users(users)

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
def summary_from_conversation(req: SummaryRequest, request: Request):
    # enforce rate limit: small window to protect expensive OpenAI calls
    allowed, remaining = check_rate_limit(request, limit=6, window_seconds=60)
    if not allowed:
        return JSONResponse(status_code=429, content={"detail": "rate limit exceeded"})
    # If the conversation is empty or missing, return an empty summary rather than a 400
    if not isinstance(req.conversation, list) or len(req.conversation) == 0:
        empty = {"current_state": "", "what_we_uncovered": [], "suggested_next_steps": []}
        return {"summary": json.dumps(empty)}

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
def summary_save(payload: dict, request: Request):
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
    # Authorization: require token subject to match user_id for non-anonymous
    sub = _get_auth_subject_from_request(request)
    if not user_id.startswith("anon_"):
        if not sub:
            return JSONResponse(status_code=401, content={"detail": "authorization required"})
        if sub != user_id:
            return JSONResponse(status_code=403, content={"detail": "forbidden"})
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