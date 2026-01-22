import { JournalEntry } from "../types/thinking";

export const journalEntries: JournalEntry[] = [
  {
    entry_id: "j1",
    linked_session_id: "s101",
    title: "Reflection on career choices",
    content:
      "Today I sketched two paths: a product leadership route that trades hands-on design for broader ownership, and a specialist route that keeps design in the center. My gut leans toward growth but I worry about losing craft time. Next step: try a 6-week project to test managerial work while keeping one craft week.",
    created_at: "2025-10-25T21:00",
    source: "user_written",
  },
  {
    entry_id: "j2",
    linked_session_id: "s102",
    title: "Late-night thoughts (coping)",
    content:
      "The night worries feel repetitive — project outcomes, 'what if' scenarios. I tried labeling the thought and writing one concrete next step; that eased the tension a bit. Plan: 10-minute journaling before bed and a short walk in morning.",
    created_at: "2025-10-24T23:55",
    source: "user_written",
  },
  {
    entry_id: "j501",
    linked_session_id: "s101",
    title: "Career clarity emerging",
    content: "I realized I’m not afraid of change itself, but of choosing the wrong path.",
    created_at: "2025-10-25",
    source: "ai_suggested",
  },
];
