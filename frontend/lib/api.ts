const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error ?? `Request to ${path} failed (${res.status})`);
  }
  return data as T;
}

export interface StartSessionResponse {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  model: string;
}

/** Asks our backend to open a call session and mint an ephemeral OpenAI Realtime token. */
export function startCallSession(): Promise<StartSessionResponse> {
  return postJson<StartSessionResponse>('/api/session', {});
}

export function saveLeadDetails(sessionId: string, patch: Record<string, unknown>) {
  return postJson('/api/tools/save-lead-details', { sessionId, ...patch });
}

export function getAvailableSlots(sessionId: string, daysAhead?: number) {
  return postJson<{ slots: { startTimeIso: string; label: string }[] }>(
    '/api/tools/available-slots',
    { sessionId, daysAhead }
  );
}

export function bookAppointment(sessionId: string, startTimeIso: string) {
  return postJson('/api/tools/book-appointment', { sessionId, startTimeIso });
}

export function submitLeadToCrm(sessionId: string) {
  return postJson('/api/tools/submit-lead', { sessionId });
}

export function logTranscriptLine(sessionId: string, role: 'caller' | 'emma', text: string) {
  return postJson('/api/transcript', { sessionId, role, text }).catch(() => {
    /* transcript logging is best-effort; never break the call over it */
  });
}

export function emailTranscript(sessionId: string) {
  return postJson('/api/transcript/email', { sessionId });
}

export function emailTranscriptToCaller(sessionId: string) {
  return postJson('/api/transcript/email-caller', { sessionId });
}
