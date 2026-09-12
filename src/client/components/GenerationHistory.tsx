"use client";

import { useState } from "react";
import { requestPartUrl } from "@/client/api";
import { useServer } from "@/client/stores/server";
import {
  composeProviderPrompt,
  providerAttachmentPlan,
  providerAuditLines
} from "@/shared/providerPrompt";
import type { ResolvedAsset } from "@/shared/model";
import { Field, TextButton } from "./ui";

export function GenerationHistory({ asset }: { asset: ResolvedAsset }) {
  const projectId = useServer((state) => state.project?.id);
  const jobs = useServer((state) => state.jobs);
  const keys = useServer((state) => state.projectKeys);
  const [open, setOpen] = useState(true);

  const input = {
    prompt: asset.prompt,
    composedPrompt: asset.composedPrompt,
    generation: asset.generation,
    inputs: asset.inputs,
    sequencePlan: asset.sequencePlan
  };
  const sent = composeProviderPrompt(input);
  const attachments = providerAttachmentPlan(input);
  const job = asset.jobId ? jobs.find((entry) => entry.id === asset.jobId) : undefined;
  const key = job?.providerKeyId
    ? keys.find((entry) => entry.id === job.providerKeyId) ?? null
    : null;
  const audit = providerAuditLines({
    ...input,
    sourceSize: { width: asset.sourceWidth, height: asset.sourceHeight },
    resolvedSize: job?.resolvedSize,
    usage: asset.usage,
    elapsedSeconds: asset.elapsedSeconds,
    createdAt: asset.createdAt,
    key,
    billedKeyId: job ? job.providerKeyId : undefined
  });

  return (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <TextButton
          className="text-[11px] font-semibold tracking-wider uppercase"
          onClick={() => setOpen(!open)}
        >
          {open ? "\u25be" : "\u25b8"} history
        </TextButton>
        <span className="text-[10px] text-slate-500">
          {attachments.length > 0
            ? `${attachments.length} image${attachments.length === 1 ? "" : "s"} sent`
            : "text only"}
        </span>
      </div>

      {open ? (
        <div className="mb-2">
          <dl className="mb-2 space-y-0.5 text-[10px] leading-snug text-slate-500">
            {audit.map((line) => (
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

          {projectId && attachments.length > 0 ? (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {attachments.map((part) => (
                <a
                  key={part.id}
                  href={requestPartUrl(projectId, asset.id, part.id)}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the image that was sent"
                  className="block overflow-hidden rounded border border-[var(--color-edge)]"
                >
                  <div className="checkerboard flex h-28 items-center justify-center p-1">
                    <img
                      src={requestPartUrl(projectId, asset.id, part.id)}
                      alt={part.label}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <p className="px-1.5 py-1 text-[10px] leading-snug text-slate-500">{part.label}</p>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
