import React, { useState, useEffect } from 'react'
import { sbGet, sbPost, sbDel, saveSetting } from './lib/supabase'
import { lsGet, lsSet, lsDel, todayStr, userFromRow, userToRow, repProd, repGoal, repColl, getTcAlerts } from './lib/helpers'
import { INIT_PROVIDERS, INIT_STAFF, OFFICES } from './lib/constants'
import { Toast } from './components/ui'

// Pages
import LoginPage     from './pages/Login'
import ModuleHome    from './pages/ModuleHome'
import { ReportsSidebar, TcSidebar } from './pages/Sidebars'
import DashboardPage from './pages/reports/Dashboard'
import AnalyticsPage from './pages/reports/Analytics'
import ManagerFormPage from './pages/reports/Form'
import StaffFormPage   from './pages/reports/StaffForm'
import MorningHuddlePage from './pages/reports/Huddle'
import AdminPage     from './pages/admin/Admin'
import TcPatientsPage  from './pages/tc/Patients'
import TcAlertsPage    from './pages/tc/Alerts'
import TcDashboardPage from './pages/tc/Dashboard'
import CollectionTrackerPage from './pages/collections/CollectionTracker'
import OMReviewPage       from './pages/collections/OMReview'
import CollectionsHome    from './pages/collections/CollectionsHome'
import { CollectionsSidebar } from './pages/CollectionsSidebar'

