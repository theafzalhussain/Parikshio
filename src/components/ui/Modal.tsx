'use client';

import { useId } from 'react';
import { X } from 'lucide-react';
import { cx } from '@/lib/api';
import { IconButton } from './Button';
import { useDialog } from '@/lib/useDialog';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-2xl'
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  // Escape, scroll lock, focus trap and focus restore all live in the hook.
  const panelRef = useDialog<HTMLDivElement>(open, onClose);
  const titleId = useId();
  const descId = useId();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <div
        className="fixed inset-0 animate-fadeIn bg-ink-950/80 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cx('relative z-10 w-full animate-popIn', width)}
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/[0.12] bg-ink-880 shadow-lift">
          {/* Champagne hairline along the top edge. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold-200/50 to-transparent"
          />
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-7">
            <div>
              <h3 id={titleId} className="font-display text-[21px] font-medium leading-tight text-white">
                {title}
              </h3>
              {description && (
                <p id={descId} className="mt-1.5 text-[13.5px] leading-relaxed text-white/60">
                  {description}
                </p>
              )}
            </div>
            <IconButton onClick={onClose} aria-label="Close dialog">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-5 py-6 sm:px-7">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] bg-white/[0.02] px-5 py-4 sm:px-7">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
