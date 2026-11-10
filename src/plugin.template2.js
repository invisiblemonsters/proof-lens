import { useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'proof-lens'

/*__CORE__*/

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
