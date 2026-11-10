import fs from 'node:fs'
import { verifyTrace } from '../src/core.js'

const cnf = process.argv[2]
const drat = process.argv[3]
if (!cnf || !drat) {
  console.error('usage: node test/test_core.mjs <file.cnf> <file.drat>')
  process.exit(2)
}
const cnfText = fs.readFileSync(cnf, 'utf8')
const dratText = fs.readFileSync(drat, 'utf8')
const t0 = Date.now()
const r = verifyTrace(cnfText, dratText, { maxAdditions: Number(process.env.CAP || 300000) })
console.log(JSON.stringify({
  valid: r.valid,
  accepted: r.accepted,
  totalSteps: r.totalSteps,
  maxDepth: r.maxDepth,
  emptyDepth: r.emptyDepth,
  failedAt: r.failedAt,
  capped: r.capped,
  elapsedMs: r.elapsedMs,
  wallMs: Date.now() - t0,
  deletions: r.deletions,
  cnf: r.cnf,
  histogram: r.histogram
}, null, 2))
if (!r.valid) process.exit(1)
