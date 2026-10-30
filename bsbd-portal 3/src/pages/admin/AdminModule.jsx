// src/pages/admin/AdminModule.jsx — Admin as its own module (managers/admins only):
// user accounts and roles, providers, front desk names, office emails, settings.
// The tabs themselves live in Admin.jsx; this only adds the module top bar.

import React from 'react'
import ModuleShell from '../ModuleShell'
import AdminPage from './Admin'

export default function AdminModule({ goHome, ...props }) {
  return (
    <ModuleShell title="Admin" subtitle="Accounts and roles, providers, staff, emails and settings" goHome={goHome}>
      <AdminPage {...props} />
    </ModuleShell>
  )
}
