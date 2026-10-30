// src/lib/roles.js — who sees which module. One place to change access.
//
// Roles stored on the users table:
//   admin, manager            everything
//   provider                  dentist: Daily Reports, Note Builder, Supplies
//   hygienist                 Daily Reports, Note Builder, Supplies
//   assistant                 Note Builder, Supplies
//   staff (= front desk)      Daily Reports data entry, Collections, Recalls, Note Builder, Supplies
//   front_desk                same as staff (accepted so either name works)
//   treatment_coordinator     TC Tracker, Recalls, Note Builder, Supplies
//   ridgeview                 own portal + clinical notes (handled in App.jsx)

export const ROLE_LABELS = {
  admin: 'Administrator',
  manager: 'Manager',
  provider: 'Dentist',
  hygienist: 'Hygienist',
  assistant: 'Assistant',
  staff: 'Front Desk',
  front_desk: 'Front Desk',
  treatment_coordinator: 'Treatment Coordinator',
  ridgeview: 'Ridgeview Billing',
}

// The roles offered when creating a login. New front desk logins are saved as
// "front_desk"; older ones saved as "staff" work the same way.
export const ROLE_OPTIONS = ['admin', 'manager', 'provider', 'hygienist', 'assistant', 'front_desk', 'treatment_coordinator', 'ridgeview']

// One line per role for the Admin page: what that login can open.
export const ROLE_ACCESS_TEXT = {
  admin: 'Everything, including Admin settings',
  manager: 'Everything, including Admin settings',
  provider: 'Daily Reports, Note Builder (adds findings), Supplies',
  hygienist: 'Daily Reports, Note Builder, Supplies',
  assistant: 'Note Builder, Supplies',
  front_desk: 'Daily report entry, Collections, Recall Tracker, Note Builder, Supplies',
  staff: 'Daily report entry, Collections, Recall Tracker, Note Builder, Supplies',
  treatment_coordinator: 'TC Tracker, Recall Tracker, Note Builder, Supplies',
  ridgeview: 'Ridgeview portal and clinical notes (billing review)',
}

const ACCESS = {
  provider: ['reports', 'notebuilder', 'supplies'],
  hygienist: ['reports', 'notebuilder', 'supplies'],
  assistant: ['notebuilder', 'supplies'],
  staff: ['reports', 'collections', 'recalls', 'notebuilder', 'supplies'],
  front_desk: ['reports', 'collections', 'recalls', 'notebuilder', 'supplies'],
  treatment_coordinator: ['tc', 'recalls', 'notebuilder', 'supplies'],
}

export const isManagerRole = role => role === 'admin' || role === 'manager'
export const isFrontDesk = role => role === 'staff' || role === 'front_desk'

// Can this role open this module? Managers see everything.
export function canOpen(role, moduleKey) {
  if (isManagerRole(role)) return true
  return (ACCESS[role] || []).includes(moduleKey)
}
