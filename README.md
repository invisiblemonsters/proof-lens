# Proof Lens

A Hermes Desktop pane that verifies a DRAT refutation and shows its shape.

Pick a CNF and a DRAT trace. Proof Lens re-derives every accepted line by unit
propagation against the original formula plus the clauses accepted so far. If a
line is not RUP, it stops and names the line. If the whole trace checks out, it
reports the empty clause's depth and a histogram of derived clauses by depth.

This answers a different question from a solver: not "is it UNSAT?" — the
certificate answers that — but "how deep is the refutation?" A proof can be
short and deep, or long and shallow. Depth is the height of the implication
DAG, and it is the quantity that matters when you care about the coNP side of a
hardness argument rather than the SAT side.

## Use

1. Install the plugin (or drop `desktop/plugin.js` into
   `$HERMES_HOME/desktop-plugins/proof-lens/`).
2. Reload desktop plugins from the command palette.
3. Open the **proof lens** pane and pick a `.cnf` and a `.drat`.

The check runs locally in the renderer. A 2,446-line trace over a 42-variable
formula takes about two seconds.

## What the numbers mean

- **depth** — the accepted empty clause's gate-height. Original clauses are
  leaves at 0; every propagation step or closing conflict adds 1.
- **additions** — trace lines accepted as RUP.
- **steps** — lines in the trace (comments excluded; `d` deletion lines are
  counted and ignored).
- **derived clauses by depth** — how the proof's work is distributed. A healthy
  CDCL refutation is bottom-heavy: most learned clauses are shallow, and a thin
  spine reaches the empty clause.

Deletions are ignored rather than replayed. That is sound: accepting a clause
against a superset of the solver's database only makes the checker more
permissive than a deletion-aware one, never less. It can accept a trace a
stricter checker would reject, so treat VALID as "RUP-valid without deletions",
not as a bit-exact replay.

RUP only. RAT steps (which appear when a solver introduces extension variables)
are rejected by design; check those with a RAT-capable checker such as
drat-trim.

## Limits

- Renderer-side, single-threaded. The default cap is 300,000 accepted
  additions; beyond that the result is marked capped.
- Memory grows with the clause database. Huge traces (millions of additions)
  belong in a native checker, not a UI pane.
- Deletion lines are ignored, as above.
- No RAT.

## Disclosure

Reads only the two files you select in the browser file dialog. No network
requests, no shell commands, no writes outside the plugin's own storage (which
this version does not use). The CNF and trace never leave the machine.

## Development

```
node tools/build.mjs        # inline src/core.js into desktop/plugin.js
node test/test_core.mjs <file.cnf> <file.drat>
```

`src/core.js` is the checker; `src/plugin.template2.js` is the UI. The build is
a concatenation so the shipped `desktop/plugin.js` stays a single loadable ESM
file with no bundler.

## License

MIT
