import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types';

export type AxiomIO = Server<ClientToServerEvents, ServerToClientEvents>;

let io: AxiomIO | null = null;

export function setIO(instance: AxiomIO) {
  io = instance;
}

export const examRoom = (code: string) => `exam:${code.toUpperCase()}`;
export const staffRoom = (code: string) => `exam:${code.toUpperCase()}:staff`;
export const staffLobby = 'staff:lobby';
/** Private room every socket joins for its own account (late grade delivery). */
export const userRoom = (userId: string) => `user:${userId}`;

export function emitUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, ...payload);
}

export function emitExam<E extends keyof ServerToClientEvents>(
  code: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) {
  if (!io) return;
  io.to(examRoom(code)).emit(event, ...payload);
}

export function emitStaff<E extends keyof ServerToClientEvents>(
  code: string,
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) {
  if (!io) return;
  io.to(staffRoom(code)).emit(event, ...payload);
}

export function emitAllStaff<E extends keyof ServerToClientEvents>(
  event: E,
  ...payload: Parameters<ServerToClientEvents[E]>
) {
  if (!io) return;
  io.to(staffLobby).emit(event, ...payload);
}

export function ioInstance(): AxiomIO | null {
  return io;
}
