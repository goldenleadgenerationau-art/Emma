import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    // We don't throw at import time for every optional integration (GHL, calendar)
    // so the server can boot in a partially-configured demo mode. Routes that need
    // a specific value check for it themselves and return a clear 503 instead.
    return '';
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '8080', 10),

  // CORS: comma-separated list of allowed origins (your Vercel domain, localhost, etc.)
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // OpenAI Realtime
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime',
  openaiRealtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? 'shimmer',

  // GoHighLevel (Private Integration token, LeadConnector v2 API)
  ghlApiKey: required('GHL_API_KEY'),
  ghlLocationId: required('GHL_LOCATION_ID'),
  ghlBaseUrl: process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com',
  ghlApiVersion: process.env.GHL_API_VERSION ?? '2021-07-28',
  ghlPipelineId: process.env.GHL_PIPELINE_ID ?? '',
  ghlPipelineStageId: process.env.GHL_PIPELINE_STAGE_ID ?? '',
  ghlWorkflowId: process.env.GHL_WORKFLOW_ID ?? '',
  ghlCalendarId: process.env.GHL_CALENDAR_ID ?? '',
  ghlAssignedUserId: process.env.GHL_ASSIGNED_USER_ID ?? '',

  // Email (Gmail SMTP) - used to send a call transcript backup on request
  smtpUser: required('SMTP_USER'),
  smtpAppPassword: required('SMTP_APP_PASSWORD'),
  transcriptEmailTo: process.env.TRANSCRIPT_EMAIL_TO ?? 'sales@goldenleadgeneration.com.au',

  // Misc
  timezone: process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney',
};

export function assertConfigured(keys: (keyof typeof env)[]): string[] {
  return keys.filter((k) => !env[k]);
}
