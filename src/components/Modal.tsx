import {X} from 'lucide-react';
import {useEffect, type ReactNode} from 'react';

export function Modal({open, title, description, onClose, children}: {open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <h2 id="modal-title">{title}</h2>
        {description && <p className="modal-description">{description}</p>}
        {children}
      </section>
    </div>
  );
}
