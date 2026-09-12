"use client";

import { useEffect, useState } from "react";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { providerIds, providerLabel } from "@/providers/models";
import { Modal } from "./ui";

/**
 * Account-level settings: things that belong to you rather than to a project.
 *
 * Provider keys live here because that is where they live in the schema -- a
 * key is yours, and a project only records which of your keys it billed.
 * That split is what lets you share a project with someone who can generate
 * without ever showing them the key paying for it.
 */

function providerName(id: string): string {
  return providerLabel(id);
}

const DISCLAIMER =
  "SpriteBench never generates on your behalf with its own credits. Your key is encrypted before it is stored, and after you save it only the last four characters are ever shown again.";

function AddKeyModal({ onClose }: { onClose: () => void }) {
  const providers = providerIds();

  const [provider, setProvider] = useState(providers[0] ?? "openai");
  // Defaults to the provider's name and follows it until the field is edited,
  // so the common case needs no typing and a second key can still be named.
  const [label, setLabel] = useState(providerName(providers[0] ?? "openai"));
  const [labelEdited, setLabelEdited] = useState(false);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);

  const chooseProvider = (next: string) => {
    setProvider(next);
    if (!labelEdited) setLabel(providerName(next));
  };

  const save = async () => {
    if (!secret.trim()) return;

    setSaving(true);
    await useServer.getState().addProviderKey(provider, label.trim(), secret.trim());
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Add a key" variant="plain" width={520} onClose={onClose}>
      <p className="mb-5 rounded-md border border-[var(--color-edge)] bg-[var(--color-ink-800)] p-3 text-sm leading-relaxed text-slate-400">
        {DISCLAIMER}
      </p>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-slate-300">Provider</span>
        <select value={provider} onChange={(event) => chooseProvider(event.target.value)}>
          {providers.map((id) => (
            <option key={id} value={id}>
              {providerName(id)}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-sm text-slate-300">Label</span>
        <input
          type="text"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setLabelEdited(true);
          }}
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1.5 block text-sm text-slate-300">Key</span>
        {/*
          Plain text, not a password field: you are pasting a key you cannot
          read back afterwards, so being able to see whether the paste landed
          is worth more than shoulder-surfing protection on your own machine.
        */}
        <input
          autoFocus
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
          className="font-mono"
          onChange={(event) => setSecret(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
      </label>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--color-edge)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--color-ink-700)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !secret.trim()}
          onClick={() => void save()}
          className="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function EmptyKeys({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-lg border-2 border-dashed border-[var(--color-ink-500)] px-6 py-14 text-center">
      <p className="max-w-md text-slate-400">
        You have not added any keys. You will not be able to generate new art until
        you provide one.
      </p>

      <button
        type="button"
        onClick={onAdd}
        className="rounded-md bg-[var(--color-accent-dim)] px-6 py-3 font-medium text-white hover:brightness-110"
      >
        Add Key
      </button>
    </div>
  );
}

function RemoveKeyModal({
  label,
  onConfirm,
  onClose
}: {
  label: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Remove key" variant="plain" width={440} onClose={onClose}>
      <p className="text-slate-300">
        Remove <span className="font-medium text-white">{label}</span>? Projects that bill
        it stop generating until you point them at another key.
      </p>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--color-edge)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--color-ink-700)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="rounded-md bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          Remove
        </button>
      </div>
    </Modal>
  );
}

function KeyRow({ id, provider, label, keySuffix, valid }: {
  id: string;
  provider: string;
  label: string;
  keySuffix: string;
  valid: boolean | null;
}) {
  const [removing, setRemoving] = useState(false);

  const status =
    valid === false
      ? { text: "rejected", tone: "text-rose-400", hint: "The provider rejected this key" }
      : valid
        ? { text: "working", tone: "text-[var(--color-accent)]", hint: "Used successfully" }
        : { text: "not used yet", tone: "text-slate-500", hint: "No generation has used it" };

  return (
    <li className="flex items-center gap-4 rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-4 py-3">
      <span className="w-20 shrink-0 font-medium text-white">{providerName(provider)}</span>
      <span className="min-w-0 flex-1 truncate text-slate-300">{label || "unlabelled"}</span>
      <span className="font-mono text-sm text-slate-500">
        ...{keySuffix.replace(/^\.\.\./, "")}
      </span>
      <span title={status.hint} className={`w-24 text-right text-sm ${status.tone}`}>
        {status.text}
      </span>

      <button
        type="button"
        onClick={() => setRemoving(true)}
        className="rounded-md border border-[var(--color-edge)] px-3 py-1.5 text-sm text-slate-400 hover:border-rose-800 hover:text-rose-300"
      >
        Remove
      </button>

      {removing ? (
        <RemoveKeyModal
          label={label || providerName(provider)}
          onConfirm={() => void useServer.getState().removeProviderKey(id)}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </li>
  );
}

export function AccountSettings() {
  const keys = useServer((state) => state.providerKeys);
  const error = useUi((state) => state.error);

  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    useUi.getState().clearMessages();

    void (async () => {
      await useServer.getState().loadProjects();
      setLoading(false);
    })();
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Settings &amp; Keys</h1>

      {error ? (
        <p className="mt-6 rounded-md border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium text-white">Image model keys</h2>

          {keys.length > 0 ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md bg-[var(--color-accent-dim)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              Add Key
            </button>
          ) : null}
        </div>

        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : keys.length === 0 ? (
          <EmptyKeys onAdd={() => setAdding(true)} />
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((key) => (
              <KeyRow key={key.id} {...key} />
            ))}
          </ul>
        )}
      </section>

      {adding ? <AddKeyModal onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
