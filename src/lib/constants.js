export const OFFICES = ['Brainerd', 'Calhoun', 'Dalton', 'McCallie']

export const INIT_PROVIDERS = [
  { id: 'p1', name: 'DR PATEL',    goal: 5000, office: 'Brainerd' },
  { id: 'p2', name: 'DR PINOS',    goal: 5000, office: 'Brainerd' },
  { id: 'p3', name: 'DR TAARIQ',   goal: 5000, office: 'McCallie' },
  { id: 'p4', name: 'DR EGBONIM',  goal: 5000, office: 'Dalton' },
  { id: 'p5', name: 'DR OSINUSI',  goal: 5000, office: 'Calhoun' },
  { id: 'p6', name: 'DR CHIKWAVA', goal: 7500, office: 'Owner · All Offices' },
]

export const INIT_STAFF = {
  Brainerd: [], Calhoun: [], Dalton: [],
  McCallie: ['KAELI', 'STEPHANIE', 'CRISTINA', 'STANDBY', 'RDSS'],
}

export const RANGE_LABEL = { today: "Today's", week: "This Week's", mtd: 'MTD', last30: "Last 30 Days'", custom: 'Selected' }
export const RANGE_TITLE = { today: 'Today', week: 'This Week', mtd: 'Month to Date', last30: 'Last 30 Days', custom: 'Custom Range' }

export const TC_STATUSES = [
  { key: 'consult',           label: 'Consult Done',       color: '#d97706', bg: '#fef3c7' },
  { key: 'tx_presented',      label: 'TX Presented',        color: '#2563eb', bg: '#eff6ff' },
  { key: 'payment_confirmed', label: 'Payment Confirmed',   color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'scheduled',         label: 'Scheduled',           color: '#0891b2', bg: '#e0f2fe' },
  { key: 'in_treatment',      label: 'In Treatment',        color: '#0d9488', bg: '#f0fdfa' },
  { key: 'completed',         label: 'Completed ✓',         color: '#16a34a', bg: '#dcfce7' },
  { key: 'declined',          label: 'Declined',            color: '#dc2626', bg: '#fee2e2' },
  { key: 'lost',              label: 'Lost to Follow-up',   color: '#6b7280', bg: '#f3f4f6' },
]
export const TC_STATUS_MAP = Object.fromEntries(TC_STATUSES.map(s => [s.key, s]))
export const TC_PIPELINE = ['consult', 'tx_presented', 'payment_confirmed', 'scheduled', 'in_treatment', 'completed']

export const TC_PAYMENT_METHODS = ['Credit/Debit', 'Cash', 'CareCredit', 'In-House Payment Plan']
export const TC_FOLLOWUP_TYPES = [
  'Day after consultation', '1 week before appointment', 'Day before appointment',
  'Check-in call', 'Reschedule call', 'General follow-up',
]

export const TC_CHECKLIST = [
  { id: 's1',  section: '1. Build Relationship',           items: ['Seated in private room', 'Offered water/coffee', 'Spoke slowly and clearly', 'Patient understands diagnosis', 'Patient repeated back understanding'] },
  { id: 's2',  section: '2. Present Treatment Plan',       items: ['Went line-by-line through plan', 'Explained what & why', 'Discussed # of visits and length', 'Patient understands sequence of care'] },
  { id: 's3',  section: '3. Discuss Payment Options',      items: ["Asked how they'd like to pay", 'Payment method confirmed', 'Financing application run before leaving', '10% deposit collected (if 2+ hr appt)'] },
  { id: 's4',  section: '4. Written Financial Breakdown',  items: ['Total cost given', 'Cost per visit given', 'Due dates given', 'Deposit amount noted', 'Signed copy kept in chart'] },
  { id: 's5',  section: '5. Book the Appointment',         items: ['Appropriate time reserved', 'Payment/documents confirmed', 'Detailed notes added to chart'] },
  { id: 's6',  section: '6. Follow-up Communication',      items: ['Called day after consultation', 'Called week before appointment', 'Called day before appointment', 'Procedure/amount/arrival/driver/sedation confirmed'] },
  { id: 's7',  section: '7. Day-of Preparation',           items: ['Insurance verified', 'Payment setup confirmed', 'Lab items/records ready', 'Room assigned', 'Team aware of plan', 'Notes completed'] },
  { id: 's8',  section: '8. Day-of Patient Greeting',      items: ['Greeted warmly', 'Brought to room immediately', "Reviewed today's procedure", 'Reviewed cost for today', 'Confirmed next visit'] },
  { id: 's9',  section: '9. No Patient Leaves Confused',   items: ['Next appointment scheduled', 'Patient knows amount due next visit', 'Patient knows next procedure', 'Patient has written summary'] },
  { id: 's10', section: '10. Accountability',              items: ['Patient tracked throughout', 'All calls/texts documented', 'Chart notes completed', 'No one slipped through the cracks'] },
]
