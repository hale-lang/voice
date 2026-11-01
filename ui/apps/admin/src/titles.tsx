import { useMemo } from 'react';
import { useGet } from './api/client';

/**
 * Conversations' titles, as the title annotator wrote them
 * (`listConversationTitles`): read once and refreshed by the event stream's
 * `annotation`, so every screen that names a conversation names it alike.
 */
export function useTitles(): (conversation: string | null | undefined, project?: string | null) => string | null {
  const q = useGet('/admin/v1/conversations', { params: { query: { limit: 500 } } });
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of q.data?.data ?? []) {
      m.set(`${t.project}\u0000${t.conversation}`, t.title);
      // the newest first: a conversation alone takes its newest title
      if (!m.has(t.conversation)) m.set(t.conversation, t.title);
    }
    return m;
  }, [q.data]);
  return (conversation, project) => {
    if (!conversation) return null;
    return (project ? map.get(`${project}\u0000${conversation}`) : undefined) ?? map.get(conversation) ?? null;
  };
}

/** A conversation by its title, its id behind it (on hover); its id when it has none. */
export function ConversationName({ conversation, project, mono }: { conversation: string; project?: string | null; mono?: boolean }) {
  const titleOf = useTitles();
  const t = titleOf(conversation, project);
  if (t) return <span title={conversation}>{t}</span>;
  return mono ? <span className="mono" title={conversation}>{conversation}</span> : <span title={conversation}>{conversation}</span>;
}
