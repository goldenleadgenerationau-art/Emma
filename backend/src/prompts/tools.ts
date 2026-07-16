/**
 * Tool (function-calling) definitions passed to the OpenAI Realtime session.
 *
 * The browser holds the live WebRTC/data-channel connection to OpenAI. When the
 * model wants to call one of these, the browser receives a
 * `response.function_call_arguments.done` event, POSTs the arguments to the
 * matching backend endpoint below, and returns the JSON result to the model
 * over the data channel. This keeps the OpenAI + GHL API keys server-side only.
 */

export const EMMA_TOOLS = [
  {
    type: 'function',
    name: 'save_lead_details',
    description:
      'Save or update whatever lead qualification details have been gathered so far in the call. Call this every time you learn a new piece of information, not just once at the end.',
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        mobile: { type: 'string' },
        email: { type: 'string' },
        businessName: { type: 'string' },
        businessType: { type: 'string' },
        enquiriesPerWeek: { type: 'string' },
        currentReceptionist: { type: 'string' },
        currentCrm: { type: 'string' },
        interestedInAi: { type: 'string' },
        preferredDemoDay: { type: 'string' },
        preferredDemoTime: { type: 'string' },
        consentToStore: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_available_demo_slots',
    description: 'Look up real, currently-available demo appointment slots from the calendar.',
    parameters: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: 'How many days ahead to search. Defaults to 7.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'book_demo_appointment',
    description:
      'Book the confirmed demo slot into the calendar once the caller has chosen a time and all required lead details have been collected.',
    parameters: {
      type: 'object',
      properties: {
        slotNumber: {
          type: 'number',
          description:
            'The slotNumber of the chosen slot from the most recent get_available_demo_slots call. Best effort - if get_available_demo_slots was called more than once this call, numbers can shift between calls, so this may be stale. Never guess or construct this.',
        },
        label: {
          type: 'string',
          description:
            'The exact label of the chosen slot (e.g. "Tuesday 9:00 am") exactly as you said it to the caller, copied verbatim from the get_available_demo_slots result. Always include this alongside slotNumber - it is the reliable fallback match if the number turns out to be stale.',
        },
      },
      required: ['slotNumber', 'label'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'submit_lead_to_crm',
    description:
      'Finalize the call: push the collected lead into GoHighLevel (contact, tags, opportunity) and trigger the follow-up workflow (SMS + email confirmation). Only call this once, near the end of the call, after the caller has confirmed their details.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
] as const;
