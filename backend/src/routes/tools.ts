import { Router } from 'express';
import { z } from 'zod';
import { getSession, updateLead, attachCrmIds, setOfferedSlots } from '../services/sessionStore';
import { getAvailableSlots, bookAppointment } from '../services/calendar';
import { syncLeadToGhl, GhlConfigError } from '../services/ghl';

export const toolsRouter = Router();

function requireSession(sessionId: unknown) {
  if (typeof sessionId !== 'string') return undefined;
  return getSession(sessionId);
}

/**
 * POST /api/tools/save-lead-details
 * Mirrors the `save_lead_details` realtime tool. Called repeatedly through
 * the call as Emma learns new details - never a single big form submit.
 */
const saveLeadSchema = z.object({
  sessionId: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().optional(),
  businessName: z.string().optional(),
  businessType: z.string().optional(),
  enquiriesPerWeek: z.string().optional(),
  currentReceptionist: z.string().optional(),
  currentCrm: z.string().optional(),
  interestedInAi: z.string().optional(),
  preferredDemoDay: z.string().optional(),
  preferredDemoTime: z.string().optional(),
  consentToStore: z.boolean().optional(),
});

toolsRouter.post('/tools/save-lead-details', (req, res) => {
  const parsed = saveLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { sessionId, ...patch } = parsed.data;
  const session = updateLead(sessionId, patch);
  if (!session) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  res.json({ ok: true, lead: session.lead });
});

/**
 * POST /api/tools/available-slots
 * Mirrors `get_available_demo_slots`.
 */
toolsRouter.post('/tools/available-slots', async (req, res) => {
  const sessionId = req.body?.sessionId;
  if (!requireSession(sessionId)) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  const daysAhead = typeof req.body?.daysAhead === 'number' ? req.body.daysAhead : 7;
  try {
    const slots = await getAvailableSlots(daysAhead);
    const offeredSlots = slots.map((slot, index) => ({ slotNumber: index + 1, ...slot }));
    setOfferedSlots(sessionId, offeredSlots);
    // Deliberately withhold startTimeIso from what the model sees - it must
    // reference a slot by number, never retype a timestamp itself. See
    // book-appointment below for why: a voice model retyping an exact ISO
    // string from memory was the actual cause of "every slot is taken".
    res.json({ slots: offeredSlots.map(({ slotNumber, label }) => ({ slotNumber, label })) });
  } catch (error) {
    console.error('[tools] available-slots failed', error);
    res.status(500).json({ error: 'Could not load calendar availability.' });
  }
});

/**
 * POST /api/tools/book-appointment
 * Mirrors `book_demo_appointment`. Takes a slotNumber (from the most recent
 * get_available_demo_slots result) rather than a raw ISO time, so the model
 * never has to retype an exact timestamp from memory - the real value is
 * looked up server-side from what was actually offered.
 * Requires the lead to already have an associated GHL contact - if
 * `submit_lead_to_crm` hasn't run yet, we create the contact here first so
 * booking never fails purely on ordering.
 */
toolsRouter.post('/tools/book-appointment', async (req, res) => {
  const { sessionId, slotNumber } = req.body ?? {};
  const session = requireSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }
  if (typeof slotNumber !== 'number') {
    res.status(400).json({ error: 'slotNumber is required' });
    return;
  }
  const chosen = session.offeredSlots?.find((slot) => slot.slotNumber === slotNumber);
  if (!chosen) {
    res.status(400).json({
      error: 'That slot number is not from the current list. Call get_available_demo_slots again for a fresh list.',
    });
    return;
  }

  try {
    let contactId = session.ghlContactId;
    if (!contactId) {
      const synced = await syncLeadToGhl(session.lead);
      contactId = synced.contactId;
      attachCrmIds(sessionId, { ghlContactId: synced.contactId, ghlOpportunityId: synced.opportunityId });
    }

    const result = await bookAppointment(contactId, chosen.startTimeIso);
    if ('appointmentId' in result) {
      attachCrmIds(sessionId, { bookedAppointmentId: result.appointmentId });
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof GhlConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    console.error('[tools] book-appointment failed', error);
    res.status(500).json({ error: 'Could not book the appointment.' });
  }
});

/**
 * POST /api/tools/submit-lead
 * Mirrors `submit_lead_to_crm`. Upserts the GHL contact, creates the
 * opportunity in the configured pipeline/stage, and fires the workflow that
 * sends the SMS + email confirmation.
 */
toolsRouter.post('/tools/submit-lead', async (req, res) => {
  const sessionId = req.body?.sessionId;
  const session = requireSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Unknown session' });
    return;
  }

  try {
    const { contactId, opportunityId } = await syncLeadToGhl(session.lead);
    attachCrmIds(sessionId, { ghlContactId: contactId, ghlOpportunityId: opportunityId });
    res.json({ ok: true, contactId, opportunityId });
  } catch (error) {
    if (error instanceof GhlConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    console.error('[tools] submit-lead failed', error);
    res.status(500).json({ error: 'Could not sync the lead to the CRM.' });
  }
});
