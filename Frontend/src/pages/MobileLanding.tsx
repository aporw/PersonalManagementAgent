import React from 'react';
import LeftPanel from '../components/layout/LeftPanel';
import { Thread } from '../types/thinking';

interface MobileLandingProps {
  threads: Thread[];
  onSelect: (threadId: string) => void;
  onCreate?: (title: string, desc?: string) => void;
  activeThreadId?: string | undefined;
}

export default function MobileLanding({ threads, onSelect, onCreate, activeThreadId }: MobileLandingProps) {
  // Show up to 4 tiles — if there are fewer, fill with placeholders
  // Normalize incoming threads to ensure required Thread fields exist
  const normalized: Thread[] = (threads || []).slice(0, 4).map((t) => ({
    thread_id: t.thread_id,
    title: t.title,
    description: (t as any).description || '',
    status: (t as any).status || 'active',
    created_at: (t as any).created_at || new Date().toISOString(),
    last_active_at: (t as any).last_active_at || new Date().toISOString(),
  }));

  const tiles = [...normalized];
  while (tiles.length < 4)
    tiles.push({ thread_id: `t_gap_${tiles.length}`, title: 'Start a thread', description: '', status: 'active', created_at: new Date().toISOString(), last_active_at: new Date().toISOString() });

  return (
    <div className="mobile-landing">
      {/* Reuse LeftPanel styling/structure to show threads on page1 */}
      <aside style={{ marginBottom: 16 }}>
        <LeftPanel
          threads={threads as Thread[]}
          activeThreadId={activeThreadId}
          onThreadSelect={(id) => onSelect(id)}
          onCreateThread={(t, d) => onCreate && onCreate(t, d)}
        />
      </aside>
      {/* Landing header, tiles and sign-in/create actions removed per request — LeftPanel shown only */}
    </div>
  );
}
