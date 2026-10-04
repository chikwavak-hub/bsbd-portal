// src/pages/notes/ToothChart.jsx
// Clickable tooth chart for the Note Builder, drawn in the BSBD tooth-icon style
// (outlined teeth, light fill, number badges). Universal numbering, laid out the way the
// dentist faces the patient: patient's right on the left. Upper 1-16 across the top with
// roots up; lower 32-17 across the bottom with roots down. Primary chart: A-J, T-K.
//
// Props:
//   selected   array of tooth ids ('14', 'A')
//   onToggle   (id) => void
//   multi      true lets several teeth be picked (for the aria label only)
//   primary    true shows the primary chart
//   disabled   ids that can't be picked (optional)

import { toothInfo } from '../../lib/toothAnatomy'

const STROKE = '#1F5F9F', FILL = '#F1F8FE', DETAIL = '#7FB0DA', BADGE = '#0E3566', HOVER = '#DCEBFA'
const SEL = '#1B2A6B', SEL_DETAIL = '#9DB4E6', GOLD = '#C9A84C'

// ---- icon outlines, drawn upright in a 100-unit-tall box (y grows downward)
// Upper teeth: roots at the top (y 0-44), crown below. Lower teeth: crown on top, roots below.
const ICONS = {
  upperMolar: { w: 60, d: 'M5,44 C3,26 6,6 10,0 C13,6 18,16 20,24 C22,14 27,2 30,0 C33,2 38,14 40,24 C42,16 47,6 50,0 C54,6 57,26 55,44 L56,46 L56,80 C62,84 61,98 52,98 C48,101 44,101 41,98 C37,101 33,101 30,98 C27,101 23,101 19,98 C16,101 12,101 8,98 C-1,98 -2,84 4,80 L4,46 Z',
    line: [30, 58, 30, 70], arc: 'M12,76 Q30,92 48,76' },
  upperPremolar: { w: 44, d: 'M4,44 C2,26 4,6 8,0 C11,6 14,16 15,24 C17,14 20,2 22,0 C24,2 27,14 29,24 C30,16 33,6 36,0 C40,6 42,26 40,44 L41,46 L40,84 C43,97 34,101 28,97 C25,100 19,100 16,97 C10,101 1,97 4,84 L3,46 Z',
    line: [22, 58, 22, 70], arc: 'M7,76 Q22,90 37,76' },
  upperCanine: { w: 40, d: 'M13,44 C13,26 17,8 20,0 C23,8 27,26 27,44 Q31,46 31,52 L38,80 L20,98 L2,80 L9,52 Q9,46 13,44 Z',
    line: null, arc: 'M14,82 Q20,90 26,82' },
  upperCentral: { w: 40, d: 'M14,44 C14,26 17,8 20,0 C23,8 26,26 26,44 Q30,46 31,51 L38,92 Q38,98 20,98 Q2,98 2,92 L9,51 Q10,46 14,44 Z',
    line: null, arc: 'M14,84 Q20,92 26,84' },
  upperLateral: { w: 34, d: 'M13,42 C13,26 15,8 17,0 C19,8 21,26 21,42 Q26,44 24,50 L30,90 Q30,96 17,96 Q4,96 4,90 L10,50 Q8,44 13,42 Z',
    line: null, arc: 'M11,82 Q17,90 23,82' },
  lowerMolar: { w: 60, d: 'M4,22 C-2,6 8,0 14,4 C18,0 26,0 30,4 C34,0 42,0 46,4 C52,0 62,6 56,22 L56,50 Q56,56 52,58 C53,76 50,92 46,100 C42,94 37,80 34,70 L26,70 C23,80 18,94 14,100 C10,92 7,76 8,58 Q4,56 4,50 Z',
    line: [30, 12, 30, 26], arc: 'M12,32 Q30,48 48,32' },
  lowerPremolar: { w: 44, d: 'M4,20 C2,4 12,0 18,4 C20,6 21,7 22,9 C23,7 24,6 26,4 C32,0 42,4 40,20 L40,50 Q40,56 37,58 C38,76 36,92 33,100 C30,94 27,80 25,70 L19,70 C17,80 14,94 11,100 C8,92 6,76 7,58 Q4,56 4,50 Z',
    line: [22, 12, 22, 26], arc: 'M7,30 Q22,44 37,30' },
  lowerCanine: { w: 40, d: 'M20,0 L38,18 L36,42 Q34,47 32,49 Q30,52 29,56 C27,74 23,90 20,100 C17,90 13,74 11,56 Q10,52 8,49 Q6,47 4,42 L2,18 Z',
    line: null, arc: 'M14,28 Q20,36 26,28' },
  lowerIncisor: { w: 36, d: 'M3,6 Q18,0 33,6 L29,46 Q32,50 28,54 C26,72 22,90 18,100 C14,90 10,72 8,54 Q4,50 7,46 Z',
    line: null, arc: 'M12,26 Q18,34 24,26' },
}

