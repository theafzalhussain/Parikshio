'use client';

import { useEffect, useRef } from 'react';

/**
 * Interval polling that stops while the tab is in the background.
 *
 * A dashboard left open in a spare tab was previously still hitting the API
 * every 12 seconds forever — wasted battery on the client and wasted queries on
 * the server, for data nobody was looking at. When the tab comes back we fetch
 * once immediately so the first thing the user sees is already current.
 */
export function usePoll(callback: () => void, intervalMs: number, enabled = true) {
  // Kept in a ref so a new inline closure on every render does not restart the
  // interval (which would reset the clock and effectively poll twice as often).
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => latest.current(), intervalMs);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        latest.current();
        start();
      }
    };

    latest.current();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
