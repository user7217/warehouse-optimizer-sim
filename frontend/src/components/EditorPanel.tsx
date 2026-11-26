import { useEffect, useState, type Ref } from 'react'
import { MOD_KEY } from '../keys'
import type { CodeCheck } from '../types'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'

interface Props {
  code: string
  onChange: (code: string) => void
  /** check result for exactly this code, or null when the code changed since */
  check: CodeCheck | null
  /** most recent check, possibly for older code */
  lastCheck: CodeCheck | null
  canCheck: boolean
  checking: boolean
  onCheck: () => void
  canReset: boolean
  onReset: () => void
  onRunTest: () => void
  errorLine: number | null
  editorRef: Ref<CodeEditorHandle>
}

export function EditorPanel({ code, onChange, check, lastCheck, canCheck, checking, onCheck, canReset, onReset, onRunTest, errorLine, editorRef }: Props) {
  const [confirmReset, setConfirmReset] = useState(false)
  useEffect(() => {
    if (!confirmReset) return
    const t = setTimeout(() => setConfirmReset(false), 3000)
    return () => clearTimeout(t)
  }, [confirmReset])

  const shown = check ?? lastCheck
  const stale = !check && !!lastCheck

  return (
    <div className="pane editor-pane">
      <div className="pane-toolbar">
        <div className="provides" title={stale ? 'From the last check; the code has changed since.' : 'Classes your code defines. Missing ones use the built-in baselines.'}>
          {shown ? (
            <>
              <ClassBadge name="Router" custom={shown.provides.router} stale={stale} />
              <ClassBadge name="Assigner" custom={shown.provides.assigner} stale={stale} />
              {!shown.ok && !stale && <span className="badge danger">error</span>}
            </>
          ) : (
            <span className="muted small">Not checked yet</span>
          )}
        </div>
        <div className="toolbar-actions">
          <button className="btn small" disabled={!canCheck || checking} onClick={onCheck} title="Compile and check the interface (no simulation)">
            {checking ? 'Checking…' : 'Check'}
          </button>
          <button
            className={confirmReset ? 'btn small danger' : 'btn small'}
            disabled={!canReset}
            onClick={() => {
              if (confirmReset) {
                onReset()
                setConfirmReset(false)
              } else setConfirmReset(true)
            }}
            title="Replace the editor content with the starter template"
          >
            {confirmReset ? 'Discard edits?' : 'Reset to template'}
          </button>
        </div>
      </div>
      <div className="editor-host">
        <CodeEditor ref={editorRef} value={code} onChange={onChange} onRun={onRunTest} errorLine={errorLine} />
      </div>
      <div className="pane-foot">
        <span>
          <kbd>{MOD_KEY}</kbd>
          <kbd>↵</kbd> run test
        </span>
        <span>
          <kbd>{MOD_KEY}</kbd>
          <kbd>F</kbd> search
        </span>
        <span className="spacer" />
        <span>Not saved: code lives in this tab only</span>
      </div>
    </div>
  )
}

function ClassBadge({ name, custom, stale }: { name: string; custom: boolean; stale: boolean }) {
  return (
    <span className={`class-badge ${custom ? 'custom' : 'baseline'}${stale ? ' stale' : ''}`}>
      <b>{name}</b>
      <span>{custom ? 'yours' : 'baseline'}</span>
    </span>
  )
}
