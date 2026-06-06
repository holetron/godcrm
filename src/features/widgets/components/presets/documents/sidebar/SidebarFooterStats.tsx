import React from 'react';
import { Atom, Ticket } from 'lucide-react';
import { useDocumentsContext } from '../DocumentsContext';

export function SidebarFooterStats() {
  const ctx = useDocumentsContext();
  return (
    <div className="shrink-0 px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
        <span>{ctx.documents.length} док.</span>
        <span>{ctx.selectedDocument ? `${ctx.items.length} элем.` : '—'}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] mt-1">
        <span className="flex items-center gap-1">
          <Atom className="w-3 h-3 text-purple-400" />
          {ctx.allAtoms?.length || 0} атомов
        </span>
        <span className="flex items-center gap-1">
          <Ticket className="w-3 h-3 text-blue-400" />
          {ctx.items.filter(item => item.ticket_ref).length} тикетов
        </span>
      </div>
    </div>
  );
}
