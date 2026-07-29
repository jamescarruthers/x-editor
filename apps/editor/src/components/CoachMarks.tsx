import { useEffect, useLayoutEffect, useState } from 'react';

/**
 * First-run coach marks.
 *
 * Four, sequential, dismissible, and **never modal** — every one of those is a constraint rather
 * than a style choice. A modal tour is the thing people close without reading, and one that cannot
 * be escaped is the reason they close it. Everything underneath stays clickable throughout, so
 * someone who would rather just start is never blocked by the explanation of how to start.
 *
 * They are anchored to real controls rather than shown in a slideshow, because the useful part is
 * *where the thing is*, and a picture of a button is not that.
 */

interface Mark {
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
  readonly placement: 'below' | 'above';
}

const MARKS: readonly Mark[] = [
  {
    anchor: 'insert',
    title: 'Insert is the main thing',
    body: 'It lists only what the schema allows at the selected point, with a sentence about each. Ctrl+Space, / or + open it too.',
    placement: 'below',
  },
  {
    anchor: 'validity',
    title: 'Two verdicts, kept apart',
    body: 'This badge is our own engine. Beside it, libxml2 gives the authoritative answer from a worker. They are shown separately so a disagreement is visible rather than hidden.',
    placement: 'below',
  },
  {
    anchor: 'inspector',
    title: 'Everything about the selection lives here',
    body: 'What it is, its settings, its value, what may go inside it, and what is wrong with it — always in that order, always in the same place.',
    placement: 'below',
  },
  {
    anchor: 'problems',
    title: 'Problems explain, then fix',
    body: 'Each one is written in plain English with a one-click fix. F8 steps through them.',
    placement: 'above',
  },
];

const SEEN_KEY = 'onboarding.v1.seen';

export function CoachMarks({ enabled }: { enabled: boolean }): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === 'true';
    } catch {
      // Private browsing, or storage disabled. Showing the marks every time is a smaller failure
      // than crashing the editor over a preference.
      return false;
    }
  });
  const [box, setBox] = useState<DOMRect | null>(null);

  const finish = (): void => {
    setDone(true);
    try {
      localStorage.setItem(SEEN_KEY, 'true');
    } catch {
      /* nothing to do — the marks simply return next session */
    }
  };

  const mark = MARKS[step];
  const active = enabled && !done && mark !== undefined;

  useLayoutEffect(() => {
    if (!active) return;
    const element = document.querySelector(`[data-coach="${mark.anchor}"]`);
    setBox(element === null ? null : element.getBoundingClientRect());
  }, [active, mark, step]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      // Escape dismisses all of them, not just this one. Someone pressing Escape is telling you
      // they do not want the tour, and asking again three times is not listening.
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active || box === null) return <></>;

  const top = mark.placement === 'below' ? box.bottom + 8 : box.top - 8;
  const left = Math.max(8, Math.min(box.left, window.innerWidth - 300));

  return (
    <div
      role="note"
      aria-label={`Tip ${step + 1} of ${MARKS.length}`}
      className="fixed z-40 w-[280px] rounded-lg border p-2.5 shadow-lg"
      style={{
        top: mark.placement === 'below' ? top : undefined,
        bottom: mark.placement === 'above' ? window.innerHeight - top : undefined,
        left,
        borderColor: 'var(--accent)',
        background: 'var(--surface-2)',
      }}
    >
      <div className="mb-1 text-[13px] font-semibold">{mark.title}</div>
      <p className="mb-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        {mark.body}
      </p>
      <div className="flex items-center gap-2">
        <span className="tnum text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {step + 1} of {MARKS.length}
        </span>
        <button
          type="button"
          onClick={finish}
          className="ml-auto text-[11px] hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => (step + 1 >= MARKS.length ? finish() : setStep(step + 1))}
          className="rounded border px-2 py-0.5 text-[11px]"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
        >
          {step + 1 >= MARKS.length ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
}
