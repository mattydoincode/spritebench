"use client";

import { useState } from "react";
import { useServer } from "@/client/stores/server";
import type { ResolvedAsset } from "@/shared/model";
import { RequestAudit } from "./RequestAudit";
import { TextButton } from "./ui";

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
  const job = asset.jobId ? jobs.find((entry) => entry.id === asset.jobId) : undefined;
  const key = job?.providerKeyId
    ? (keys.find((entry) => entry.id === job.providerKeyId) ?? null)
    : null;

  return (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <TextButton
          className="text-[11px] font-semibold tracking-wider uppercase"
          onClick={() => setOpen(!open)}
        >
          {open ? "\u25be" : "\u25b8"} history
        </TextButton>
        <TextButton
          title="Load this asset's prompt, model, templates, and modes into the generate panel"
          onClick={() => useServer.getState().restoreFromAsset(asset)}
        >
          use this setup
        </TextButton>
      </div>

      {open ? (
        <RequestAudit
          input={input}
          audit={{
            sourceSize: { width: asset.sourceWidth, height: asset.sourceHeight },
            resolvedSize: job?.resolvedSize,
            usage: asset.usage,
            elapsedSeconds: asset.elapsedSeconds,
            createdAt: asset.createdAt,
            key,
            billedKeyId: job ? job.providerKeyId : undefined
          }}
          projectId={projectId}
          assetId={asset.id}
        />
      ) : null}
    </>
  );
}
