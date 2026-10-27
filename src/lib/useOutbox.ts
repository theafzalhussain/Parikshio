'use client';

import { useEffect, useState } from 'react';
import {
  getInitialSnapshot,
  getOutboxSnapshot,
  initOutbox,
  setOutboxOwner,
  subscribeOutbox,
  type OutboxSnapshot
} from './offlineQueue';

/**
 * Subscribes to the offline outbox and binds it to the signed-in student.
 *
 * The first render deliberately returns the empty snapshot even when the queue
 * is already populated, so the server-rendered markup and the client's first
 * pass agree; the real state arrives in the effect one tick later.
 */
export function useOutbox(studentId?: string | null): OutboxSnapshot {
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(getInitialSnapshot);

  useEffect(() => {
    initOutbox();
    const unsubscribe = subscribeOutbox(setSnapshot);
    setSnapshot(getOutboxSnapshot());
    return unsubscribe;
  }, []);

  useEffect(() => {
    setOutboxOwner(studentId ?? null);
  }, [studentId]);

  return snapshot;
}
