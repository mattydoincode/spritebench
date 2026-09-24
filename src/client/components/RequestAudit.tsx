"use client";

import { requestOwner, requestPartUrl } from "@/client/api";
import {
  composeProviderPrompt,
  providerAttachmentPlan,
  providerAuditLines,
  type ProviderAuditInput,
  type ProviderPromptInput
} from "@/shared/providerPrompt";
import { Field } from "./ui";

export function RequestAudit({
  input,
  audit,
  projectId,
  assetId,
  jobId
}: {
  input: ProviderPromptInput;
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
      <p className="mb-1 text-[10px] text-slate-500">
        {attachments.length > 0
          ? `${attachments.length} image${attachments.length === 1 ? "" : "s"} sent`
          : "text only"}
      </p>

      <dl className="mb-2 space-y-0.5 text-[10px] leading-snug text-slate-500">
        {lines.map((line) => (
          <div key={line.label} className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-600">{line.label}</dt>
            <dd className="min-w-0 break-words text-slate-400">{line.value}</dd>
          </div>
        ))}
      </dl>

      <Field label="Sent" hint="what the provider received">
        <textarea
          rows={8}
          readOnly
          value={sent}
          title="The full prompt that went out on this job. Select and copy; editing it here would make the record a lie."
        />
      </Field>

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
    </div>
  );
}
