import { Router } from 'express';
import { createEphemeralRealtimeSession, OpenAIConfigError } from '../services/openaiRealtime';
import { createSession } from '../services/sessionStore';

export const sessionRouter = Router();

/**
 * POST /api/session
 *
 * Called once when the caller clicks "Start web call". Creates our own
 * lightweight call session (for lead state + transcript) and an ephemeral
 * OpenAI Realtime client secret. The browser then uses that secret to open
 * a direct WebRTC connection to OpenAI - audio never touches this backend.
 */
sessionRouter.post('/session', async (_req, res) => {
  try {
    const callSession = createSession();
    const realtime = await createEphemeralRealtimeSession();

    res.json({
      sessionId: callSession.id,
      clientSecret: realtime.clientSecret,
      expiresAt: realtime.expiresAt,
      model: realtime.model,
    });
  } catch (error) {
    if (error instanceof OpenAIConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    console.error('[session] failed to create realtime session', error);
    res.status(500).json({ error: 'Failed to start realtime session.' });
  }
});
