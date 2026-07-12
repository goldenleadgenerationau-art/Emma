import nodemailer from 'nodemailer';
import { env } from '../config/env';
import type { CallSession } from '../types/lead';

export class EmailConfigError extends Error {}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!env.smtpUser || !env.smtpAppPassword) {
    throw new EmailConfigError(
      'Email is not configured. Set SMTP_USER and SMTP_APP_PASSWORD in your .env file.'
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: env.smtpUser, pass: env.smtpAppPassword },
    });
  }
  return transporter;
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
  const transport = getTransporter();
  const callDate = new Date(session.createdAt).toLocaleString('en-AU', {
    timeZone: env.timezone,
  });

  await transport.sendMail({
    from: env.smtpUser,
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

  const transport = getTransporter();
  const callDate = new Date(session.createdAt).toLocaleString('en-AU', {
    timeZone: env.timezone,
  });
  const firstName = session.lead.firstName ? `, ${session.lead.firstName}` : '';

  await transport.sendMail({
    from: env.smtpUser,
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
