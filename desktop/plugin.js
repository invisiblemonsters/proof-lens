import { useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'proof-lens'

// Proof Lens core — CNF/DRAT parsing and RUP verification with proof-depth
// accounting. Pure JS: no DOM, no imports. Shared by desktop/plugin.js and the
// Node test harness.
//
// A trace clause C is accepted iff F' ∧ ¬C unit-propagates to conflict, where
// F' is the original CNF plus every previously accepted trace clause. Deletion
// lines are ignored: accepting against a superset is sound (and only more
// permissive than a deletion-aware checker).
//
// Depth convention: original clauses are axioms at depth 0. A derived clause
// gets 1 + max(depth of the clauses its RUP derivation used).

function parseCNF(text) {
  const clauses = []
  let nv = 0
  let cur = []
  for (const raw of String(text).split(/\r?\n/)) {
    const s = raw.trim()
    if (!s || s[0] === 'c' || s[0] === '%') continue
    if (s[0] === 'p') {
      const p = s.split(/\s+/)
      nv = parseInt(p[2], 10) || 0
      continue
    }
    for (const tok of s.split(/\s+/)) {
      const l = parseInt(tok, 10)
      if (!Number.isFinite(l)) continue
      if (l === 0) {
        clauses.push(cur)
        cur = []
      } else {
        cur.push(l)
      }
    }
  }
  if (cur.length) clauses.push(cur)
  return { nv, clauses }
}

function parseDRAT(text) {
  const steps = []
  let deletions = 0
  let comments = 0
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim()
    if (!s) continue
    if (s[0] === 'c') {
      comments++
      continue
    }
    if (s[0] === 'd' || s[0] === 'D') {
      deletions++
      continue
    }
    const cur = []
    let terminated = false
    for (const tok of s.split(/\s+/)) {
      const l = parseInt(tok, 10)
      if (!Number.isFinite(l)) continue
      if (l === 0) {
        terminated = true
        break
      }
      cur.push(l)
    }
    // A final unterminated line is a truncated write, not a clause.
    if (!terminated && i === lines.length - 1) break
    steps.push(cur)
  }
  return { steps, deletions, comments }
}

function normalize(clause) {
  const seen = new Set()
  const out = []
  for (const l of clause) {
    if (seen.has(l)) continue
    if (seen.has(-l)) return null // tautology
    seen.add(l)
    out.push(l)
  }
  return out
}

function bucketOf(d) {
  if (d <= 0) return '0'
  if (d <= 2) return '1-2'
  if (d <= 5) return '3-5'
  if (d <= 10) return '6-10'
  if (d <= 25) return '11-25'
  if (d <= 50) return '26-50'
  if (d <= 100) return '51-100'
  if (d <= 250) return '101-250'
  if (d <= 500) return '251-500'
  if (d <= 1000) return '501-1000'
  if (d <= 5000) return '1001-5000'
  return '5001+'
}

const BUCKET_ORDER = [
  '0', '1-2', '3-5', '6-10', '11-25', '26-50', '51-100',
  '101-250', '251-500', '501-1000', '1001-5000', '5001+'
]

