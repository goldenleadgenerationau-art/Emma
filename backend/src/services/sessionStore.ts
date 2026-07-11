import { randomUUID } from 'crypto';
import type { CallSession, LeadDetails } from '../types/lead';

/**
 * Simple in-memory store keyed by our own session id (not the OpenAI realtime
 * session id). Good enough for a single backend instance / demo traffic.
 *
 * For real multi-instance production traffic, swap this for Redis (or your
 * existing datastore) so session state survives backend restarts and scales
 * horizontally. The interface below is intentionally small so that swap is
 * a drop-in change.
 */
const sessions = new Map<string, CallSession>();

// Sweep sessions older than 2 hours every 30 minutes so memory doesn't grow
// unbounded on a long-running instance.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (new Date(session.createdAt).getTime() < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000).unref();

export function createSession(): CallSession {
  const session: CallSession = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lead: {},
    transcript: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): CallSession | undefined {
  return sessions.get(id);
}

export function updateLead(id: string, patch: LeadDetails): CallSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.lead = { ...session.lead, ...patch };
  return session;
}

export function appendTranscript(id: string, role: 'caller' | 'emma', text: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.transcript.push({ role, text, at: new Date().toISOString() });
}

export function attachCrmIds(
  id: string,
  ids: { ghlContactId?: string; ghlOpportunityId?: string; bookedAppointmentId?: string }
): void {
  const session = sessions.get(id);
  if (!session) return;
  Object.assign(session, ids);
}