function iconFor(ti) {
  if (ti.arch === 'max') {
    if (ti.kind === 'molar') return ICONS.upperMolar
    if (ti.kind === 'premolar') return ICONS.upperPremolar
    if (ti.kind === 'canine') return ICONS.upperCanine
    return ti.pos === 1 ? ICONS.upperCentral : ICONS.upperLateral
  }
  if (ti.kind === 'molar') return ICONS.lowerMolar
  if (ti.kind === 'premolar') return ICONS.lowerPremolar
  if (ti.kind === 'canine') return ICONS.lowerCanine
  return ICONS.lowerIncisor
}

const PERM_UPPER = Array.from({ length: 16 }, (_, i) => String(i + 1))
const PERM_LOWER = Array.from({ length: 16 }, (_, i) => String(32 - i))
const PRIM_UPPER = 'ABCDEFGHIJ'.split('')
const PRIM_LOWER = 'TSRQPONMLK'.split('')

const VB_W = 800
const ICON_H = 88         // drawn height of each tooth
const SCALE = ICON_H / 100

function Tooth({ id, x, y, ti, on, off, onToggle, upper }) {
  const icon = iconFor(ti)
  const w = icon.w * SCALE * (ti.primary ? 1.15 : 1)
  const s = w / icon.w
  const h = 100 * s
  const badgeY = upper ? y - 14 : y + h + 14
  const fill = on ? SEL : FILL
  return (
    <g role="button" tabIndex={off ? -1 : 0} aria-pressed={on} aria-label={`Tooth ${id}, ${ti.name}`}
      onClick={() => !off && onToggle(id)} onKeyDown={e => { if (!off && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(id) } }}
      style={{ cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.3 : 1, outline: 'none' }}>
      <title>{`#${id} ${ti.name}`}</title>
      <rect x={x - 2} y={Math.min(y, badgeY - 11) - 2} width={w + 4} height={h + 30} fill="transparent" />
      <g transform={`translate(${x},${y}) scale(${s})`}>
        <path d={icon.d} fill={fill} stroke={on ? SEL : STROKE} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
          onMouseEnter={e => { if (!on && !off) e.currentTarget.setAttribute('fill', HOVER) }} onMouseLeave={e => { e.currentTarget.setAttribute('fill', fill) }} />
        {icon.line && <line x1={icon.line[0]} y1={icon.line[1]} x2={icon.line[2]} y2={icon.line[3]} stroke={on ? SEL_DETAIL : DETAIL} strokeWidth="1.2" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        <path d={icon.arc} fill="none" stroke={on ? SEL_DETAIL : DETAIL} strokeWidth="1.2" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      </g>
      <circle cx={x + w / 2} cy={badgeY} r="10" fill={on ? GOLD : BADGE} />
      <text x={x + w / 2} y={badgeY + 4} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="Arial, sans-serif" fill={on ? SEL : '#FFFFFF'} pointerEvents="none">{id}</text>
    </g>
  )
}

function Arch({ ids, upper, y, selected, onToggle, disabled }) {
  const infos = ids.map(id => toothInfo(id))
  const widths = infos.map(ti => iconFor(ti).w * SCALE * (ti.primary ? 1.15 : 1))
  const gap = 4
  const total = widths.reduce((a, b) => a + b, 0) + gap * (ids.length - 1)
  let x = (VB_W - total) / 2
  return ids.map((id, i) => {
    const x0 = x; x += widths[i] + gap
    return <Tooth key={id} id={id} x={x0} y={y} ti={infos[i]} upper={upper} on={selected.includes(id)} off={disabled?.includes(id)} onToggle={onToggle} />
  })
}

export default function ToothChart({ selected = [], onToggle, multi = false, primary = false, disabled = [] }) {
  return (
    <div style={{ width: '100%', maxWidth: 760 }}>
      <svg viewBox={`0 0 ${VB_W} 270`} width="100%" role="group" aria-label={`${primary ? 'Primary' : 'Permanent'} tooth chart${multi ? ', pick one or more' : ''}`} style={{ display: 'block' }}>
        <text x="6" y="138" fontSize="11" fill="#8A92A6" fontFamily="Arial, sans-serif">R</text>
        <text x={VB_W - 14} y="138" fontSize="11" fill="#8A92A6" fontFamily="Arial, sans-serif">L</text>
        <line x1={VB_W / 2} y1="24" x2={VB_W / 2} y2="246" stroke="#E3E7EF" strokeDasharray="3 3" />
        <Arch ids={primary ? PRIM_UPPER : PERM_UPPER} upper y={28} selected={selected} onToggle={onToggle} disabled={disabled} />
        <Arch ids={primary ? PRIM_LOWER : PERM_LOWER} upper={false} y={144} selected={selected} onToggle={onToggle} disabled={disabled} />
      </svg>
    </div>
  )
}