function verifyTrace(cnfText, dratText, opts = {}) {
  const t0 = Date.now()
  const { nv, clauses } = parseCNF(cnfText)
  const trace = parseDRAT(dratText)
  const cap = opts.maxAdditions ?? 300000

  const db = clauses.map(c => c.slice())
  const depth = db.map(() => 0)
  const occ = new Map()
  const addOcc = i => {
    for (const l of db[i]) {
      let a = occ.get(l)
      if (!a) {
        a = []
        occ.set(l, a)
      }
      a.push(i)
    }
  }
  for (let i = 0; i < db.length; i++) addOcc(i)
  const units = []
  for (let i = 0; i < db.length; i++) if (db[i].length === 1) units.push(i)
  let emptyDepth = null
  for (let i = 0; i < db.length; i++) {
    if (db[i].length === 0) {
      emptyDepth = 0
      break
    }
  }

  // RUP: F ∧ ¬C must unit-propagate to conflict. Returns the conflict's
  // antecedent depth, or null when the candidate is not RUP.
  const checkRUP = candidate => {
    const assign = new Map()
    const why = new Map()
    let conflict = null
    const seed = (lit, d) => {
      const v = Math.abs(lit)
      const val = lit > 0 ? 1 : -1
      const cur = assign.get(v)
      if (cur === undefined) {
        assign.set(v, val)
        why.set(v, d)
        return 1
      }
      if (cur === val) {
        if (d > (why.get(v) || 0)) why.set(v, d)
        return 0
      }
      conflict = Math.max(conflict || 0, d, why.get(v) || 0)
      return -1
    }
    const q = []
    for (const l of candidate) {
      const a = -l
      const r = seed(a, 0)
      if (r < 0) return conflict
      if (r > 0) q.push(a)
    }
    if (emptyDepth !== null) return Math.max(conflict || 0, emptyDepth)
    for (const ci of units) {
      const r = seed(db[ci][0], depth[ci])
      if (r < 0) return conflict
      if (r > 0) q.push(db[ci][0])
    }
    while (q.length) {
      const lit = q.pop()
      const list = occ.get(-lit)
      if (!list) continue
      for (let k = 0; k < list.length; k++) {
        const ci = list[k]
        const cl = db[ci]
        let sat = false
        let nUn = 0
        let last = 0
        let maxWhy = 0
        for (let j = 0; j < cl.length; j++) {
          const l = cl[j]
          const v = Math.abs(l)
          const a = assign.get(v)
          if (a === undefined) {
            nUn++
            last = l
            if (nUn >= 2) break
          } else if (a === (l > 0 ? 1 : -1)) {
            sat = true
            break
          } else {
            const w = why.get(v) || 0
            if (w > maxWhy) maxWhy = w
          }
        }
        if (sat || nUn >= 2) continue
        if (nUn === 0) return 1 + Math.max(maxWhy, depth[ci], conflict || 0)
        const d = 1 + Math.max(maxWhy, depth[ci])
        const r = seed(last, d)
        if (r < 0) return conflict
        if (r > 0) q.push(last)
      }
    }
    return conflict
  }

  let accepted = 0
  let maxDepth = 0
  let valid = true
  let failedAt = null
  let capped = false
  let failedClause = null
  const hist = new Map()

  for (let si = 0; si < trace.steps.length; si++) {
    if (accepted >= cap) {
      capped = true
      break
    }
    const raw = trace.steps[si]
    const norm = normalize(raw)
    let d
    if (norm === null) {
      d = 1
    } else {
      const cd = checkRUP(norm)
      if (cd === null) {
        valid = false
        failedAt = si + 1
        failedClause = norm
        break
      }
      d = cd
    }
    const i = db.length
    db.push(norm === null ? raw.slice() : norm)
    depth.push(d)
    addOcc(i)
    if (db[i].length === 1) units.push(i)
    if (db[i].length === 0) emptyDepth = d
    accepted++
    if (d > maxDepth) maxDepth = d
    const b = bucketOf(d)
    hist.set(b, (hist.get(b) || 0) + 1)
  }

  const histogram = BUCKET_ORDER.filter(b => hist.has(b)).map(b => ({ bucket: b, count: hist.get(b) }))
  const hasEmpty = emptyDepth !== null

  return {
    valid: valid && accepted > 0 && hasEmpty,
    accepted,
    totalSteps: trace.steps.length,
    maxDepth,
    emptyDepth,
    histogram,
    elapsedMs: Date.now() - t0,
    failedAt,
    failedClause,
    capped,
    deletions: trace.deletions,
    comments: trace.comments,
    cnf: { vars: nv, clauses: clauses.length },
    derivedWithEmpty: emptyDepth
  }
}

const BTN =
  'inline-flex h-7 shrink-0 items-center rounded-md border border-(--ui-stroke-secondary) px-2 text-xs ' +
  'text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground ' +
  'disabled:cursor-not-allowed disabled:opacity-40'
const LABEL = 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)'

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n)
}

function FilePick({ name, hint, file, onPick, disabled }) {
  const ref = useRef(null)
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('div', { className: LABEL, children: name }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('button', {
            type: 'button',
            className: BTN,
            disabled,
            onClick: () => ref.current && ref.current.click(),
            children: file ? 'Replace' : 'Choose file'
          }),
          jsx('div', {
            className:
              'truncate text-xs ' +
              (file ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'),
            children: file ? file.name + '  ·  ' + fmt(file.size) + ' B' : hint
          })
        ]
      }),
      jsx('input', {
        ref,
        type: 'file',
        className: 'hidden',
        onChange: async e => {
          const f = e.target.files && e.target.files[0]
          if (!f) return
          onPick({ name: f.name, size: f.size, text: await f.text() })
          e.target.value = ''
        }
      })
    ]
  })
}

function Bar({ bucket, count, max }) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0
  return jsxs('div', {
    className: 'flex items-center gap-2',
    children: [
      jsx('div', {
        className: 'w-20 shrink-0 text-right text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)',
        children: bucket
      }),
      jsx('div', {
        className: 'h-2 flex-1 overflow-hidden rounded-sm bg-(--ui-stroke-secondary)',
        children: jsx('div', {
          className: 'h-full rounded-sm bg-(--ui-accent)',
          style: { width: pct + '%' }
        })
      }),
      jsx('div', {
        className: 'w-14 shrink-0 text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)',
        children: fmt(count)
      })
    ]
  })
}

