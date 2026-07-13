import { env } from '../config/env';
import type { CallSession } from '../types/lead';

export class EmailConfigError extends Error {}

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Sends via Resend's HTTP API rather than SMTP. Render's free tier blocks
 * outbound SMTP ports (25/465/587) entirely, which made Gmail SMTP hang
 * forever with no error - HTTPS to Resend's API isn't affected by that.
 */
async function sendViaResend(payload: { to: string; subject: string; text: string }): Promise<void> {
  if (!env.resendApiKey || !env.emailFrom) {
    throw new EmailConfigError(
      'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM in your .env file.'
    );
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Resend email send failed (${response.status}): ${body}`);
  }
}

function formatLeadSummary(lead: CallSession['lead']): string {
  const labels: Record<keyof CallSession['lead'], string> = {
    firstName: 'First name',
    lastName: 'Last name',
    mobile: 'Mobile',
    email: 'Email',
    businessName: 'Business name',
    businessType: 'Business type',
    enquiriesPerWeek: 'Enquiries per week',
    currentReceptionist: 'Current receptionist',
    currentCrm: 'Current CRM',
    interestedInAi: 'Interested in AI',
    preferredDemoDay: 'Preferred demo day',
    preferredDemoTime: 'Preferred demo time',
    consentToStore: 'Consented to store details',
  };
  const lines = (Object.keys(labels) as (keyof CallSession['lead'])[])
    .filter((key) => lead[key] !== undefined && lead[key] !== '')
    .map((key) => `${labels[key]}: ${lead[key]}`);
  return lines.length > 0 ? lines.join('\n') : '(no lead details captured yet)';
}

function formatTranscript(transcript: CallSession['transcript']): string {
  if (transcript.length === 0) return '(transcript is empty)';
  return transcript
    .map((line) => {
      const time = new Date(line.at).toLocaleTimeString('en-AU', { hour12: false });
      const speaker = line.role === 'emma' ? 'Emma' : 'Caller';
      return `[${time}] ${speaker}: ${line.text}`;
    })
    .join('\n');
}

export class NoCallerEmailError extends Error {}

/** Internal backup copy, sent to the business's own inbox (TRANSCRIPT_EMAIL_TO). */
export async function sendInternalTranscriptEmail(session: CallSession): Promise<void> {
  const callDate = new Date(session.createdAt).toLocaleString('en-AU', {
    timeZone: env.timezone,
  });

  await sendViaResend({
    to: env.transcriptEmailTo,
    subject: `Emma call transcript backup - ${callDate}`,
    text: [
      `Call started: ${callDate}`,
      `Session ID: ${session.id}`,
      '',
      'Lead details captured so far:',
      formatLeadSummary(session.lead),
      '',
      'Transcript:',
      formatTranscript(session.transcript),
    ].join('\n'),
  });
}

/** Caller-facing copy, sent to whatever email Emma captured during the call. */
export async function sendCallerTranscriptEmail(session: CallSession): Promise<void> {
  const callerEmail = session.lead.email;
  if (!callerEmail) {
    throw new NoCallerEmailError(
      "We don't have an email on file for this call yet - let Emma know your email during the conversation and try again."
    );
  }

  const callDate = new Date(session.createdAt).toLocaleString('en-AU', {
    timeZone: env.timezone,
  });
  const firstName = session.lead.firstName ? `, ${session.lead.firstName}` : '';

  await sendViaResend({
    to: callerEmail,
    subject: 'Your conversation with Emma - Golden Lead Generation',
    text: [
      `Hi${firstName},`,
      '',
      `Thanks for chatting with Emma on ${callDate}. Here's a copy of your conversation:`,
      '',
      formatTranscript(session.transcript),
      '',
      "If you have any questions, just reply to this email and our team will follow up.",
    ].join('\n'),
  });
}
