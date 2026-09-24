"use client";

import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { useNow } from "@/client/useNow";
import { isFailedJob } from "@/shared/libraryItems";
import { formatElapsed, jobElapsedSeconds } from "@/shared/jobTime";
import type { JobRecord, JobStatus } from "@/shared/model";
import { RequestAudit } from "./RequestAudit";
import { RightTabs } from "./RightTabs";
import { Button, Panel, Row } from "./ui";

const STATUS_STYLES: Record<JobStatus, string> = {
  queued: "text-slate-400",
  blocked: "text-slate-500",
  running: "text-sky-300",
  done: "text-emerald-300",
  error: "text-rose-300",
  cancelled: "text-slate-500"
};

export function JobInspector({ job }: { job: JobRecord }) {
  const projectId = useServer((state) => state.project?.id);
  const busy = useUi((state) => state.busy);
  const keys = useServer((state) => state.projectKeys);
  const store = useServer.getState;
  const now = useNow(job.status === "running");
  const elapsed = jobElapsedSeconds(job, now);
  const failed = isFailedJob(job.status);
  const cancellable = job.status === "queued" || job.status === "blocked";
  const key = job.providerKeyId
    ? (keys.find((entry) => entry.id === job.providerKeyId) ?? null)
    : null;

  return (
    <Panel title="Inspector" pane="right" lead={<RightTabs />}>
      <Row className="mb-2 justify-between">
        <span className={`text-[11px] ${STATUS_STYLES[job.status]}`}>
          {job.status}
          {elapsed !== null ? ` · ${formatElapsed(elapsed)}` : ""}
        </span>
        <span className="truncate text-[10px] text-slate-500">{job.label}</span>
      </Row>

      {job.error ? (
        <p className="mb-2 rounded border border-rose-900 bg-rose-950/40 px-2 py-1 font-mono text-[11px] leading-snug break-words text-rose-200 select-text">
          {job.error}
        </p>
      ) : null}

      <Row className="mb-3">
        {cancellable ? (
          <Button variant="ghost" onClick={() => void store().cancelJob(job.id)}>
            cancel
          </Button>
        ) : null}
        {failed ? (
          <>
            <Button
              disabled={busy !== null}
              title="Queue this prompt again with the same settings"
              onClick={() => void store().retryJob(job.id)}
            >
              retry
            </Button>
            <Button variant="ghost" onClick={() => void store().dismissJob(job.id)}>
              dismiss
            </Button>
          </>
        ) : null}
      </Row>

      <RequestAudit
        input={{
          prompt: job.prompt,
          composedPrompt: job.composedPrompt,
          generation: job.generation,
          inputs: job.inputs,
          sequencePlan: job.sequencePlan
        }}
        audit={{
          resolvedSize: job.resolvedSize,
          elapsedSeconds: elapsed,
          createdAt: job.createdAt,
          key,
          billedKeyId: job.providerKeyId
        }}
        projectId={projectId}
        jobId={job.id}
      />
    </Panel>
  );
}
