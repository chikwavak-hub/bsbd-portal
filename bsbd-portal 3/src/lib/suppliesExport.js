// src/lib/suppliesExport.js
// Downloads for supply orders: Excel (.xlsx), OpenDocument (.ods) and PDF.
// Uses SheetJS (`xlsx`) and jsPDF + jspdf-autotable, the same libraries the
// TC report exports use. If either is missing: npm i xlsx jspdf jspdf-autotable

import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { money, monthLabel, STATUS_LABEL } from './suppliesApi'

const HEADERS = ['SKU', 'Qty', 'Description', 'Category', 'Requested for', 'Requested by', 'Unit price', 'Line total', 'Received']

function orderRows(order, lines, itemsById) {
  return lines
    .map(l => ({ l, it: itemsById[l.item_id] || {} }))
    .sort((a, b) => (a.it.category || '').localeCompare(b.it.category || '') || (a.it.description || '').localeCompare(b.it.description || ''))
    .map(({ l, it }) => ({
      sku: it.vendor_item_no || it.mfr_item_no || '',
      qty: l.qty,
      description: it.description || '(item removed from formulary)',
      category: it.category || '',
      requestedFor: l.requested_for || '',
      requestedBy: l.requested_by || '',
      unit: l.unit_price != null ? Number(l.unit_price) : null,
      total: l.qty * (Number(l.unit_price) || 0),
      received: l.received_qty ?? '',
    }))
}

const orderTotal = rows => rows.reduce((s, r) => s + r.total, 0)
const safe = s => String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 28) || 'Order'
const fileStem = (office, vendor, month) => `BSBD_${office}_${safe(vendor?.short_code || vendor?.name || 'Vendor').replace(/\s+/g, '')}_${month.slice(0, 7)}`

// ── Spreadsheet (xlsx / ods) ─────────────────────────────────────────────
function sheetForOrder(order, lines, itemsById, vendor) {
  const rows = orderRows(order, lines, itemsById)
  const aoa = [
    ['Beautiful Smiles by Design — ' + order.office],
    [`${vendor?.name || 'Vendor'} · ${monthLabel(order.order_month)} · ${STATUS_LABEL[order.status] || order.status}${order.vendor_order_no ? ' · #' + order.vendor_order_no : ''}`],
    [],
    HEADERS,
    ...rows.map(r => [r.sku, r.qty, r.description, r.category, r.requestedFor, r.requestedBy, r.unit, r.total, r.received]),
    [],
    ['', '', '', '', '', '', 'Total', orderTotal(rows), ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 46 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 9 }]
  // currency format on unit / total columns
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = 4; R <= range.e.r; R++) {
    for (const C of [6, 7]) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell && typeof cell.v === 'number') cell.z = '$#,##0.00'
    }
  }
  return ws
}

function download(wb, stem, bookType) {
  XLSX.writeFile(wb, `${stem}.${bookType}`, { bookType })
}

/** One order → one sheet. bookType: 'xlsx' | 'ods' */
export function exportOrderSheet(order, lines, itemsById, vendor, bookType = 'xlsx') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheetForOrder(order, lines, itemsById, vendor), safe(vendor?.short_code || vendor?.name))
  download(wb, fileStem(order.office, vendor, order.order_month), bookType)
}

/** Every order for one office in a month → one sheet per vendor plus a summary sheet. */
export function exportMonthSheet(office, month, orders, linesByOrder, itemsById, vendorsById, bookType = 'xlsx') {
  const wb = XLSX.utils.book_new()
  const summary = [['Beautiful Smiles by Design — ' + office], [monthLabel(month) + ' supply orders'], [], ['Vendor', 'Status', 'Lines', 'Total', 'Vendor order #', 'Submitted by', 'Approved by']]
  let grand = 0
  orders.filter(o => o.office === office && o.status !== 'cancelled').forEach(o => {
    const v = vendorsById[o.vendor_id]
    const lines = linesByOrder[o.id] || []
    const rows = orderRows(o, lines, itemsById)
    const t = orderTotal(rows); grand += t
    summary.push([v?.name || 'Vendor', STATUS_LABEL[o.status] || o.status, rows.length, t, o.vendor_order_no || '', o.submitted_by || '', o.approved_by || ''])
    XLSX.utils.book_append_sheet(wb, sheetForOrder(o, lines, itemsById, v), safe(v?.short_code || v?.name))
  })
  summary.push([], ['', '', 'Total', grand])
  const ws = XLSX.utils.aoa_to_sheet(summary)
  ws['!cols'] = [{ wch: 26 }, { wch: 11 }, { wch: 7 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Summary')
  // put Summary first
  wb.SheetNames.unshift(wb.SheetNames.pop())
  download(wb, `BSBD_${office}_${month.slice(0, 7)}_orders`, bookType)
}

// ── PDF ──────────────────────────────────────────────────────────────────
function pdfOrderPage(doc, order, lines, itemsById, vendor, startY = 18) {
  const rows = orderRows(order, lines, itemsById)
  doc.setFontSize(14); doc.setFont(undefined, 'bold')
  doc.text('Beautiful Smiles by Design — ' + order.office, 14, startY)
  doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(90)
  doc.text(`${vendor?.name || 'Vendor'} · ${monthLabel(order.order_month)} · ${STATUS_LABEL[order.status] || order.status}${order.vendor_order_no ? ' · #' + order.vendor_order_no : ''}`, 14, startY + 6)
  doc.setTextColor(0)
  autoTable(doc, {
    startY: startY + 11,
    head: [['SKU', 'Qty', 'Description', 'For', 'Unit', 'Total', "Rec'd"]],
    body: rows.map(r => [r.sku, r.qty, r.description, r.requestedFor, r.unit != null ? money(r.unit) : '', money(r.total), r.received]),
    foot: [['', '', '', '', 'Total', money(orderTotal(rows)), '']],
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [15, 118, 110] },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 12 }, 4: { halign: 'right', cellWidth: 20 }, 5: { halign: 'right', cellWidth: 22 }, 6: { halign: 'right', cellWidth: 14 } },
    margin: { left: 14, right: 14 },
  })
  return doc.lastAutoTable.finalY
}

export function exportOrderPdf(order, lines, itemsById, vendor) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  pdfOrderPage(doc, order, lines, itemsById, vendor)
  doc.save(`${fileStem(order.office, vendor, order.order_month)}.pdf`)
}

export function exportMonthPdf(office, month, orders, linesByOrder, itemsById, vendorsById) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const list = orders.filter(o => o.office === office && o.status !== 'cancelled')
  list.forEach((o, i) => {
    if (i > 0) doc.addPage()
    pdfOrderPage(doc, o, linesByOrder[o.id] || [], itemsById, vendorsById[o.vendor_id])
  })
  if (!list.length) { doc.text(`No ${office} orders for ${monthLabel(month)}.`, 14, 20) }
  doc.save(`BSBD_${office}_${month.slice(0, 7)}_orders.pdf`)
}
