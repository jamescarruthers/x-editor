import { useState } from 'react';
import { store } from '../state/store.js';
import { EXAMPLES, type Example } from '../examples/index.js';
import { TOPIC_METADATA_SCHEMA } from '../examples/topic.js';
import { Wizard } from './Wizard.js';

/**
 * The empty workspace.
 *
 * The question it asks is *"what are you working on?"* rather than *"what would you like to do?"*,
 * because the answer a beginner has is about their situation — I was sent a schema, I was sent a
 * file, I have neither — and not about this tool's features.
 *
 * Nothing here is modal in the trapping sense: every path out is one click, including simply
 * dismissing it. The most common reason a first-run screen is hated is that it stands between
 * someone and the thing they already knew how to do.
 */
export function StartScreen({
  onDismiss,
  onOpenFile,
}: {
  onDismiss: () => void;
  onOpenFile: () => void;
}): React.JSX.Element {
  const [wizard, setWizard] = useState(false);

  if (wizard) {
    return <Wizard onClose={() => setWizard(false)} onDone={onDismiss} />;
  }

  const openExample = (example: Example): void => {
    if (example.schema !== null && example.schemaName !== null) {
      const supporting =
        example.id === 'topic' ? { 'metadata.xsd': TOPIC_METADATA_SCHEMA } : {};
      store.attachSchema(example.schemaName, example.schema, supporting);
    }
    store.load(example.document, example.documentName);
    if (example.rules !== null) store.attachSample(example.document, example.documentName);
    onDismiss();
  };

  return (
    <div
      className="scroll-thin absolute inset-0 z-20 overflow-y-auto"
      style={{ background: 'var(--surface-1)' }}
    >
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-10">
        <div className="mb-6 flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold">What are you working on?</h1>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto text-[12px] hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Skip
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card
            title="Start from a schema"
            recommended
            body="You were sent an .xsd and need to produce a document that matches it. The wizard builds a valid skeleton and marks every value it had to invent."
            onClick={() => setWizard(true)}
          />
          <Card
            title="Open a file"
            body="An .xml, .xsd or .sch you already have. Schemas open in the component view; Schematron opens with its test harness."
            onClick={onOpenFile}
          />
          <Card
            title="Start from scratch"
            body="A blank document, with nothing checking it. You can attach a schema at any point and the guidance appears."
            onClick={() => {
              store.detachSchema();
              store.load('<?xml version="1.0" encoding="UTF-8"?>\n<root/>\n', 'untitled.xml');
              onDismiss();
            }}
          />
          <div
            className="flex flex-col rounded-lg border p-3"
            style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}
          >
            <div className="mb-1 text-[14px] font-semibold">Explore an example</div>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  onClick={() => openExample(example)}
                  className="rounded border px-2 py-1.5 text-left"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="text-[12px] font-medium">{example.title}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {example.teaches}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  body,
  recommended,
  onClick,
}: {
  title: string;
  body: string;
  recommended?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col rounded-lg border p-3 text-left"
      style={{
        borderColor: recommended === true ? 'var(--accent)' : 'var(--border-default)',
        background: 'var(--surface-2)',
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[14px] font-semibold">{title}</span>
        {recommended === true && (
          <span
            className="rounded px-1 text-[10px] uppercase"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            Recommended
          </span>
        )}
      </div>
      <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </span>
    </button>
  );
}
