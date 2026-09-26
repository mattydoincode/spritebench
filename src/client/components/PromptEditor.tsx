"use client";

import { useRef, useState, type ReactNode } from "react";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import {
  carryVariables,
  collectSlots,
  joinValues,
  LOOP_SLOT_NAMES,
  loopReservedSlots,
  nextVariableName,
  parseValues,
  SLOT_PATTERN,
  variableValues,
  withVariableValues,
  type PromptBinding
} from "@/shared/promptVars";
import {
  cleanSnippetName,
  expandSnippets,
  insertAt,
  snippetRefs,
  snippetSegments
} from "@/shared/snippets";
import { PanelTab, TextButton } from "./ui";

const LABEL = "text-[10px] tracking-widest text-slate-500 uppercase";

/**
 * The pinned prompt: the text box, a preview of exactly what is sent, and the
 * two ways a prompt reaches outside itself -- `{variables}` and `@snippets`.
 *
 * Both are inserted the same way, at the cursor, from a small button by their
 * heading, and both are named only in the prompt text. Nothing here adds to
 * the prompt without a token in the box saying so.
 */
export function PromptEditor({
  bindings,
  summary,
  children
}: {
  /** One per prompt Create will send, for the preview to page through. */
  bindings: PromptBinding[];
  /** What else goes with the prompt: modes, masks, attached images. */
  summary: string[];
  /** The Create row, under everything else. */
  children: ReactNode;
}) {
  const promptBody = useUi((state) => state.promptBody);
  const snippets = useDoc((state) => state.snippets);
  const ui = useUi.getState;

  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  // Where the next insert goes. Kept after blur so clicking a button to
  // insert does not lose the spot you were typing at.
  const selection = useRef({ start: promptBody.length, end: promptBody.length });
  // The variable name the last edit deleted, held one step for `carryVariables`.
  const orphan = useRef<string | null>(null);

  const resolved = (body: string) => expandSnippets(body, snippets);

  const edit = (next: string) => {
    const carried = carryVariables(
      resolved(promptBody),
      resolved(next),
      ui().variables,
      orphan.current
    );
    orphan.current = carried.orphan;
    if (carried.variables !== ui().variables) ui().setVariables(carried.variables);
    ui().setPromptBody(next);
  };

  /** Replaces the current selection (or inserts at the cursor) with `token`. */
  const insert = (token: string) => {
    const { start, end } = selection.current;
    const cleared = promptBody.slice(0, start) + promptBody.slice(end);
    const placed = insertAt(cleared, Math.min(start, cleared.length), token);
    ui().setPromptBody(placed.text);
    selection.current = { start: placed.caret, end: placed.caret };
    setTab("edit");

    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(placed.caret, placed.caret);
    });
  };

  const selectedText = () => promptBody.slice(selection.current.start, selection.current.end);

  return (
    <>
      <div className="mb-2 flex h-7 shrink-0 items-stretch gap-4 border-b border-[var(--color-edge)]">
        <div role="tablist" aria-label="Prompt" className="flex items-stretch gap-4">
          <PanelTab selected={tab === "edit"} onClick={() => setTab("edit")}>
            Edit
          </PanelTab>
          <PanelTab selected={tab === "preview"} onClick={() => setTab("preview")}>
            Preview
          </PanelTab>
        </div>
        <span className="flex-1" />
        <span className="self-center text-[10px] text-slate-500">{promptBody.length} chars</span>
        <TextButton
          className="self-center"
          title="Reset prompt, modes, templates, and batches. Keeps the current model."
          onClick={() => useServer.getState().resetGenerateDefaults()}
        >
          reset
        </TextButton>
      </div>

      {tab === "edit" ? (
        <textarea
          ref={textarea}
          value={promptBody}
          placeholder="a rusty steel footlocker, closed lid, worn paint, @style"
          onChange={(event) => edit(event.target.value)}
          onSelect={(event) => {
            selection.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd
            };
          }}
          className="mb-2 min-h-16 flex-1 resize-none"
        />
      ) : (
        <PromptPreview bindings={bindings} summary={summary} />
      )}

      <VariablesBlock onInsert={insert} />
      <SnippetsBlock onInsert={insert} selectedText={selectedText} />

      {children}
    </>
  );
}

/**
 * `text` with each bound `{name}` replaced by its value, marked so you can see
 * which words came from a variable. Unbound slots stay as written.
 */
