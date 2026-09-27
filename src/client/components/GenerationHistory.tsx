"use client";

import { useServer } from "@/client/stores/server";
import type { ResolvedAsset } from "@/shared/model";
import { RequestAudit } from "./RequestAudit";
import { TextButton } from "./ui";

export function GenerationHistory({ asset }: { asset: ResolvedAsset }) {
  const projectId = useServer((state) => state.project?.id);
  const jobs = useServer((state) => state.jobs);
  const keys = useServer((state) => state.projectKeys);

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

  // An upload never went to a model: say where it came from instead of
  // showing an empty prompt.
  if (asset.origin === "uploaded") {
    return (
      <div className="text-[11px] leading-relaxed text-slate-400">
        <p className="text-slate-200">Uploaded, not generated.</p>
        <p>
          {asset.prompt.body ? <>From {asset.prompt.body}, </> : null}
          {asset.sourceWidth}×{asset.sourceHeight}, added{" "}
          {new Date(asset.createdAt).toLocaleString()}.
        </p>
      </div>
    );
  }

  return (
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
      actions={
        <TextButton
          title="Load this image's prompt, model, templates, and modes into the Generate panel"
          onClick={() => useServer.getState().restoreFromAsset(asset)}
        >
          use this setup
        </TextButton>
      }
    />
  );
}
