import { useState } from 'react'
import { fmtInt } from '../format'
import { estimate, FIELDS, GROUPS, viewSupport, VIEW_LIMITS, type Field, type NumberField } from '../scenario'
import type { Presets, Scenario } from '../types'

interface Props {
  presets: Presets
  presetName: string
  presetModified: boolean
  onSelectPreset: (name: string) => void
  scenario: Scenario
  onChange: (s: Scenario) => void
  errors: Record<string, string>
  /** the live session was opened with a different scenario or code */
  stale: boolean
}

export function ScenarioPanel({ presets, presetName, presetModified, onSelectPreset, scenario, onChange, errors, stale }: Props) {
  const est = estimate(scenario)
  const views = viewSupport(est)
  const nErrors = Object.keys(errors).length

  return (
    <div className="pane scroll scenario-pane">
      <div className="field-row preset-row">
        <label className="field-label" htmlFor="preset">
          Preset
        </label>
        <div className="preset-select">
          <select id="preset" className="input" value={presetName} onChange={(e) => onSelectPreset(e.target.value)}>
            {Object.entries(presets.presets).map(([key, p]) => (
              <option key={key} value={key}>
                {p.name}
              </option>
            ))}
          </select>
          {presetModified && (
            <button className="btn small" onClick={() => onSelectPreset(presetName)} title="Discard your changes to this preset">
              Revert
            </button>
          )}
        </div>
      </div>
      {presetModified && <p className="note">Modified from the preset.</p>}

      <div className="derived">
        <Derived label="Slots" value={`≈ ${fmtInt(est.slots)}`} />
        <Derived label="Graph nodes" value={`≈ ${fmtInt(est.nodes)}`} />
        <Derived label="Docks" value={fmtInt(est.docks)} />
        <Derived label="Max robots" value={fmtInt(est.robotsMax)} />
        <Derived label="Items" value={`≈ ${fmtInt(est.items)}`} />
        <Derived label="Robots / aisle" value={(scenario.robots.count / scenario.layout.aisles).toFixed(1)} />
      </div>
      {!views.threeD && (
        <p className="note warn">
          Large layout: the 3D view turns off above {fmtInt(VIEW_LIMITS.threeD.slots)} slots or {fmtInt(VIEW_LIMITS.threeD.nodes)} nodes.
          {!views.graph && ` The graph view also turns off above ${fmtInt(VIEW_LIMITS.graph.nodes)} nodes; metrics still update.`}
        </p>
      )}

      {GROUPS.map((g) => (
        <fieldset key={g} className="field-group">
          <legend>{g}</legend>
          <div className="field-grid">
            {FIELDS.filter((f) => f.group === g && (!f.visible || f.visible(scenario))).map((f) => (
              <FieldInput key={f.id} field={f} scenario={scenario} onChange={onChange} error={errors[f.id]} />
            ))}
          </div>
        </fieldset>
      ))}

      <p className={nErrors ? 'note danger' : stale ? 'note' : 'note muted'}>
        {nErrors
          ? `${nErrors} field${nErrors === 1 ? '' : 's'} out of range. Fix ${nErrors === 1 ? 'it' : 'them'} to run.`
          : stale
            ? 'Changes apply to the next test, or to the live view when you press Reset or Run.'
            : 'Same scenario + same code = same result.'}
      </p>
    </div>
  )
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="derived-item">
      <span className="muted">{label}</span>
      <b className="mono">{value}</b>
    </div>
  )
}

function FieldInput({ field, scenario, onChange, error }: { field: Field; scenario: Scenario; onChange: (s: Scenario) => void; error?: string }) {
  const id = `f-${field.id}`
  let control
  if (field.kind === 'select') {
    control = (
      <select id={id} className="input" value={field.get(scenario)} onChange={(e) => onChange(field.set(scenario, e.target.value))}>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  } else if (field.kind === 'text') {
    control = <input id={id} className="input" value={field.get(scenario)} onChange={(e) => onChange(field.set(scenario, e.target.value))} />
  } else {
    control = <NumberInput id={id} field={field} scenario={scenario} onChange={onChange} invalid={!!error} />
  }
  const range = field.kind === 'int' || field.kind === 'float' ? `${field.min(scenario)} – ${fmtInt(field.max(scenario))}` : null
  return (
    <div className={error ? 'field invalid' : 'field'}>
      <label className="field-label" htmlFor={id} title={field.help}>
        {field.label}
      </label>
      {control}
      <span className={error ? 'field-help danger' : 'field-help'} title={field.help}>
        {error ?? (range ? `${field.help} (${range})` : field.help)}
      </span>
    </div>
  )
}

/** Keeps the typed text so intermediate input ("", "0.") is allowed; invalid text reports NaN. */
function NumberInput({ id, field, scenario, onChange, invalid }: { id: string; field: NumberField; scenario: Scenario; onChange: (s: Scenario) => void; invalid: boolean }) {
  const value = field.get(scenario)
  const [text, setText] = useState(String(value))
  // Follow outside changes (preset switch) without clobbering what the user is typing.
  const [seen, setSeen] = useState(value)
  if (!Object.is(seen, value)) {
    setSeen(value)
    if (!Number.isNaN(value) && Number(text) !== value) setText(String(value))
  }
  return (
    <div className="input-unit">
      <input
        id={id}
        className={invalid ? 'input invalid' : 'input'}
        inputMode={field.kind === 'int' ? 'numeric' : 'decimal'}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = e.target.value.trim() === '' ? NaN : Number(e.target.value)
          onChange(field.set(scenario, v))
        }}
        onBlur={() => {
          if (Number.isFinite(value)) setText(String(value))
        }}
      />
      {field.unit && <span className="unit">{field.unit}</span>}
    </div>
  )
}
