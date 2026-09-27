"use client";

import { requestOwner, requestPartUrl } from "@/client/api";
import {
  composeProviderPrompt,
  providerAttachmentPlan,
  providerAuditLines,
  type ProviderAuditInput,
  type ProviderPromptInput
} from "@/shared/providerPrompt";
import { useState, type ReactNode } from "react";
import { TextButton } from "./ui";

export function RequestAudit({
  input,
  audit,
  projectId,
  assetId,
  jobId,
  actions
}: {
  input: ProviderPromptInput;
  /** Extra controls beside copy, like "use this setup". */
  actions?: ReactNode;
  audit?: Omit<ProviderAuditInput, keyof ProviderPromptInput>;
  projectId?: string | null;
  assetId?: string | null;
  jobId?: string | null;
}) {
  const sent = composeProviderPrompt(input);
  const attachments = providerAttachmentPlan(input);
  const lines = providerAuditLines({ ...input, ...audit });
  const owner = requestOwner(assetId, jobId);

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] tracking-widest text-slate-500 uppercase">sent prompt</span>
        <span className="flex-1" />
        {actions}
        <CopyButton text={sent} />
      </div>
      {/* Text, not a textarea: it is a record of what went out, to read and copy. */}
      <p className="mb-2 rounded border border-[var(--color-edge)] bg-[var(--color-ink-900)] p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-200 select-text">
        {sent || <span className="text-slate-500">(empty)</span>}
      </p>

      {projectId && owner && attachments.length > 0 ? (
        <div className="mb-2 grid grid-cols-2 gap-2">
          {attachments.map((part) => {
            const href = requestPartUrl(projectId, owner, part.id);
            return (
              <a
                key={part.id}
                href={href}
                target="_blank"
                rel="noreferrer"
                title="Open the image that was sent"
                className="block overflow-hidden rounded border border-[var(--color-edge)]"
              >
                <div className="checkerboard flex h-28 items-center justify-center p-1">
                  <img src={href} alt={part.label} className="max-h-full max-w-full object-contain" />
                </div>
                <p className="px-1.5 py-1 text-[10px] leading-snug text-slate-500">{part.label}</p>
              </a>
            );
          })}
        </div>
      ) : null}

      <p className="mb-1 text-[10px] text-slate-500">
        {attachments.length > 0
          ? `${attachments.length} image${attachments.length === 1 ? "" : "s"} sent`
          : "text only"}
      </p>

      <dl className="space-y-0.5 text-[10px] leading-snug text-slate-500">
        {lines.map((line) => (
          <div key={line.label} className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-600">{line.label}</dt>
            <dd className="min-w-0 break-words text-slate-400">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <TextButton
      title="Copy the prompt exactly as it was sent"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false)
        );
      }}
    >
      {copied ? "copied" : "copy"}
    </TextButton>
  );
}
