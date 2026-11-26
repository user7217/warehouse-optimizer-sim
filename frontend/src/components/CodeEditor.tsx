import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  MatchDecorator,
  rectangularSelection,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

export interface CodeEditorHandle {
  /** scroll to a 1-based line, put the cursor there, and focus */
  jumpTo: (line: number) => void
}

interface Props {
  value: string
  onChange: (code: string) => void
  /** Cmd/Ctrl+Enter */
  onRun: () => void
  /** 1-based line to mark as the error location, or null */
  errorLine: number | null
  ref?: Ref<CodeEditorHandle>
}

// ------------------------------------------------------------ error line --

const setErrorLine = StateEffect.define<number | null>()
const errorLineDeco = Decoration.line({ class: 'cm-error-line' })

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue
      const line = e.value
      deco = line !== null && line >= 1 && line <= tr.state.doc.lines ? Decoration.set([errorLineDeco.range(tr.state.doc.line(line).from)]) : Decoration.none
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ----------------------------------------------------------------- theme --

// Colours from VS Code's built-in "Dark 2026" theme (2026-dark.json): workbench colours for the
// chrome, its tokenColors for syntax.
const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: '#BBBEBF', fontSize: '12.5px' },
    '.cm-scroller': { fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace", lineHeight: '1.6' },
    '.cm-content': { caretColor: '#BBBEBF', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#BBBEBF', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(39, 103, 130, 0.87) !important' },
    '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: '#858889', border: 'none' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 14px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.045)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#BBBEBF' },
    '.cm-foldGutter .cm-gutterElement': { color: '#858889', cursor: 'pointer' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(57, 148, 188, 0.33)', outline: '1px solid rgba(57, 148, 188, 0.6)', color: 'inherit' },
    '.cm-nonmatchingBracket': { backgroundColor: 'rgba(244, 135, 113, 0.25)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(57, 148, 188, 0.18)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(39, 103, 130, 0.5)', outline: '1px solid rgba(57, 148, 188, 0.6)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(39, 103, 130, 0.87)' },
    '.cm-error-line': { backgroundColor: 'rgba(244, 135, 113, 0.14)', boxShadow: 'inset 3px 0 0 var(--danger)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-panel.cm-search': { padding: '6px 8px', fontSize: '12px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '12px' },
    '.cm-textfield': { backgroundColor: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: '4px', color: 'var(--text)', padding: '3px 6px' },
    '.cm-textfield:focus': { borderColor: 'var(--accent)', outline: 'none' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: '4px', color: 'var(--text)' },
    '.cm-tooltip': { backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '6px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
    '.cm-py-self, .cm-py-self span': { color: '#79c0ff' }, // variable.language
  },
  { dark: true },
)

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: '#569cd6' }, // keyword, storage
  { tag: [t.self, t.bool, t.null, t.atom, t.number], color: '#79c0ff' },                                            // constant, variable.language
  { tag: [t.standard(t.variableName), t.standard(t.function(t.variableName))], color: '#79c0ff' },                 // support (builtins)
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a5d6ff' },                                            // string
  { tag: [t.escape], color: '#7ee787' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#8b949e' },                            // comment
  { tag: [t.definition(t.function(t.variableName)), t.function(t.definition(t.variableName))], color: '#d2a8ff' }, // entity.name.function
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#d2a8ff' },
  { tag: [t.definition(t.className), t.className, t.typeName], color: '#ffa657' },                                // entity.name
  { tag: [t.variableName, t.propertyName, t.definition(t.variableName)], color: '#c9d1d9' },                       // variable.other
  { tag: [t.meta, t.annotation], color: '#d2a8ff' },                                                               // decorators
  { tag: [t.bracket], color: '#8b949e' },
  { tag: [t.operator, t.punctuation], color: '#BBBEBF' },
  { tag: t.invalid, color: '#ffa198' },
])

/**
 * The Python parser tags `self`/`cls` as ordinary variables; VS Code's grammar marks them
 * variable.language, which Dark 2026 colours #79c0ff. Decorate them to match.
 */
const selfMatcher = new MatchDecorator({ regexp: /\b(?:self|cls)\b/g, decoration: Decoration.mark({ class: 'cm-py-self' }) })
const selfHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = selfMatcher.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = selfMatcher.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)

function baseExtensions(onChange: () => void, onRun: () => void): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ activateOnTyping: true }),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    python(),
    syntaxHighlighting(highlight),
    selfHighlight,
    theme,
    errorLineField,
    Prec.highest(keymap.of([{ key: 'Mod-Enter', preventDefault: true, run: () => (onRun(), true) }])),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange()
    }),
  ]
}

/** CodeMirror 6 Python editor. Content lives in React state only (nothing is persisted). */
export function CodeEditor({ value, onChange, onRun, errorLine, ref }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Callbacks change every render; the editor reads the latest through refs.
  const cb = useRef({ onChange, onRun })
  useEffect(() => {
    cb.current = { onChange, onRun }
  })

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: baseExtensions(
          () => cb.current.onChange(v.state.doc.toString()),
          () => cb.current.onRun(),
        ),
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // The initial doc only; later changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External replacements (template reset). Typing round-trips through onChange, so this is a no-op then.
  useEffect(() => {
    const v = view.current
    if (!v || v.state.doc.toString() === value) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, effects: setErrorLine.of(null) })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorLine) })
  }, [errorLine])

  useImperativeHandle(ref, () => ({
    jumpTo(line: number) {
      const v = view.current
      if (!v) return
      const ln = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines))
      v.dispatch({ selection: { anchor: ln.from }, effects: [EditorView.scrollIntoView(ln.from, { y: 'center' }), setErrorLine.of(line)] })
      v.focus()
    },
  }))

  return <div ref={host} className="code-editor" />
}
