import { useEffect, useState } from 'react';
import { store } from '../state/store.js';
import { applyPaste, pasteInto, type PasteAnalysis, type PasteOption } from '../model/paste.js';

/**
 * The paste helper.
 *
 * Pasting XML that does not fit is the most common way a beginner's document goes wrong, and every
 * other editor answers it by dropping the text in and reporting the errors afterwards. Here the
 * question is asked before the edit, with each option's cost measured — *paste inside: adds 2
 * errors* — so the choice is informed rather than a guess followed by an undo.
 *
 * Plain `Ctrl+V` takes the best option silently when exactly one is valid, because turning an
 * expert's paste into a dialogue is its own kind of failure. The sheet only appears when there is a
 * genuine choice to make.
 */
export function PasteSheetHost(): React.JSX.Element {
  const [analysis, setAnalysis] = useState<PasteAnalysis | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const pasted = event.clipboardData?.getData('text/plain') ?? '';
      if (pasted.trim() === '') return;
      event.preventDefault();

      const result = pasteInto(pasted);
      const valid = result.options.filter((option) => option.errors === 0);

      // Straight through when there is exactly one way to be right, and a sheet when there is a
      // real decision. `Ctrl+Shift+V` always opens the sheet — see the keydown handler in App.
      if (valid.length === 1 && result.parseError === null) {
        commit(result, valid[0]!, pasted);
        return;
      }

      setText(pasted);
      setAnalysis(result);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  if (analysis === null) return <></>;

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={() => setAnalysis(null)}
    >
      <div
        role="dialog"
        aria-label="Paste options"
        className="mb-8 w-[560px] max-w-[90vw] rounded-lg border p-3"
        style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-[14px] font-semibold">Where should this go?</h2>
          <button
            type="button"
            onClick={() => setAnalysis(null)}
            className="ml-auto text-[12px] hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Cancel
          </button>
        </div>

        {analysis.parseError !== null && (
          <p className="mb-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {analysis.parseError}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {analysis.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                commit(analysis, option, text);
                setAnalysis(null);
              }}
              className="rounded border px-2.5 py-2 text-left"
              style={{
                borderColor: index === 0 ? 'var(--accent)' : 'var(--border-default)',
                background: index === 0 ? 'var(--accent-soft)' : 'var(--surface-2)',
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium">{option.title}</span>
                <span
                  className="text-[11px]"
                  style={{ color: option.errors === 0 ? 'var(--ok)' : 'var(--error)' }}
                >
                  {option.errors === 0
                    ? 'valid'
                    : `adds ${option.errors} error${option.errors === 1 ? '' : 's'}`}
                </span>
              </div>
              <div
                className="scroll-thin mt-0.5 max-h-16 overflow-auto font-mono text-[11px] whitespace-pre"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {option.preview.slice(0, 400)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function commit(analysis: PasteAnalysis, option: PasteOption, text: string): void {
  const command = applyPaste(store.document, option, analysis.fragment, text);
  if (command !== null) store.run(command);
}
