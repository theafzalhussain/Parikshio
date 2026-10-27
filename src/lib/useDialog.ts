'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Behaviour every overlay in the app needs and browsers do not give you for
 * free with plain `<div>`s:
 *
 *  - Escape closes it.
 *  - The page behind stops scrolling (and does not shift as the scrollbar goes).
 *  - Tab cycles inside the overlay instead of wandering into the page behind.
 *  - Focus moves in on open and returns to the trigger on close, so a keyboard
 *    user is not dumped at the top of the document.
 *
 * Returns a ref to put on the overlay container.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void
) {
  const ref = useRef<T>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;

      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!ref.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    // Replacing the scrollbar with equivalent padding stops the 10px content
    // jump you otherwise get the moment the overlay opens.
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    // Wait a frame so the overlay is painted before we reach into it.
    const focusTimer = window.setTimeout(() => {
      const target = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? ref.current)?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      window.clearTimeout(focusTimer);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}
