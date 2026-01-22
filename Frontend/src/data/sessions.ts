import { Session } from "../types/thinking";

export const sessions: Session[] = [
  {
    session_id: "s101",
    thread_id: "t1",
    start_time: "2025-10-25T20:10",
    end_time: "2025-10-25T20:42",
    detected_mode: "exploring_options",
    confidence_score: 0.78,
    messages: [
      { role: "user", content: "I'm thinking about changing roles but unsure which direction feels right.", timestamp: "2025-10-25T20:12" },
      { role: "assistant", content: "What aspects of your current role feel most misaligned with your goals?", timestamp: "2025-10-25T20:13" },
      { role: "user", content: "I enjoy product strategy but worry about losing hands-on design time.", timestamp: "2025-10-25T20:17" },
      { role: "assistant", content: "Let's map out the trade-offs — growth, autonomy, focus — and see where to prioritize.", timestamp: "2025-10-25T20:20" },
    ],
  },
  {
    session_id: "s102",
    thread_id: "t2",
    start_time: "2025-10-24T23:30",
    end_time: "2025-10-24T23:55",
    detected_mode: "overwhelmed",
    confidence_score: 0.85,
    messages: [
      { role: "user", content: "I keep ruminating at night and can't fall asleep.", timestamp: "2025-10-24T23:32" },
      { role: "assistant", content: "Are there particular thoughts that repeat most loudly?", timestamp: "2025-10-24T23:33" },
      { role: "user", content: "Worries about future projects and what if I fail.", timestamp: "2025-10-24T23:36" },
      { role: "assistant", content: "Shall we try a short grounding exercise and label the thoughts?", timestamp: "2025-10-24T23:40" },
    ],
  },
];
