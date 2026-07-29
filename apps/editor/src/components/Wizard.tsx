import { useMemo, useRef, useState } from 'react';
import {
  SchemaModel,
  assembleSchema,
  catalogueFrom,
  describeElement,
  formatElementName,
  type CompiledElement,
} from '@x-editor/xsd';
import { store } from '../state/store.js';
import { scaffoldDocument } from '../model/scaffold.js';
import { EXAMPLES } from '../examples/index.js';
import { TOPIC_METADATA_SCHEMA } from '../examples/topic.js';

/**
 * The new-document wizard.
 *
 * Its whole purpose is to remove the worst moment in this tool's life: a beginner staring at an
 * empty tree with a schema attached, knowing the schema says what to write and having no way to get
 * at it. Three questions — which schema, which root, how much — turn that into a document already
 * shaped like the answer.
 *
 * Every step is back-navigable and the whole thing escapable. Never trap someone in a wizard they
 * opened by accident, and never make "I changed my mind" cost more than one click.
 */
export function Wizard({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [schema, setSchema] = useState<LoadedSchema | null>(null);
  const [root, setRoot] = useState<CompiledElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const back = (): void => {
    if (step === 1) onClose();
    else setStep((current) => (current === 3 ? 2 : 1));
  };

  const chooseSchema = (loaded: LoadedSchema): void => {
    setSchema(loaded);
    const roots = loaded.model.globalElements().filter((element) => !element.abstract);
    // Auto-advance when there is exactly one: asking someone to choose from a list of one is a
    // question with no information in it.
    if (roots.length === 1) {
      setRoot(roots[0]!);
      setStep(3);
    } else {
      setRoot(null);
      setStep(2);
    }
  };

  const finish = (include: 'required' | 'all'): void => {
    if (schema === null || root === null) return;
    const scaffold = scaffoldDocument(schema.model, root, { include });

    store.attachSchema(schema.name, schema.source, schema.supporting);
    store.loadScaffold(scaffold, `${root.name.localName}.xml`);
    onDone();
  };

  return (
    <div
      className="scroll-thin absolute inset-0 z-20 overflow-y-auto"
      style={{ background: 'var(--surface-1)' }}
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-10">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-[11px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
            Step {step} of 3
          </span>
          <button
            type="button"
            onClick={back}
            className="ml-auto text-[12px] hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
        </div>

        {step === 1 && (
          <>
            <h1 className="mb-3 text-[20px] font-semibold">Which schema?</h1>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mb-3 rounded-lg border px-3 py-2.5 text-left"
              style={{ borderColor: 'var(--accent)', background: 'var(--surface-2)' }}
            >
              <div className="text-[14px] font-semibold">Choose an .xsd file</div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                It stays on this machine. Nothing is uploaded and no URL inside it is followed.
              </div>
            </button>

            <div className="mb-1.5 text-[11px] uppercase" style={{ color: 'var(--text-tertiary)' }}>
              Or one of the bundled schemas
            </div>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.filter((example) => example.schema !== null).map((example) => (
                <button
                  key={example.id}
                  type="button"
                  onClick={() => {
                    const supporting =
                      example.id === 'topic' ? { 'metadata.xsd': TOPIC_METADATA_SCHEMA } : {};
                    chooseSchema(compile(example.schemaName!, example.schema!, supporting));
                  }}
                  className="rounded border px-2.5 py-2 text-left"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <div className="text-[13px] font-medium">{example.schemaName}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {example.teaches}
                  </div>
                </button>
              ))}
            </div>

            <input
              ref={fileInput}
              type="file"
              accept=".xsd,text/xml,application/xml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) {
                  void file.text().then((text) => chooseSchema(compile(file.name, text, {})));
                }
                event.target.value = '';
              }}
            />
          </>
        )}

        {step === 2 && schema !== null && (
          <RootStep
            schema={schema}
            onChoose={(element) => {
              setRoot(element);
              setStep(3);
            }}
          />
        )}

        {step === 3 && schema !== null && root !== null && (
          <FillStep schema={schema} root={root} onFinish={finish} />
        )}
      </div>
    </div>
  );
}

