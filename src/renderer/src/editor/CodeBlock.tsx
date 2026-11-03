import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type { BlockNoteEditor } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { useStore } from '../store';
import { useLocked } from '../claude/store';
import { useNotebookId } from './NotebookContext';
import { languageChoices } from './codeLanguages';
import { CODE_EDITOR_ATTR, leaveCode, registerCode } from './codeFocus';
import { loadCodeEditor, loadedCodeEditor, type CodeEditorApi } from './codeLoader';
import type { CodeEditorHandle, CodeFont } from './codeEditor';

/*
  A code block: its code in Monaco, coloured in the app's tokens, with a language picker in its corner.
  The code is the block's `code` prop, not text in the page, so the page file keeps it as it is:
  { "type": "code", "language": "…", "code": "…" }.
*/

type AnyEditor = BlockNoteEditor<any, any, any>;

/** Room above the first line and below the last, as the code block had before. */
const PADDING = 14;

/** Where Monaco's line numbers end and the code starts, from the last editor shown: the plain text lines up with it. */
const gutter = { numbers: 26, code: 52 };

/** The font the block's CSS gives its code, as Monaco takes it. */
function fontOf(el: HTMLElement): CodeFont {
  const style = getComputedStyle(el);
  const size = parseFloat(style.fontSize) || 14;
  const lineHeight = parseFloat(style.lineHeight);
  return { family: style.fontFamily, size, lineHeight: Number.isFinite(lineHeight) ? lineHeight : Math.round(size * 1.55) };
}

/** Until Monaco is loaded, the code as plain text, laid out as Monaco will lay it out, so nothing moves when it comes. */
function PlainCode({ code }: { code: string }) {
  const lines = code.split(/\r\n|\r|\n/);
  const style = { '--code-numbers': `${gutter.numbers}px`, '--code-start': `${gutter.code}px`, paddingBlock: PADDING } as CSSProperties;
  return (
    <pre className="code-plain" style={style} aria-hidden="true">
      {lines.map((line, i) => (
        <span key={i} className="code-plain-line">
          <span className="code-plain-number">{i + 1}</span>
          {line}
        </span>
      ))}
    </pre>
  );
}

function CodeBlockView({ blockId, code, language, editor }: { blockId: string; code: string; language: string; editor: AnyEditor }) {
  const locked = useLocked(useNotebookId());
  const theme = useStore((s) => s.theme);
  const appearance = useStore((s) => s.appearance);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<CodeEditorApi | null>(null);
  const handleRef = useRef<CodeEditorHandle | null>(null);
  const [ready, setReady] = useState(false);

  // What the editor starts with, when Monaco comes: the block as it is then.
  const latest = useRef({ code, language, locked });
  useLayoutEffect(() => {
    latest.current = { code, language, locked };
  });

  useEffect(() => {
    let gone = false;
    let unregister = () => {};
    const start = (api: CodeEditorApi) => {
      const host = hostRef.current;
      if (gone || !host) return;
      apiRef.current = api;
      api.applyCodeTheme(useStore.getState().theme === 'dark');
      const now = latest.current;
      const current = editor.getBlock(blockId)?.props.code;
      const handle = api.createCodeEditor(host, {
        code: typeof current === 'string' ? current : now.code,
        language: now.language,
        readOnly: now.locked,
        font: fontOf(host),
        padding: PADDING,
        // Typing saves through the page, as any edit does.
        onChange: (next) => {
          if (editor.getBlock(blockId)) editor.updateBlock(blockId, { props: { code: next } });
        },
        onExit: (how) => leaveCode(editor, blockId, how),
      });
      handleRef.current = handle;
      // Monaco draws its lines on the next frame: the plain text gives way to them in that same frame.
      requestAnimationFrame(() => {
        if (gone) return;
        Object.assign(gutter, handle.gutter());
        flushSync(() => setReady(true));
        unregister = registerCode(editor, blockId, (at) => handle.focus(at));
      });
    };
    const loaded = loadedCodeEditor();
    if (loaded) start(loaded);
    else loadCodeEditor().then(start, (error: unknown) => console.error('The code editor could not be loaded.', error));
    return () => {
      gone = true;
      unregister();
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [editor, blockId]);

  // Code from outside the editor, like an undo in the page. Its own typing is in the page already, so it's left be.
  useEffect(() => {
    const current = editor.getBlock(blockId)?.props.code;
    if (typeof current === 'string') handleRef.current?.setValue(current);
  }, [editor, blockId, code, ready]);

  useEffect(() => {
    handleRef.current?.setLanguage(language);
  }, [language, ready]);

  // While Claude works on the page, its code can be read and copied, not changed.
  useEffect(() => {
    handleRef.current?.setReadOnly(locked);
  }, [locked, ready]);

  useEffect(() => {
    if (ready) apiRef.current?.applyCodeTheme(theme === 'dark');
  }, [theme, ready]);

  useEffect(() => {
    const host = hostRef.current;
    if (host) handleRef.current?.setFont(fontOf(host));
  }, [appearance, ready]);

  const choices = languageChoices(language);
  return (
    <div className={`code-block${ready ? '' : ' is-loading'}`}>
      <label className="code-language" title="Language">
        <select
          aria-label="Code language"
          value={choices.value}
          disabled={locked}
          onChange={(e) => editor.updateBlock(blockId, { props: { language: e.target.value } })}
        >
          {choices.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {!ready && <PlainCode code={code} />}
      <div ref={hostRef} className="code-host" {...{ [CODE_EDITOR_ATTR]: '' }} />
    </div>
  );
}

const languageOf = (el: Element | null): string | undefined =>
  el?.getAttribute('data-language') ||
  [...(el?.classList ?? [])].find((name) => name.startsWith('language-'))?.slice('language-'.length) ||
  undefined;

/** An element's text with its line breaks, which a <br> holds as an element. */
function textOf(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const br of copy.querySelectorAll('br')) br.replaceWith('\n');
  return copy.textContent ?? '';
}

/** Pasted HTML's <pre>, or <pre><code>, as a code block. A `language-x` class or `data-language` names its language. */
export function parseCode(el: HTMLElement): { language: string; code: string } | undefined {
  if (el.tagName !== 'PRE') return undefined;
  const code = el.childElementCount === 1 && el.firstElementChild?.tagName === 'CODE' ? el.firstElementChild : null;
  return { language: languageOf(code) ?? languageOf(el) ?? 'text', code: textOf(code ?? el) };
}

/**
 * The page's export copies a block's props onto its first element as data attributes. The code and its language
 * are in the element already: a copy of the code in an attribute would only double what's on the clipboard.
 */
function dropPropAttributes(pre: HTMLElement | null) {
  pre?.parentElement?.removeAttribute('data-code');
  pre?.parentElement?.removeAttribute('data-language');
}

export const CodeBlock = createReactBlockSpec(
  { type: 'codeBlock', propSchema: { language: { default: 'text' }, code: { default: '' } }, content: 'none' },
  {
    render: ({ block, editor }) => <CodeBlockView blockId={block.id} code={block.props.code} language={block.props.language} editor={editor as AnyEditor} />,
    // Copied out of the page, it's code as the web writes it.
    toExternalHTML: ({ block }) => (
      <pre ref={dropPropAttributes}>
        <code className={`language-${block.props.language}`} data-language={block.props.language}>
          {block.props.code}
        </code>
      </pre>
    ),
    parse: parseCode,
  },
);
