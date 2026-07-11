import { env } from '../config/env';
import { EMMA_SYSTEM_PROMPT } from '../prompts/emmaSystemPrompt';
import { EMMA_TOOLS } from '../prompts/tools';

const OPENAI_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

export class OpenAIConfigError extends Error {}

/**
 * Creates a short-lived ("ephemeral") client secret for the OpenAI Realtime
 * API. This is the standard pattern for browser-based voice agents: the
 * long-lived OPENAI_API_KEY never leaves the backend; the browser only ever
 * sees a token that expires in ~a minute and is scoped to one session.
 *
 * The browser uses the returned `client_secret.value` as a Bearer token when
 * it POSTs its WebRTC SDP offer directly to OpenAI.
 */
export async function createEphemeralRealtimeSession(): Promise<{
  clientSecret: string;
  expiresAt: string;
  model: string;
}> {
  if (!env.openaiApiKey) {
    throw new OpenAIConfigError(
      'OPENAI_API_KEY is not configured on the backend. Set it in your .env file.'
    );
  }

  const response = await fetch(OPENAI_CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: env.openaiRealtimeModel,
        instructions: EMMA_SYSTEM_PROMPT,
        output_modalities: ['audio'],
        audio: {
          input: {
            transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              // The new nested schema exposes these as explicit opt-ins rather
              // than session-wide defaults. Without create_response: true, the
              // server detects the caller has stopped talking but never
              // actually generates Emma's reply - which read as her going
              // silent mid-call with no error.
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: env.openaiRealtimeVoice,
          },
        },
        tools: EMMA_TOOLS,
        tool_choice: 'auto',
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI Realtime session creation failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    value: string;
    expires_at: number;
    session: { model: string };
  };

  return {
    clientSecret: data.value,
    expiresAt: new Date(data.expires_at * 1000).toISOString(),
    model: data.session?.model ?? env.openaiRealtimeModel,
  };
}
