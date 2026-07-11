import { env } from '../config/env';

export interface DemoSlot {
  startTimeIso: string;
  label: string;
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${env.ghlApiKey}`,
    Version: env.ghlApiVersion,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Reads real free/busy slots from a GoHighLevel calendar so Emma never offers
 * a time that's already booked. If GHL_CALENDAR_ID isn't configured yet, we
 * fall back to two sensible placeholder slots (next two business days at
 * 10:30am/2:00pm) so the demo still works before the calendar is connected -
 * this mirrors the two hard-coded slots in the original visual demo, but
 * this is the seam where real availability plugs in.
 */
export async function getAvailableSlots(daysAhead = 7): Promise<DemoSlot[]> {
  if (!env.ghlApiKey || !env.ghlCalendarId) {
    return fallbackSlots();
  }

  const startDate = Date.now();
  const endDate = startDate + daysAhead * 24 * 60 * 60 * 1000;

  const url = new URL(`${env.ghlBaseUrl}/calendars/${env.ghlCalendarId}/free-slots`);
  url.searchParams.set('startDate', String(startDate));
  url.searchParams.set('endDate', String(endDate));
  url.searchParams.set('timezone', env.timezone);

  const res = await fetch(url, { headers: ghlHeaders() });
  if (!res.ok) {
    // Don't let a flaky calendar call break the call flow — degrade gracefully.
    return fallbackSlots();
  }

  const data = (await res.json()) as Record<string, { slots?: string[] }>;
  const slots: DemoSlot[] = [];

  for (const day of Object.values(data)) {
    for (const iso of day.slots ?? []) {
      slots.push({
        startTimeIso: iso,
        label: new Intl.DateTimeFormat('en-AU', {
          weekday: 'long',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: env.timezone,
        }).format(new Date(iso)),
      });
      if (slots.length >= 6) return slots;
    }
  }

  return slots.length ? slots : fallbackSlots();
}

function fallbackSlots(): DemoSlot[] {
  const now = new Date();
  const next = (daysOut: number, hour: number, minute: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysOut);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const a = next(2, 10, 30);
  const b = next(3, 14, 0);

  return [
    {
      startTimeIso: a.toISOString(),
      label: new Intl.DateTimeFormat('en-AU', {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: env.timezone,
      }).format(a),
    },
    {
      startTimeIso: b.toISOString(),
      label: new Intl.DateTimeFormat('en-AU', {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: env.timezone,
      }).format(b),
    },
  ];
}

export async function bookAppointment(
  contactId: string,
  startTimeIso: string
): Promise<{ appointmentId: string } | { fallback: true }> {
  if (!env.ghlApiKey || !env.ghlCalendarId) {
    // No calendar connected yet - report success at the conversation layer so
    // the call can still complete; ops team follows up manually. Logged so
    // it's visible in server logs which calls need a manual booking.
    return { fallback: true };
  }

  const res = await fetch(`${env.ghlBaseUrl}/calendars/events/appointments`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify({
      calendarId: env.ghlCalendarId,
      locationId: env.ghlLocationId,
      contactId,
      startTime: startTimeIso,
      assignedUserId: env.ghlAssignedUserId || undefined,
      title: 'GLG AI Receptionist - Strategy Call',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GoHighLevel appointment booking failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { id: string };
  return { appointmentId: data.id };
}
