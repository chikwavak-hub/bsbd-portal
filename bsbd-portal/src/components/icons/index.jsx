const Ico = ({ d, size = 16, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
)

export const IcoLogIn    = p => <Ico {...p} d={["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4","M10 17l5-5-5-5","M15 12H3"]} />
export const IcoLogOut   = p => <Ico {...p} d={["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4","M16 17l5-5-5-5","M21 12H9"]} />
export const IcoPlus     = p => <Ico {...p} d="M12 5v14M5 12h14" />
export const IcoTrash    = p => <Ico {...p} d={["M3 6h18","M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6","M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]} />
export const IcoChevD    = p => <Ico {...p} d="M6 9l6 6 6-6" />
export const IcoChevU    = p => <Ico {...p} d="M18 15l-6-6-6 6" />
export const IcoChevR    = p => <Ico {...p} d="M9 18l6-6-6-6" />
export const IcoDL       = p => <Ico {...p} d={["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","M7 10l5 5 5-5","M12 15V3"]} />
export const IcoMail     = p => <Ico {...p} d={["M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z","M22 6l-10 7L2 6"]} />
export const IcoTooth    = p => <Ico {...p} d="M12 2a5 5 0 0 1 5 5c0 1.5-.5 3-1 4l-1 5a1 1 0 0 1-2 0l-.5-3h-1l-.5 3a1 1 0 0 1-2 0l-1-5c-.5-1-1-2.5-1-4a5 5 0 0 1 5-5z" />
export const IcoDash     = p => <Ico {...p} d={["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z","M9 22V12h6v10"]} />
export const IcoGear     = p => <Ico {...p} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
export const IcoClip     = p => <Ico {...p} d={["M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2","M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"]} />
export const IcoAlert    = p => <Ico {...p} d={["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z","M12 9v4","M12 17h.01"]} />
export const IcoEye      = p => <Ico {...p} d={["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z","M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"]} />
export const IcoEdit     = p => <Ico {...p} d={["M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7","M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"]} />
export const IcoX        = p => <Ico {...p} d="M18 6L6 18M6 6l12 12" />
export const IcoCloud    = p => <Ico {...p} d={["M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"]} />
export const IcoCheck    = p => <Ico {...p} d="M20 6L9 17l-5-5" />
export const IcoSave     = p => <Ico {...p} d={["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z","M17 21v-8H7v8","M7 3v5h8"]} />
export const IcoBar      = p => <Ico {...p} d={["M18 20V10","M12 20V4","M6 20v-6"]} />
export const IcoPrint    = p => <Ico {...p} d={["M6 9V2h12v7","M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2","M6 14h12v8H6z"]} />
export const IcoCalendar = p => <Ico {...p} d={["M8 2v4","M16 2v4","M3 10h18","M21 8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z"]} />
export const IcoUndo     = p => <Ico {...p} d={["M3 7v6h6","M3 13C5 7 10 4 15 4a9 9 0 0 1 9 9 9 9 0 0 1-9 9c-4 0-7.5-2-9-5"]} />
export const IcoSun      = p => <Ico {...p} d={["M12 2v2","M12 20v2","M4.22 4.22l1.42 1.42","M18.36 18.36l1.42 1.42","M2 12h2","M20 12h2","M4.22 19.78l1.42-1.42","M18.36 5.64l1.42-1.42","M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z"]} />
export const IcoStar     = p => <Ico {...p} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
export const IcoBell     = p => <Ico {...p} d={["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9","M13.73 21a2 2 0 0 1-3.46 0"]} />
export const IcoPhone    = p => <Ico {...p} d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 6.18a2 2 0 0 1 1.99-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L10.09 12a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
export const IcoClock    = p => <Ico {...p} d={["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z","M12 6v6l4 2"]} />
export const IcoUsers    = p => <Ico {...p} d={["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2","M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z","M23 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75"]} />
export const IcoUpload   = p => <Ico {...p} d={["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","M17 8l-5-5-5 5","M12 3v12"]} />
export const IcoRefresh  = p => <Ico {...p} d={["M23 4v6h-6","M1 20v-6h6","M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"]} />
export const IcoChevSort = p => <Ico {...p} d={["M7 15l5 5 5-5","M7 9l5-5 5 5"]} />
