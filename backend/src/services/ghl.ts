import { env } from '../config/env';
import type { LeadDetails } from '../types/lead';

export class GhlConfigError extends Error {}

function requireGhlConfig(): void {
  if (!env.ghlApiKey || !env.ghlLocationId) {
    throw new GhlConfigError(
      'GoHighLevel is not configured. Set GHL_API_KEY and GHL_LOCATION_ID in your .env file.'
    );
  }
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${env.ghlApiKey}`,
    Version: env.ghlApiVersion,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function ghlFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${env.ghlBaseUrl}${path}`, {
    ...init,
    headers: { ...ghlHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GoHighLevel request failed (${res.status}) ${path}: ${body}`);
  }
  return (await res.json()) as T;
}

interface GhlContactResponse {
  contact: { id: string };
}

/**
 * Creates the contact if new, or updates the existing one if a contact with
 * the same phone/email already exists in this location (GHL upsert semantics).
 * Tags and custom fields are applied on the same call.
 */
export async function upsertContact(lead: LeadDetails): Promise<string> {
  requireGhlConfig();

  const tags = ['AI Receptionist Demo', 'Website Lead'];
  if ((lead.interestedInAi ?? '').toLowerCase().includes('yes')) tags.push('Hot Lead');

  const payload = {
    locationId: env.ghlLocationId,
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    email: lead.email ?? undefined,
    phone: lead.mobile ?? undefined,
    companyName: lead.businessName ?? undefined,
    tags,
    source: 'GLG AI Receptionist (Emma)',
    customFields: [
      { key: 'business_type', field_value: lead.businessType ?? '' },
      { key: 'enquiries_per_week', field_value: lead.enquiriesPerWeek ?? '' },
      { key: 'current_receptionist', field_value: lead.currentReceptionist ?? '' },
      { key: 'current_crm', field_value: lead.currentCrm ?? '' },
      { key: 'interested_in_ai_receptionist', field_value: lead.interestedInAi ?? '' },
      { key: 'preferred_demo_day', field_value: lead.preferredDemoDay ?? '' },
      { key: 'preferred_demo_time', field_value: lead.preferredDemoTime ?? '' },
    ].filter((f) => f.field_value !== ''),
  };

  const data = await ghlFetch<GhlContactResponse>('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return data.contact.id;
}

interface GhlOpportunityResponse {
  opportunity: { id: string };
}

export async function createOpportunity(contactId: string, lead: LeadDetails): Promise<string | undefined> {
  requireGhlConfig();
  if (!env.ghlPipelineId || !env.ghlPipelineStageId) {
    // Pipeline isn't configured yet — this is optional, so skip quietly.
    return undefined;
  }

  const name = `${lead.businessName || lead.firstName || 'New lead'} - AI Receptionist Demo`;

  const data = await ghlFetch<GhlOpportunityResponse>('/opportunities/', {
    method: 'POST',
    body: JSON.stringify({
      pipelineId: env.ghlPipelineId,
      locationId: env.ghlLocationId,
      pipelineStageId: env.ghlPipelineStageId,
      name,
      status: 'open',
      contactId,
      assignedTo: env.ghlAssignedUserId || undefined,
    }),
  });

  return data.opportunity.id;
}

export async function triggerWorkflow(contactId: string): Promise<void> {
  requireGhlConfig();
  if (!env.ghlWorkflowId) return; // Optional until a workflow is wired up in GHL.

  await ghlFetch(`/contacts/${contactId}/workflow/${env.ghlWorkflowId}`, {
    method: 'POST',
    body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
  });
}

/**
 * End-to-end: upsert the contact, create the opportunity, and trigger the
 * workflow that sends SMS + email confirmation. Returns the ids so the
 * frontend/transcript can reference them.
 *
 * The opportunity and workflow steps are best-effort and must not block the
 * contact from being usable - a flaky pipeline/workflow config previously
 * made the whole sync throw even though the contact itself was created fine,
 * which in turn made book_demo_appointment fail for a reason that had
 * nothing to do with the calendar (it never even reached the booking call).
 */
export async function syncLeadToGhl(lead: LeadDetails) {
  const contactId = await upsertContact(lead);

  let opportunityId: string | undefined;
  try {
    opportunityId = await createOpportunity(contactId, lead);
  } catch (error) {
    console.error('[ghl] createOpportunity failed, continuing with contact only', error);
  }

  try {
    await triggerWorkflow(contactId);
  } catch (error) {
    console.error('[ghl] triggerWorkflow failed, continuing without it', error);
  }

  return { contactId, opportunityId };
}
