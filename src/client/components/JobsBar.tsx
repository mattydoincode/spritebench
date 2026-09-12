"use client";

import { useEffect, useMemo, useState } from "react";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { batchElapsedSeconds, formatElapsed, jobElapsedSeconds } from "@/shared/jobTime";
import type { JobRecord, JobStatus } from "@/shared/model";
import { Button, Modal, Row, TextButton } from "./ui";

const VISIBLE_CHIPS = 5;

const STATUS_STYLES: Record<JobStatus, string> = {
  queued: "border-slate-600 text-slate-400",
  blocked: "border-slate-700 text-slate-500",
  running: "border-sky-600 text-sky-300",
  done: "border-emerald-700 text-emerald-300",
  error: "border-rose-700 text-rose-300",
  cancelled: "border-slate-700 text-slate-500"
};

interface JobBatch {
  key: string;
  label: string;
  jobs: JobRecord[];
  status: JobStatus;
  createdAt: string;
  active: boolean;
  counts: Record<JobStatus, number>;
}

function batchStatus(counts: Record<JobStatus, number>): JobStatus {
  if (counts.running > 0) return "running";
  if (counts.queued > 0) return "queued";
  if (counts.blocked > 0) return "blocked";
  if (counts.error > 0) return "error";
  if (counts.done > 0) return "done";
  return "cancelled";
}

