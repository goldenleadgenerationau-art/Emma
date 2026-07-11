# GoHighLevel setup

Emma talks to GoHighLevel (GHL) through the **LeadConnector v2 REST API**, using
a **Private Integration** token (not OAuth) — the simplest option for a single
GHL location.

## 1. Create the Private Integration token

1. In GHL: **Settings → Private Integrations → Create new integration**.
2. Name it `GLG AI Receptionist (Emma)`.
3. Grant these scopes:
   - `contacts.readonly`, `contacts.write`
   - `opportunities.readonly`, `opportunities.write`
   - `calendars.readonly`, `calendars/events.write`
   - `workflows.readonly`
4. Copy the generated token into `backend/.env` as `GHL_API_KEY`.
5. Copy your Location ID (**Settings → Business Profile**) into `GHL_LOCATION_ID`.

## 2. Custom fields

Emma writes these custom fields on the contact record. Create them under
**Settings → Custom Fields → Contact** (type: single line text unless noted),
using these exact field keys:

| Field key                        | Label (suggested)                 |
|-----------------------------------|------------------------------------|
| `business_type`                   | Business Type                     |
| `enquiries_per_week`               | Enquiries Per Week                |
| `current_receptionist`             | Current Receptionist Situation    |
| `current_crm`                      | Current CRM                       |
| `interested_in_ai_receptionist`    | Interested in AI Receptionist     |
| `preferred_demo_day`               | Preferred Demo Day                |
| `preferred_demo_time`              | Preferred Demo Time               |

## 3. Tags

These are applied automatically and don't need to be pre-created, but you may
want matching automations/smart lists for them:

- `AI Receptionist Demo`
- `Website Lead`
- `Hot Lead` (only if the caller said they're interested)

## 4. Pipeline (optional but recommended)

1. Create (or reuse) a pipeline, e.g. **AI Receptionist Demo**.
2. Add a stage, e.g. **Demo Requested**.
3. Copy the pipeline ID and stage ID into `GHL_PIPELINE_ID` /
   `GHL_PIPELINE_STAGE_ID`. You can find these in the URL when you open the
   pipeline in GHL, or via `GET /opportunities/pipelines` on the API.

If you leave these blank, Emma still creates/updates the contact and applies
tags - opportunity creation is simply skipped until you configure it.

## 5. Workflow (SMS + email confirmation)

1. Build a workflow in GHL triggered by **"Contact enters workflow"** (not a
   tag trigger - Emma calls the workflow directly).
2. Add your SMS and email confirmation steps, plus an internal notification
   step (e.g. Slack/email to the sales team) and appointment confirmation
   step.
3. Copy the workflow ID into `GHL_WORKFLOW_ID`. You can find it in the
   workflow's URL in GHL.

## 6. Calendar

1. Create or reuse a calendar for demo bookings.
2. Copy its calendar ID into `GHL_CALENDAR_ID` and set `GHL_ASSIGNED_USER_ID`
   to the team member new bookings should be assigned to.
3. Until this is set, Emma still completes the call and offers two
   placeholder time slots, and the sales team follows up manually to
   schedule - nothing breaks, it just isn't wired to the live calendar yet.

## Testing the integration directly

You can sanity-check your token and IDs before wiring up a live call:

```bash
curl -X POST https://services.leadconnectorhq.com/contacts/upsert \
  -H "Authorization: Bearer $GHL_API_KEY" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json" \
  -d '{
    "locationId": "'"$GHL_LOCATION_ID"'",
    "firstName": "Test",
    "lastName": "Lead",
    "phone": "+61400000000",
    "tags": ["AI Receptionist Demo"]
  }'
```

A `200` response with a `contact.id` confirms the token, location ID, and
scopes are all correct.