function FilledText({ text, bindings }: { text: string; bindings: PromptBinding }) {
  const parts: ReactNode[] = [];
  let at = 0;

  for (const match of text.matchAll(new RegExp(SLOT_PATTERN.source, "g"))) {
    const name = match[1];
    if (!Object.prototype.hasOwnProperty.call(bindings, name)) continue;
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push(
      <span
        key={match.index}
        title={`{${name}}`}
        className="rounded-sm bg-sky-900/50 text-sky-100"
      >
        {bindings[name]}
      </span>
    );
    at = match.index + match[0].length;
  }

  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** Exactly what Create sends, one prompt at a time, with snippet and variable text marked. */
function PromptPreview({ bindings, summary }: { bindings: PromptBinding[]; summary: string[] }) {
  const promptBody = useUi((state) => state.promptBody);
  const snippets = useDoc((state) => state.snippets);
  const [index, setIndex] = useState(0);

  const count = bindings.length;
  const at = count > 0 ? Math.min(index, count - 1) : 0;
  const bound = bindings[at] ?? {};
  const fill = (text: string) => <FilledText text={text} bindings={bound} />;
  const segments = snippetSegments(promptBody, snippets);

  return (
    <div className="mb-2 flex min-h-16 flex-1 flex-col overflow-hidden rounded border border-[var(--color-edge)] bg-[var(--color-ink-900)]">
      {count > 1 ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-edge)] px-2 py-1 text-[10px] text-slate-500">
          <TextButton disabled={at === 0} onClick={() => setIndex(at - 1)}>
            {"‹"}
          </TextButton>
          <span className="tabular-nums">
            {at + 1} of {count}
          </span>
          <TextButton disabled={at >= count - 1} onClick={() => setIndex(at + 1)}>
            {"›"}
          </TextButton>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">
        {segments.length === 0 ? (
          <span className="text-slate-500">(empty)</span>
        ) : (
          segments.map((segment, key) =>
            segment.snippet ? (
              <span
                key={key}
                title={`from @${segment.snippet}`}
                className="rounded-sm bg-[var(--color-accent-dim)]/40 text-emerald-100"
              >
                {fill(segment.text)}
              </span>
            ) : (
              <span key={key}>{fill(segment.text)}</span>
            )
          )
        )}
      </div>

      {summary.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1 border-t border-[var(--color-edge)] px-2 py-1.5">
          <span className={LABEL}>also sent</span>
          {summary.map((entry) => (
            <span
              key={entry}
              className="rounded bg-[var(--color-ink-700)] px-1.5 text-[10px] text-slate-400"
            >
              {entry}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BlockHeading({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="mb-1 flex shrink-0 items-center gap-1">
      <span className={LABEL}>{label}</span>
      <span className="flex-1" />
      {children}
    </div>
  );
}

/**
 * One row per `{name}` in the prompt (snippets included), values only. The
 * name is changed by editing the prompt; `carryVariables` keeps the values.
 */
function VariablesBlock({ onInsert }: { onInsert: (token: string) => void }) {
  const promptBody = useUi((state) => state.promptBody);
  const variables = useUi((state) => state.variables);
  const loop = useUi((state) => state.loop);
  const snippets = useDoc((state) => state.snippets);
  const ui = useUi.getState;

  const reserved = loopReservedSlots(loop.enabled);
  const inBody = new Set(collectSlots(promptBody));
  const names = collectSlots(expandSnippets(promptBody, snippets)).filter(
    (name) => !reserved.includes(name)
  );

  const add = () => {
    const taken = [...names, ...variables.map((entry) => entry.name)].map((name) => ({
      name,
      values: ""
    }));
    onInsert(`{${nextVariableName(taken)}}`);
  };

  return (
    <div className="mb-2 shrink-0">
      <BlockHeading label="variables">
        {loop.enabled
          ? LOOP_SLOT_NAMES.map((name) => (
              <TextButton
                key={name}
                title={`Insert {${name}}, filled each loop step`}
                onClick={() => onInsert(`{${name}}`)}
              >
                {`{${name}}`}
              </TextButton>
            ))
          : null}
        <TextButton title="Insert a new {variable} at the cursor" onClick={add}>
          + variable
        </TextButton>
      </BlockHeading>

      {names.map((name) => (
        <div key={name} className="mb-1 flex items-start gap-1.5">
          <span
            className="w-20 shrink-0 truncate pt-1 font-mono text-[10px] text-slate-400"
            title={inBody.has(name) ? `{${name}}` : `{${name}}, used by a snippet`}
          >
            {`{${name}}`}
            {inBody.has(name) ? null : <span className="text-slate-600"> @</span>}
          </span>
          <VariableValues
            values={variableValues(variables, name)}
            onChange={(values) => ui().setVariables(withVariableValues(ui().variables, name, values))}
          />
        </div>
      ))}
    </div>
  );
}

function VariableValues({
  values,
  onChange
}: {
  values: string;
  onChange: (values: string) => void;
}) {
  const chips = parseValues(values);
  const [draft, setDraft] = useState("");

  const write = (next: string[]) => onChange(joinValues(next));

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded border border-[var(--color-edge)] bg-[var(--color-ink-900)] px-1 py-0.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip}-${index}`}
          className="flex items-center gap-0.5 rounded bg-[var(--color-ink-600)] px-1 py-0.5 text-[10px] leading-none text-slate-200"
        >
          {chip}
          <button
            type="button"
            title={`Remove ${chip}`}
            onClick={() => write(chips.filter((_, at) => at !== index))}
            className="text-slate-500 hover:text-white"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={chips.length === 0 ? "green, red, blue" : "add"}
        spellCheck={false}
        style={{
          width: "auto",
          minWidth: chips.length === 0 ? "8rem" : "3.5rem",
          border: "none",
          background: "transparent",
          padding: "2px 4px"
        }}
        className="min-w-0 flex-1 text-[11px]"
        onChange={(event) => {
          const text = event.target.value;
          if (!text.includes(",")) {
            setDraft(text);
            return;
          }
          const parts = text.split(",");
          const rest = parts.pop() ?? "";
          const added = parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          if (added.length > 0) write([...chips, ...added]);
          setDraft(rest);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (!text.includes(",")) return;
          event.preventDefault();
          write([...chips, ...parseValues(`${draft}${text}`)]);
          setDraft("");
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === ",") && draft.trim()) {
            event.preventDefault();
            write([...chips, draft.trim()]);
            setDraft("");
            return;
          }
          if (event.key === "Backspace" && draft === "" && chips.length > 0) {
            write(chips.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (!draft.trim()) return;
          write([...chips, draft.trim()]);
          setDraft("");
        }}
      />
    </div>
  );
}

/**
 * One row per `@name` in the prompt, its text editable in place -- editing it
 * here edits it for every prompt and every collaborator. The menu inserts an
 * existing snippet or makes a new one, from the selection if there is one.
 */
function SnippetsBlock({
  onInsert,
  selectedText
}: {
  onInsert: (token: string) => void;
  selectedText: () => string;
}) {
  const promptBody = useUi((state) => state.promptBody);
  const snippets = useDoc((state) => state.snippets);
  const canEdit = useServer((state) => state.project?.role !== "viewer");
  const [open, setOpen] = useState(false);

  const refs = snippetRefs(promptBody);

  return (
    <div className="mb-2 shrink-0">
      <BlockHeading label="snippets">
        <TextButton
          title="Insert a snippet at the cursor, or make a new one"
          onClick={() => setOpen(!open)}
        >
          {open ? "close" : "+ snippet"}
        </TextButton>
      </BlockHeading>

      {open ? (
        <SnippetMenu
          canEdit={canEdit}
          selectedText={selectedText}
          onInsert={(name) => {
            onInsert(`@${name}`);
            setOpen(false);
          }}
        />
      ) : null}

      {refs.map((name) => {
        const snippet = snippets.find((entry) => entry.name === name);

        return (
          <div key={name} className="mb-1 flex items-start gap-1.5">
            <span
              className={`w-20 shrink-0 truncate pt-1 font-mono text-[10px] ${
                snippet ? "text-slate-400" : "text-amber-300"
              }`}
              title={`@${name}`}
            >
              @{name}
            </span>
            {snippet ? (
              <textarea
                value={snippet.text}
                rows={1}
                disabled={!canEdit}
                placeholder="snippet text"
                onChange={(event) => useDoc.getState().setSnippetText(snippet.id, event.target.value)}
                className="min-w-0 flex-1 resize-none bg-[var(--color-ink-900)] text-[11px] [field-sizing:content]"
              />
            ) : (
              <span className="flex flex-1 items-center gap-1 pt-0.5 text-[10px] text-amber-300">
                no snippet by this name
                {canEdit ? (
                  <TextButton onClick={() => useDoc.getState().createSnippet(name, "")}>
                    create
                  </TextButton>
                ) : null}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SnippetMenu({
  canEdit,
  selectedText,
  onInsert
}: {
  canEdit: boolean;
  selectedText: () => string;
  onInsert: (name: string) => void;
}) {
  const snippets = useDoc((state) => state.snippets);
  const [draft, setDraft] = useState("");

  const name = cleanSnippetName(draft);
  const taken = snippets.some((entry) => entry.name === name);
  const fromSelection = selectedText().trim();

  const create = () => {
    if (!name || taken) return;
    useDoc.getState().createSnippet(name, fromSelection);
    setDraft("");
    onInsert(name);
  };

  return (
    <div className="mb-2 rounded border border-[var(--color-edge)] bg-[var(--color-ink-900)] p-1.5">
      {snippets.length === 0 ? (
        <p className="mb-1 px-0.5 text-[10px] text-slate-500">No snippets in this project yet.</p>
      ) : (
        <div className="mb-1.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {snippets.map((entry) => (
            <div key={entry.id} className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                title="Insert at the cursor"
                onClick={() => onInsert(entry.name)}
                className="flex min-w-0 flex-1 items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--color-ink-600)]"
              >
                <span className="shrink-0 font-mono text-slate-200">@{entry.name}</span>
                <span className="truncate text-[10px] text-slate-500">{entry.text}</span>
              </button>
              {canEdit ? (
                <TextButton
                  danger
                  title="Delete this snippet for everyone in the project"
                  onClick={() => {
                    if (confirm(`Delete @${entry.name} for everyone in this project?`)) {
                      useDoc.getState().deleteSnippet(entry.id);
                    }
                  }}
                >
                  &times;
                </TextButton>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="flex items-center gap-1">
          <input
            value={draft}
            placeholder="new snippet name"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") create();
            }}
            className="min-w-0 flex-1 text-[11px]"
          />
          <TextButton disabled={!name || taken} onClick={create}>
            {fromSelection ? "from selection" : "create"}
          </TextButton>
        </div>
      ) : null}
      {taken ? <p className="mt-1 text-[10px] text-amber-300">@{name} already exists</p> : null}
    </div>
  );
}
