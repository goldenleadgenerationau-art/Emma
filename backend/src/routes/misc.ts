import { Router } from 'express';
import { appendTranscript, getSession } from '../services/sessionStore';
import {
  sendInternalTranscriptEmail,
  sendCallerTranscriptEmail,
  EmailConfigError,
  NoCallerEmailError,
} from '../services/email';

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

/**
 * POST /api/transcript/email
 * Internal backup copy to the business's own inbox - emails the call's
 * transcript and captured lead details as a plain-text safety net,
 * independent of the GHL/CRM sync. Fired automatically when a call ends, and
 * also exposed as a manual "backup" button for staff to resend on demand.
 */
miscRouter.post('/transcript/email', async (req, res) => {
  const sessionId = req.body?.sessionId;
  const session = typeof sessionId === 'string' ? getSession(sessionId) : undefined;
  if (!session) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  try {
    await sendInternalTranscriptEmail(session);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof EmailConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    console.error('[transcript] failed to email internal transcript', error);
    res.status(500).json({ error: 'Could not send the transcript email.' });
  }
});

/**
 * POST /api/transcript/email-caller
 * Caller-facing copy - emails the transcript to whatever email address Emma
 * captured during the conversation via the save_lead_details tool.
 */
miscRouter.post('/transcript/email-caller', async (req, res) => {
  const sessionId = req.body?.sessionId;
  const session = typeof sessionId === 'string' ? getSession(sessionId) : undefined;
  if (!session) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  try {
    await sendCallerTranscriptEmail(session);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof EmailConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof NoCallerEmailError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[transcript] failed to email caller transcript', error);
    res.status(500).json({ error: 'Could not send the transcript email.' });
  }
});