function groupJobs(jobs: JobRecord[]): JobBatch[] {
  const batches = new Map<string, JobRecord[]>();

  for (const job of jobs) {
    const key = job.batchId ?? job.id;
    const existing = batches.get(key);
    if (existing) existing.push(job);
    else batches.set(key, [job]);
  }

  return [...batches.entries()]
    .map(([key, members]) => {
      const ordered = [...members].sort((a, b) => a.batchIndex - b.batchIndex);
      const counts: Record<JobStatus, number> = {
        queued: 0,
        blocked: 0,
        running: 0,
        done: 0,
        error: 0,
        cancelled: 0
      };

      for (const job of ordered) counts[job.status]++;

      return {
        key,
        label: ordered[0].label,
        jobs: ordered,
        status: batchStatus(counts),
        createdAt: ordered.reduce(
          (newest, job) => (job.createdAt > newest ? job.createdAt : newest),
          ordered[0].createdAt
        ),
        active: counts.queued > 0 || counts.blocked > 0 || counts.running > 0,
        counts
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function progressLabel(batch: JobBatch): string {
  if (batch.jobs.length === 1) return batch.status;

  const settled = batch.counts.done + batch.counts.error + batch.counts.cancelled;
  return `${settled}/${batch.jobs.length} ${batch.status}`;
}

function jobSize(job: JobRecord): string {
  if (job.resolvedSize) return `${job.resolvedSize.width}x${job.resolvedSize.height}`;
  return job.generation.useAutoSize
    ? "auto"
    : `${job.generation.size.width}x${job.generation.size.height}`;
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) return;

    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  return now;
}

function elapsedLabel(seconds: number | null): string | null {
  return seconds === null ? null : formatElapsed(seconds);
}

function BatchChip({
  batch,
  selected,
  now,
  onSelect
}: {
  batch: JobBatch;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const cancellable = batch.jobs.filter((job) => job.status === "queued" || job.status === "blocked");
  const elapsed = elapsedLabel(batchElapsedSeconds(batch.jobs, now));

  return (
    <div
      className={`flex min-w-[130px] max-w-[11.5rem] shrink items-center gap-2 rounded border px-2 py-1 text-[11px] ${
        STATUS_STYLES[batch.status]
      } ${selected ? "bg-[var(--color-ink-600)]" : ""}`}
    >
      <button
        type="button"
        title="Show the prompt, size, and any error for these jobs"
        onClick={onSelect}
        className="flex min-w-0 items-center gap-2"
      >
        <span className="truncate">{batch.label}</span>

        {batch.jobs.length > 1 ? (
          <span className="shrink-0 rounded bg-[var(--color-ink-600)] px-1 tabular-nums">
            &times;{batch.jobs.length}
          </span>
        ) : null}

        <span className="shrink-0 tabular-nums opacity-70">{progressLabel(batch)}</span>
        {elapsed ? <span className="shrink-0 tabular-nums opacity-70">{elapsed}</span> : null}
        {batch.counts.error > 0 ? <span className="shrink-0 font-bold">!</span> : null}
      </button>

      {cancellable.length > 0 ? (
        <TextButton
          danger
          title={
            cancellable.length > 1
              ? `Cancel the ${cancellable.length} jobs still queued here`
              : "Cancel this job"
          }
          onClick={() => {
            for (const job of cancellable) void useServer.getState().cancelJob(job.id);
          }}
        >
          &times;
        </TextButton>
      ) : null}
    </div>
  );
}

function JobRow({ job, showIndex, now }: { job: JobRecord; showIndex: boolean; now: number }) {
  const busy = useUi((state) => state.busy);
  const store = useServer.getState;

  const seconds = elapsedLabel(jobElapsedSeconds(job, now));

  return (
    <div className={`rounded border px-2 py-1 ${STATUS_STYLES[job.status]}`}>
      <Row className="justify-between">
        <span className="truncate text-[10px]">
          {showIndex ? `#${job.batchIndex} \u00b7 ` : ""}
          {job.status}
          {seconds ? ` \u00b7 ${seconds}` : ""}
          {job.assetIds.length > 0 ? ` \u00b7 ${job.assetIds.length} asset(s)` : ""}
        </span>

        <Row>
          {job.status === "queued" || job.status === "blocked" ? (
            <Button variant="ghost" onClick={() => void store().cancelJob(job.id)}>
              cancel
            </Button>
          ) : null}

          {job.status === "error" || job.status === "cancelled" ? (
            <Button
              disabled={busy !== null}
              title="Queue this prompt again with the same settings"
              onClick={() => void store().retryJob(job.id)}
            >
              retry
            </Button>
          ) : null}
        </Row>
      </Row>

      {job.error ? (
        <p className="mt-1 rounded border border-rose-900 bg-rose-950/40 px-2 py-1 font-mono text-[11px] leading-snug break-words text-rose-200 select-text">
          {job.error}
        </p>
      ) : null}
    </div>
  );
}

function BatchDetail({
  batch,
  now,
  onClose,
  bordered = true
}: {
  batch: JobBatch;
  now: number;
  onClose?: () => void;
  bordered?: boolean;
}) {
  const first = batch.jobs[0];

  return (
    <div
      className={`bg-[var(--color-ink-900)] px-3 py-2 ${
        bordered ? "border-b border-[var(--color-edge)]" : ""
      }`}
    >
      <Row className="mb-1 justify-between">
        <span className="truncate text-[11px] text-slate-200">
          {batch.label}
          {batch.jobs.length > 1 ? ` \u00d7${batch.jobs.length}` : ""}
        </span>

        <Row>
          <span className="shrink-0 text-[10px] text-slate-500">
            {first.generation.model} &middot; {jobSize(first)} &middot; {first.generation.quality}
            {first.folder ? ` \u00b7 ${first.folder}` : ""}
            {first.inputs?.loop ? " \u00b7 loop" : first.inputs?.chunk ? " \u00b7 chunk" : first.inputs ? " \u00b7 edit" : ""}
          </span>

          {onClose ? (
            <Button variant="ghost" onClick={onClose}>
              close
            </Button>
          ) : null}
        </Row>
      </Row>

      <div className="mb-1 flex flex-col gap-1">
        {batch.jobs.map((job) => (
          <JobRow key={job.id} job={job} showIndex={batch.jobs.length > 1} now={now} />
        ))}
      </div>

      <p className="max-h-24 overflow-y-auto text-[10px] leading-snug whitespace-pre-wrap text-slate-400 select-text">
        {first.composedPrompt}
      </p>
    </div>
  );
}

function matches(batch: JobBatch, query: string): boolean {
  if (query.length === 0) return true;

  const needle = query.toLowerCase();

  return batch.jobs.some((job) =>
    [
      job.label,
      job.composedPrompt,
      job.error ?? "",
      job.status,
      job.generation.model,
      job.folder,
      job.createdAt
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

function QueueHistory({
  batches,
  now,
  onClose
}: {
  batches: JobBatch[];
  now: number;
  onClose: () => void;
}) {
  const store = useServer.getState;
  const [query, setQuery] = useState("");

  const found = batches.filter((batch) => matches(batch, query));
  const finished = batches.filter((batch) => !batch.active).length;

  return (
    <Modal
      title={`Queue history \u00b7 ${batches.length} entr${batches.length === 1 ? "y" : "ies"}`}
      onClose={onClose}
      footer={
        <Row className="justify-between">
          <span className="text-[10px] text-slate-500">
            {finished} finished entr{finished === 1 ? "y" : "ies"} on disk
          </span>

          <Button
            disabled={finished === 0}
            title="Delete the finished job records from disk"
            onClick={() => void store().clearJobs()}
          >
            clear finished
          </Button>
        </Row>
      }
    >
      <input
        type="text"
        autoFocus
        spellCheck={false}
        placeholder="search prompts, labels, errors, models"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mb-3"
      />

      {found.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          {batches.length === 0 ? "nothing has been queued yet" : "no jobs match that search"}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {found.map((batch) => (
          <div
            key={batch.key}
            className="rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)]"
          >
            <BatchDetail batch={batch} now={now} bordered={false} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function JobsBar() {
  const jobs = useServer((state) => state.jobs);
  const error = useUi((state) => state.error);
  const notice = useUi((state) => state.notice);
  const store = useUi.getState;

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const batches = useMemo(() => groupJobs(jobs), [jobs]);
  const now = useNow(jobs.some((job) => job.status === "running"));

  const active = batches.filter((batch) => batch.active);
  const settled = batches.filter((batch) => !batch.active);
  const shown = [...active, ...settled].slice(0, Math.max(VISIBLE_CHIPS, active.length));
  const rolledOff = batches.length - shown.length;

  const selected = batches.find((batch) => batch.key === selectedKey) ?? null;

  return (
    <div className="relative z-10 shrink-0 border-t border-[var(--color-edge)] bg-[var(--color-ink-800)]">
      {error ? (
        <Row className="justify-between border-b border-rose-900 bg-rose-950/50 px-3 py-1.5">
          <span className="text-[11px] text-rose-200">{error}</span>
          <Button variant="ghost" onClick={() => store().setError(null)}>
            dismiss
          </Button>
        </Row>
      ) : null}

      {notice ? (
        <Row className="justify-between border-b border-emerald-900 bg-emerald-950/40 px-3 py-1.5">
          <span className="text-[11px] text-emerald-200">{notice}</span>
          <Button variant="ghost" onClick={() => store().setNotice(null)}>
            dismiss
          </Button>
        </Row>
      ) : null}

      {selected ? <BatchDetail batch={selected} now={now} onClose={() => setSelectedKey(null)} /> : null}

      <div className="flex items-center gap-2 px-3 py-2">
        <TextButton
          className="text-[11px] font-semibold tracking-wider uppercase"
          title="Open the full queue history"
          onClick={() => setShowHistory(true)}
        >
          Queue
        </TextButton>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {batches.length === 0 ? <span className="text-[11px] text-slate-600">idle</span> : null}

          {shown.map((batch) => (
            <BatchChip
              key={batch.key}
              batch={batch}
              now={now}
              selected={batch.key === selectedKey}
              onSelect={() => setSelectedKey(batch.key === selectedKey ? null : batch.key)}
            />
          ))}
        </div>

        <Button
          variant="ghost"
          className="shrink-0"
          title="Search everything that has ever been queued"
          onClick={() => setShowHistory(true)}
        >
          {rolledOff > 0 ? `history (+${rolledOff})` : "history"}
        </Button>
      </div>

      {showHistory ? (
        <QueueHistory batches={batches} now={now} onClose={() => setShowHistory(false)} />
      ) : null}
    </div>
  );
}
