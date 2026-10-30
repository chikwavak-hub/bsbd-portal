// src/pages/tools/Tools.jsx — the Tools module: shared utilities every role can use.
// To add a tool: import it and add one entry to TOOLS (key, tab label, component).

import React, { useState } from 'react'
import ModuleShell from '../ModuleShell'
import CalculatorsTab from '../ridgeview/CalculatorsTab'

const TOOLS = [
  { key: 'calculators', label: 'Payment calculators', render: p => <CalculatorsTab user={p.user} notify={p.notify} kicker="BSBD TOOLS" /> },
]

export default function ToolsPage({ user, notify, goHome }) {
  const [tab, setTab] = useState(TOOLS[0].key)
  const tool = TOOLS.find(t => t.key === tab) || TOOLS[0]
  return (
    <ModuleShell title="Tools" subtitle={TOOLS.length > 1 ? null : tool.label} goHome={goHome}
      tabs={TOOLS.map(t => [t.key, t.label])} tab={tab} setTab={setTab}>
      {tool.render({ user, notify })}
    </ModuleShell>
  )
}
