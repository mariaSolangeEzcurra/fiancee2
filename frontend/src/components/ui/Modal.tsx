import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { XIcon } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}

/** Modal centrado en escritorio y de pantalla completa en el celular. */
export function Modal({ open, onClose, title, subtitle, icon, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-cocoa/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-ivory shadow-2xl sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-3xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          >
            <header className="flex items-start gap-3 border-b border-line bg-paper px-5 py-4 sm:px-6">
              {icon}
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-2xl font-semibold text-cocoa">{title}</h2>
                {subtitle && <div className="mt-0.5 text-sm text-cocoa-muted">{subtitle}</div>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="rounded-full p-2 text-cocoa-muted transition-colors hover:bg-cream hover:text-cocoa"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