interface LoadedSchema {
  readonly name: string;
  readonly source: string;
  readonly supporting: Readonly<Record<string, string>>;
  readonly model: SchemaModel;
}

function compile(
  name: string,
  source: string,
  supporting: Readonly<Record<string, string>>,
): LoadedSchema {
  const set = assembleSchema(name, catalogueFrom({ ...supporting, [name]: source }));
  return { name, source, supporting, model: new SchemaModel(set) };
}

/**
 * Choosing the root.
 *
 * Documentation is shown beside every candidate, because "which of these seventeen global elements
 * is the one I want?" is unanswerable from names alone in any real schema, and it is the step where
 * a wizard most often produces a confidently wrong document.
 */
function RootStep({
  schema,
  onChoose,
}: {
  schema: LoadedSchema;
  onChoose: (element: CompiledElement) => void;
}): React.JSX.Element {
  const roots = useMemo(
    () => schema.model.globalElements().filter((element) => !element.abstract),
    [schema],
  );

  return (
    <>
      <h1 className="mb-1 text-[20px] font-semibold">Which element starts the document?</h1>
      <p className="mb-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        {roots.length === 0
          ? 'This schema declares no global elements, so nothing can be a document root. It is probably meant to be imported by another schema.'
          : `${schema.name} declares ${roots.length} elements that can start a document.`}
      </p>

      <div className="scroll-thin flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
        {roots.map((element) => (
          <button
            key={formatElementName(element.name)}
            type="button"
            onClick={() => onChoose(element)}
            className="rounded border px-2.5 py-2 text-left"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div className="font-mono text-[13px]">{element.name.localName}</div>
            <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {describeElement(element, schema.model.typeOf(element)).text}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Choosing how much to fill in, with the consequence of each choice measured rather than described.
 *
 * The node counts are computed by actually generating both documents. A warning that says "this may
 * be large" is worth much less than one that says "this is 1,240 elements", and the generation is
 * cheap enough to do twice.
 */
function FillStep({
  schema,
  root,
  onFinish,
}: {
  schema: LoadedSchema;
  root: CompiledElement;
  onFinish: (include: 'required' | 'all') => void;
}): React.JSX.Element {
  const sizes = useMemo(() => {
    const required = scaffoldDocument(schema.model, root, { include: 'required' });
    const all = scaffoldDocument(schema.model, root, { include: 'all' });
    return { required, all };
  }, [schema, root]);

  return (
    <>
      <h1 className="mb-1 text-[20px] font-semibold">How much should be filled in?</h1>
      <p className="mb-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        Every value that has to be invented is marked for review, so nothing generated can be mistaken
        for something you decided.
      </p>

      <div className="flex flex-col gap-2">
        <Option
          title="Required only"
          recommended
          detail={`${sizes.required.elementCount} elements, ${sizes.required.placeholders.length} values to review`}
          body="Just what the schema insists on. The Insert palette shows what may be added next, at every point."
          onClick={() => onFinish('required')}
        />
        <Option
          title="Everything"
          detail={`${sizes.all.elementCount} elements, ${sizes.all.placeholders.length} values to review`}
          body={
            sizes.all.elementCount > 200
              ? 'Every optional element too. At this size the document is a reference to read rather than one to fill in.'
              : 'Every optional element too, so you can see the whole shape and delete what you do not need.'
          }
          onClick={() => onFinish('all')}
        />
      </div>
    </>
  );
}

function Option({
  title,
  detail,
  body,
  recommended,
  onClick,
}: {
  title: string;
  detail: string;
  body: string;
  recommended?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-3 py-2.5 text-left"
      style={{
        borderColor: recommended === true ? 'var(--accent)' : 'var(--border-default)',
        background: 'var(--surface-2)',
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="tnum text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {detail}
        </span>
      </div>
      <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        {body}
      </div>
    </button>
  );
}
