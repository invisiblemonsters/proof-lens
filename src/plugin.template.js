import { Badge, Button, EmptyState, ErrorState, GlyphSpinner, Separator, cn, haptic } from '@hermes/plugin-sdk'
import { useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'proof-lens'

/*__CORE__*/

function fmt(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n)
}

function FilePick({ label, hint, file, onPick, disabled }) {
  const ref = useRef(null)
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('div', { className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: label }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx(Button, {
            size: 'sm',
            variant: 'secondary',
            disabled,
            onClick: () => ref.current && ref.current.click(),
            children: file ? 'Replace' : 'Choose file'
          }),
          jsx('div', {
            className: cn('truncate text-xs', file ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'),
            children: file ? file.name : hint
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
          haptic('tap')
          onPick({ name: f.name, size: f.size, text: await f.text() })
          e.target.value = ''
        }
      })
    ]
  })
}

function Bar({ label, count, max }) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0
  return jsxs('div', {
    className: 'flex items-center gap-2',
    children: [
      jsx('div', { className: 'w-20 shrink-0 text-right text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)', children: label }),
      jsx('div', {
        className: 'h-2 flex-1 overflow-hidden rounded-sm bg-(--ui-stroke-secondary)',
        children: jsx('div', {
          className: 'h-full rounded-sm bg-(--ui-accent)',
          style: { width: pct + '%' }
        })
      }),
      jsx('div', { className: 'w-14 shrink-0 text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)', children: fmt(count) })
    ]
  })
}

function Result({ r }) {
  if (!r) return null
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
              jsx(Badge, {
                tone: r.valid ? 'success' : 'danger',
                children: r.valid ? 'CERTIFICATE VALID' : 'INVALID'
              }),
              jsx('span', {
                className: 'text-xs text-(--ui-text-tertiary)',
                children: r.valid ? 'every line is RUP' : 'failed at line ' + fmt(r.failedAt)
              })
            ]
          }),
          jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: fmt(r.elapsedMs) + ' ms' })
        ]
      }),
      jsxs('div', {
        className: 'grid grid-cols-3 gap-2',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'depth' }),
              jsx('div', { className: 'text-2xl font-semibold tabular-nums', children: fmt(r.emptyDepth ?? r.maxDepth) })
            ]
          }),
          jsxs('div', {
            children: [
              jsx('div', { className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'additions' }),
              jsx('div', { className: 'text-2xl font-semibold tabular-nums', children: fmt(r.accepted) })
            ]
          }),
          jsxs('div', {
            children: [
              jsx('div', { className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'steps' }),
              jsx('div', { className: 'text-2xl font-semibold tabular-nums', children: fmt(r.totalSteps) })
            ]
          })
        ]
      }),
      jsx('div', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: 'CNF ' + fmt(r.cnf.vars) + ' vars / ' + fmt(r.cnf.clauses) + ' clauses'
          + (r.deletions ? ' · ' + fmt(r.deletions) + ' deletion lines ignored' : '')
          + (r.capped ? ' · capped at ' + fmt(r.accepted) + ' additions' : '')
      }),
      max > 0
        ? jsxs('div', {
            className: 'flex flex-col gap-1',
            children: [
              jsx('div', { className: 'text-[0.6875rem] uppercase tracking-wide text-(--ui-text-quaternary)', children: 'derived clauses by depth' }),
              ...r.histogram.map(h => jsx(Bar, { label: h.bucket, count: h.count, max }))
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
    if (!cnf || !drat) return
    haptic('tap')
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
        className: 'flex items-start justify-between gap-2',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'font-medium', children: 'Proof Lens' }),
              jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: 'Verify a DRAT refutation and profile its depth.' })
            ]
          }),
          busy ? jsx(GlyphSpinner, {}) : null
        ]
      }),
      jsx(FilePick, { label: 'CNF', hint: 'the formula', file: cnf, onPick: setCnf, disabled: busy }),
      jsx(FilePick, { label: 'DRAT', hint: 'the refutation trace', file: drat, onPick: setDrat, disabled: busy }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx(Button, {
            size: 'sm',
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
      err ? jsx(ErrorState, { title: 'Check failed', description: err }) : null,
      res ? jsx(Result, { r: res }) : null,
      !res && !err && !busy
        ? jsx(EmptyState, {
            title: 'Point it at a proof',
            description: 'Pick a CNF and a DRAT trace. Every accepted line is re-derived by unit propagation; deletions are ignored (sound, and strictly more permissive).'
          })
        : null,
      jsx(Separator, {}),
      jsx('div', {
        className: 'text-[0.6875rem] leading-relaxed text-(--ui-text-quaternary)',
        children: 'Depth is the gate-height of the implication DAG: original clauses are leaves at 0, and every propagation or closing conflict adds 1. The empty clause carries the refutation depth.'
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
