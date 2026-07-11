export interface LeadDetails {
  firstName?: string;
  lastName?: string;
  mobile?: string;
  email?: string;
  businessName?: string;
  businessType?: string;
  enquiriesPerWeek?: string;
  currentReceptionist?: string;
  currentCrm?: string;
  interestedInAi?: string;
  preferredDemoDay?: string;
  preferredDemoTime?: string;
  consentToStore?: boolean;
}

export interface CallSession {
  id: string;
  createdAt: string;
  lead: LeadDetails;
  ghlContactId?: string;
  ghlOpportunityId?: string;
  bookedAppointmentId?: string;
  transcript: { role: 'caller' | 'emma'; text: string; at: string }[];
}