export default function App() {
  const [ready,    setReady]    = useState(false)
  const [user,     setUser]     = useState(null)
  const [page,     setPage]     = useState('login')
  const [module,   setModule]   = useState(null)
  const [editReport, setEditReport] = useState(null)
  const [collPage,   setCollPage]   = useState('om_review')

  // Settings
  const [providers,     setProviders]     = useState(INIT_PROVIDERS)
  const [staff,         setStaff]         = useState(INIT_STAFF)
  const [users,         setUsers]         = useState([])
  const [repEmail,      setRepEmail]      = useState('owner@beautifulsmiles.com')
  const [officeEmails,  setOfficeEmails]  = useState({})

  // Data
  const [reports,    setReports]    = useState([])
  const [tcPatients, setTcPatients] = useState([])
  const [collectionPatients, setCollectionPatients] = useState([])

  // UI
  const [toast, setToast] = useState(null)

  // ── Startup ────────────────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        // Load users from Supabase (always fresh — cross-device login)
        const userRows = await sbGet('users', 'select=*&order=created_at')
        setUsers(userRows.map(userFromRow))

        // Load settings
        const settingRows = await sbGet('settings', 'select=key,value')
        const sm = {}
        settingRows.forEach(r => { sm[r.key] = r.value })
        if (sm.providers)    setProviders(sm.providers)
        if (sm.staff)        setStaff(sm.staff)
        if (sm.email)        setRepEmail(sm.email)
        if (sm.officeEmails) setOfficeEmails(sm.officeEmails)

        // Load reports (cache locally)
        const repRows = await sbGet('reports', 'select=data&order=date.desc')
        const loaded  = repRows.map(r => r.data).filter(Boolean)
        setReports(loaded)
        lsSet('bsbd_reports', loaded)

        // Load TC patients
        try {
          const tcRows = await sbGet('tc_patients', 'select=*&order=updated_at.desc')
          setTcPatients(tcRows)
        } catch {}

        // Load today's collection patients for TC alert matching
        try {
          const today = new Date().toISOString().split('T')[0]
          const cpRows = await sbGet('collection_patients', `date=eq.${today}&select=patient_name,patient_name_norm,office,operatory,date,total_expected,ins_status,ins_carrier,treatments,flags_total,flags_done,status,amount_collected`)
          setCollectionPatients(cpRows)
        } catch {}

      } catch {
        // Fallback to cache
        setReports(lsGet('bsbd_reports', []))
      }
      setReady(true)
    })()
  }, [])

  const notify = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }

  // ── Settings saves ─────────────────────────────────────────────────────
  const saveProv  = v => { setProviders(v); saveSetting('providers', v) }
  const saveStaff = v => { setStaff(v);     saveSetting('staff', v) }
  const saveEmail = v => { setRepEmail(v);  saveSetting('email', v) }
  const saveOfficeEmails = v => { setOfficeEmails(v); saveSetting('officeEmails', v) }

  // ── User management ────────────────────────────────────────────────────
  const addUser = async newUser => {
    await sbPost('users', userToRow(newUser))
    setUsers(prev => [...prev, newUser])
  }
  const removeUser = async id => {
    await sbDel('users', `id=eq.${id}`)
    setUsers(prev => prev.filter(u => u.id !== id))
  }

  // ── Reports ────────────────────────────────────────────────────────────
  const saveReports = v => { setReports(v); lsSet('bsbd_reports', v) }
  const upsertReport = async rep => {
    const row = { id: rep.id, date: rep.date, office: rep.office, submitted_by: rep.submittedBy, submitted_at: rep.submittedAt || new Date().toISOString(), data: rep }
    await sbPost('reports', row, true)
    setReports(prev => {
      const exists = prev.find(r => r.id === rep.id)
      const next   = exists ? prev.map(r => r.id === rep.id ? rep : r) : [rep, ...prev]
      lsSet('bsbd_reports', next)
      return next
    })
  }
  const refreshReports = async () => {
    try {
      const rows   = await sbGet('reports', 'select=data&order=date.desc')
      const loaded = rows.map(r => r.data).filter(Boolean)
      setReports(loaded); lsSet('bsbd_reports', loaded)
      notify('Reports refreshed from server')
    } catch { notify('Refresh failed', 'error') }
  }

  // ── TC patients ────────────────────────────────────────────────────────
  const loadTcPatients = async () => {
    try {
      const rows = await sbGet('tc_patients', 'select=*&order=updated_at.desc')
      setTcPatients(rows)
    } catch {}
  }
  const saveTcPatient = async p => {
    const row = { ...p, updated_at: new Date().toISOString() }
    await sbPost('tc_patients', row, true)
    setTcPatients(prev => {
      const ex = prev.find(x => x.id === p.id)
      return ex ? prev.map(x => x.id === p.id ? row : x) : [row, ...prev]
    })
  }
  const deleteTcPatient = async id => {
    await sbDel('tc_patients', `id=eq.${id}`)
    setTcPatients(prev => prev.filter(p => p.id !== id))
  }

  // ── Auth ───────────────────────────────────────────────────────────────
  const doLogin = (un, pw) => {
    const u = users.find(x => x.username === un && x.password === pw)
    if (u) {
      setUser(u)
      if (u.role === 'treatment_coordinator') { setModule('tc'); setPage('tc_patients') }
      else if (['admin', 'manager'].includes(u.role)) { setModule(null) }
      else { setModule('reports'); setPage('mySection') }
    } else {
      notify('Invalid username or password', 'error')
    }
  }
  const doLogout = () => { setUser(null); setPage('login'); setEditReport(null); setModule(null) }
  const openEdit = rep => { setEditReport(rep); setPage('form') }

  const goHome      = () => { setModule(null); setPage('home') }
  const openModule  = m => {
    setModule(m)
    if (m === 'reports') setPage(isManager ? 'huddle' : 'mySection')
    if (m === 'tc')      setPage('tc_patients')
    if (m === 'collections') setCollPage('om_review')
  }

  // ── Loading screen ──────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: '#64748b', fontWeight: 600, fontSize: 14 }}>Loading…</p>
      </div>
    )
  }

  if (!user) return <LoginPage doLogin={doLogin} />

  const isAdmin   = user.role === 'admin'
  const isManager = user.role === 'admin' || user.role === 'manager'
  const isTC      = user.role === 'treatment_coordinator' || isManager
  const tcAlertCount = getTcAlerts(tcPatients, user, isManager).length

  const officeStaff = staff[user.role === 'admin' ? (editReport?.office || user.office) : user.office] || []

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f1f5f9' }}>
      <Toast toast={toast} />
      {module === null
        ? <ModuleHome user={user} isAdmin={isAdmin} isManager={isManager} isTC={isTC} openModule={openModule} doLogout={doLogout} tcAlertCount={tcAlertCount} />
        : <>
          {module === 'reports' && <ReportsSidebar user={user} page={page} setPage={p => { setPage(p); if (p !== 'form') setEditReport(null) }} goHome={goHome} doLogout={doLogout} isAdmin={isAdmin} isManager={isManager} />}
          {module === 'collections' && <CollectionsSidebar user={user} page={collPage} setPage={setCollPage} goHome={goHome} doLogout={doLogout} isManager={isManager}/>}
          {module === 'tc'      && <TcSidebar      user={user} page={page} setPage={setPage} goHome={goHome} doLogout={doLogout} isManager={isManager} tcAlertCount={tcAlertCount} />}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Reports module */}
            {module === 'reports' && page === 'huddle'    && isManager  && <MorningHuddlePage reports={reports} providers={providers} tcPatients={tcPatients} users={users} notify={notify} />}
            {module === 'reports' && page === 'dashboard' && isManager  && <DashboardPage reports={reports} providers={providers} notify={notify} onEdit={openEdit} onRefresh={refreshReports} />}
            {module === 'reports' && page === 'analytics' && isManager  && <AnalyticsPage reports={reports} providers={providers} notify={notify} />}
            {module === 'reports' && page === 'form'      && isManager  && <ManagerFormPage key={editReport?.id || 'new'} user={user} providers={providers} users={users} officeStaff={officeStaff} reports={reports} upsertReport={upsertReport} repEmail={repEmail} notify={notify} editReport={editReport} onEditDone={() => setEditReport(null)} />}
            {module === 'reports' && page === 'mySection' && !isManager && <StaffFormPage user={user} providers={providers} notify={notify} />}
            {module === 'reports' && page === 'admin'     && isAdmin    && <AdminPage providers={providers} saveProv={saveProv} staff={staff} saveStaff={saveStaff} users={users} addUser={addUser} removeUser={removeUser} email={repEmail} saveEmail={saveEmail} officeEmails={officeEmails} saveOfficeEmails={saveOfficeEmails} notify={notify} />}
            {/* Collections module */}
            {module==='collections' && collPage==='om_review'          && isManager && <OMReviewPage user={user} isManager={isManager}/>}
            {module==='collections' && collPage==='collection_tracker' && <CollectionTrackerPage user={user} isManager={isManager}/>}
            {/* TC module */}
            {module === 'tc' && page === 'tc_patients'  && isTC      && <TcPatientsPage user={user} tcPatients={tcPatients} isManager={isManager} users={users} saveTcPatient={saveTcPatient} loadTcPatients={loadTcPatients} deleteTcPatient={deleteTcPatient} notify={notify} />}
            {module === 'tc' && page === 'tc_alerts'    && isTC      && <TcAlertsPage tcPatients={tcPatients} collectionPatients={collectionPatients} user={user} isManager={isManager} setPage={setPage} notify={notify} saveTcPatient={saveTcPatient} />}
            {module === 'tc' && page === 'tc_dashboard' && isManager && <TcDashboardPage tcPatients={tcPatients} users={users} />}
          </div>
        </>
      }
    </div>
  )
}