function Result({ r }) {
  const max = r.histogram.reduce((m, h) => Math.max(m, h.count), 0)
  return jsxs('div', {
    className: 'flex flex-col gap-3 rounded-md border border-(--ui-stroke-secondary) p-3',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between gap-2',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', {
                className:
                  'rounded-sm border px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wide ' +
                  (r.valid
                    ? 'border-(--ui-accent) text-(--ui-accent)'
                    : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'),
                children: r.valid ? 'VALID' : 'INVALID'
              }),
              jsx('span', {
                className: 'text-xs text-(--ui-text-tertiary)',
                children: r.valid
                  ? 'every line is RUP'
                  : r.failedAt
                    ? 'failed at line ' + fmt(r.failedAt)
                    : 'no empty clause derived'
              })
            ]
          }),
          jsx('span', {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: fmt(r.elapsedMs) + ' ms'
          })
        ]
      }),
      jsxs('div', {
        className: 'grid grid-cols-3 gap-2',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: LABEL, children: 'depth' }),
              jsx('div', {
                className: 'text-2xl font-semibold tabular-nums',
                children: fmt(r.emptyDepth == null ? r.maxDepth : r.emptyDepth)
              })
            ]
          }),
          jsxs('div', {
            children: [
              jsx('div', { className: LABEL, children: 'additions' }),
              jsx('div', { className: 'text-2xl font-semibold tabular-nums', children: fmt(r.accepted) })
            ]
          }),
          jsxs('div', {
            children: [
              jsx('div', { className: LABEL, children: 'steps' }),
              jsx('div', { className: 'text-2xl font-semibold tabular-nums', children: fmt(r.totalSteps) })
            ]
          })
        ]
      }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children:
          'CNF ' + fmt(r.cnf.vars) + ' vars / ' + fmt(r.cnf.clauses) + ' clauses' +
          (r.deletions ? ' · ' + fmt(r.deletions) + ' deletion lines ignored' : '') +
          (r.capped ? ' · capped at ' + fmt(r.accepted) + ' additions' : '')
      }),
      max > 0
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsx('div', { className: LABEL, children: 'derived clauses by depth' }),
              ...r.histogram.map(h => jsx(Bar, { bucket: h.bucket, count: h.count, max }))
            ]
          })
        : null
    ]
  })
}

function Pane() {
  const [cnf, setCnf] = useState(null)
  const [drat, setDrat] = useState(null)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!cnf || !drat || busy) return
    setErr(null)
    setRes(null)
    setBusy(true)
    await new Promise(r => setTimeout(r, 40))
    try {
      setRes(verifyTrace(cnf.text, drat.text))
    } catch (e) {
      setErr(String((e && e.message) || e))
    } finally {
      setBusy(false)
    }
  }

  return jsxs('div', {
    className: 'flex h-full flex-col gap-3 overflow-auto p-3 text-sm',
    children: [
      jsxs('div', {
        children: [
          jsx('div', { className: 'font-medium', children: 'Proof Lens' }),
          jsx('div', {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: 'Verify a DRAT refutation and profile its depth.'
          })
        ]
      }),
      jsx(FilePick, { name: 'CNF', hint: 'the formula', file: cnf, onPick: setCnf, disabled: busy }),
      jsx(FilePick, { name: 'DRAT', hint: 'the refutation trace', file: drat, onPick: setDrat, disabled: busy }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('button', {
            type: 'button',
            className: BTN,
            disabled: !cnf || !drat || busy,
            onClick: run,
            children: busy ? 'Checking…' : 'Verify proof'
          }),
          jsx('span', {
            className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
            children: 'RUP only · runs locally'
          })
        ]
      }),
      err
        ? jsxs('div', {
            className: 'rounded-md border border-(--ui-stroke-secondary) p-3 text-xs',
            children: [
              jsx('div', { className: 'font-medium', children: 'Check failed' }),
              jsx('div', { className: 'mt-1 text-(--ui-text-tertiary)', children: err })
            ]
          })
        : null,
      res ? jsx(Result, { r: res }) : null,
      !res && !err && !busy
        ? jsxs('div', {
            className: 'rounded-md border border-dashed border-(--ui-stroke-secondary) p-3 text-xs text-(--ui-text-quaternary)',
            children: [
              jsx('div', { className: 'font-medium text-(--ui-text-secondary)', children: 'Point it at a proof' }),
              jsx('div', {
                className: 'mt-1 leading-relaxed',
                children:
                  'Pick a CNF and a DRAT trace. Every accepted line is re-derived by unit propagation; deletion lines are ignored (sound, and strictly more permissive than a deletion-aware checker).'
              })
            ]
          })
        : null,
      jsx('div', { className: 'h-px w-full bg-(--ui-stroke-secondary)' }),
      jsx('div', {
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
        children:
          'Depth is the gate-height of the implication DAG: original clauses are leaves at 0, and every propagation or closing conflict adds 1. The empty clause carries the refutation depth.'
      })
    ]
  })
}

export default {
  id: ID,
  name: 'Proof Lens',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'proof lens',
      data: { placement: 'right', width: '400px' },
      render: () => jsx(Pane, {})
    })
  }
}
