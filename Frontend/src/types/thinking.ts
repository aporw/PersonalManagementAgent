export type ThreadStatus = "active" | "paused" | "archived";

export type DetectedMode =
  | "exploring_options"
  | "overwhelmed"
  | "reflective"
  | "decisive";

export type TonePreference = "calm" | "balanced" | "direct";
export type DepthLevel = "light" | "medium" | "deep";

export interface Thread {
  thread_id: string;
  title: string;
  description: string;
  status: ThreadStatus;
  created_at: string;
  last_active_at: string;
}

export interface Session {
  session_id: string;
  thread_id: string;
  start_time: string;
  end_time?: string;
  detected_mode: DetectedMode;
  confidence_score: number;
  messages?: { role: "user" | "assistant"; content: string; timestamp?: string }[];
}

export interface SessionSummary {
  session_id: string;
  key_points: string[];
  open_questions: string[];
  next_steps: string[];
}

export interface JournalEntry {
  entry_id: string;
  linked_session_id?: string;
  title: string;
  content: string;
  created_at: string;
  source: "ai_suggested" | "user_written";
}

export interface UserPreferences {
  user_id: string;
  default_tone: TonePreference;
  depth_level: DepthLevel;
  check_in_frequency: "low" | "medium" | "high";
}
