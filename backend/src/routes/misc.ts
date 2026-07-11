import { Router } from 'express';
import { appendTranscript, getSession } from '../services/sessionStore';

export const miscRouter = Router();

miscRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'glg-emma-backend', time: new Date().toISOString() });
});

/**
 * POST /api/transcript
 * The frontend calls this as lines are finalized (from OpenAI's
 * `response.audio_transcript.done` / input transcription events) so the
 * call history is persisted server-side for the future dashboard
 * (Call History, Transcripts, Analytics referenced in the brief).
 */
miscRouter.post('/transcript', (req, res) => {
  const { sessionId, role, text } = req.body ?? {};
  if (typeof sessionId !== 'string' || (role !== 'caller' && role !== 'emma') || typeof text !== 'string') {
    res.status(400).json({ error: 'sessionId, role ("caller"|"emma"), and text are required' });
    return;
  }
  appendTranscript(sessionId, role, text);
  res.json({ ok: true });
});

miscRouter.get('/transcript/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  res.json({ transcript: session.transcript, lead: session.lead });
});
