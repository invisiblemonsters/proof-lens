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

export function parseCNF(text) {
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

export function parseDRAT(text) {
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

export function bucketOf(d) {
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

export const BUCKET_ORDER = [
  '0', '1-2', '3-5', '6-10', '11-25', '26-50', '51-100',
  '101-250', '251-500', '501-1000', '1001-5000', '5001+'
]

export function verifyTrace(cnfText, dratText, opts = {}) {
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
