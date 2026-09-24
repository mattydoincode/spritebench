"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  describeProcessElapsed,
  describeProcessQueue,
  MAX_PROCESS_WORKERS,
  MIN_PROCESS_WORKERS,
  processJobElapsed,
  processQueueCount,
  type ProcessJob
} from "@/client/processQueue";
import { NumberInput } from "./ui";
import { processor } from "@/client/processor";
import { useAssets } from "@/client/stores/assets";
import { useUi } from "@/client/stores/ui";
import { useNow } from "@/client/useNow";

function useProcessQueue() {
  return useSyncExternalStore(
    processor.subscribeQueue,
    processor.getQueueSnapshot,
    processor.getQueueSnapshot
  );
}

function jobLabel(job: ProcessJob, names: Map<string, string>): string {
  return names.get(job.assetId) ?? job.assetId.slice(0, 8);
}

function JobRow({
  job,
  label,
  now,
  onSelect
}: {
  job: ProcessJob;
  label: string;
  now: number;
  onSelect: (assetId: string) => void;
}) {
  const elapsed = describeProcessElapsed(processJobElapsed(job, now));
  const tone =
    job.status === "error"
      ? "text-rose-300"
      : job.status === "running"
        ? "text-sky-300"
        : job.status === "pending"
          ? "text-slate-400"
          : "text-slate-500";

  return (
    <button
      type="button"
      title={job.error ?? `${label} · ${job.variant}`}
      onClick={() => onSelect(job.assetId)}
      className={`flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-[var(--color-ink-700)] ${tone}`}
    >
      <span className="w-2 shrink-0 text-center text-[9px]">
        {job.status === "running" ? "▸" : job.status === "pending" ? "·" : job.status === "error" ? "!" : "✓"}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[9px] text-slate-500">{job.variant}</span>
      {elapsed ? <span className="shrink-0 tabular-nums text-[9px] text-slate-500">{elapsed}</span> : null}
    </button>
  );
}

export function ProcessDock() {
  const snapshot = useProcessQueue();
  const assets = useAssets();
  const error = useUi((state) => state.error);
  const notice = useUi((state) => state.notice);
  const processWorkers = useUi((state) => state.processWorkers);
  const [open, setOpen] = useState(false);
  const count = processQueueCount(snapshot);
  const now = useNow(open || count > 0);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) map.set(asset.id, asset.label);
    return map;
  }, [assets]);

  const summary =
    count > 0 ? describeProcessQueue(snapshot) : error ? error : notice ? notice : "idle";

  const select = (assetId: string) => {
    useUi.getState().select(assetId, false);
    useUi.getState().setRightTab("inspector");
  };

  const tone =
    count > 0
      ? "text-sky-200"
      : error
        ? "text-rose-200"
        : notice
          ? "text-emerald-200"
          : "text-slate-400";

  const border =
    count > 0
      ? "border-sky-900"
      : error
        ? "border-rose-900"
        : notice
          ? "border-emerald-900"
          : "border-[var(--color-edge)]";

  return (
    <div className="pointer-events-none absolute right-2 bottom-2 z-40 flex max-h-[min(420px,50vh)] w-max max-w-[min(280px,calc(100vw-1rem))] flex-col items-end justify-end">
      <div
        className={`pointer-events-auto flex min-w-[7.5rem] max-w-full flex-col-reverse overflow-hidden rounded-lg border bg-[var(--color-ink-800)]/95 shadow-xl backdrop-blur-sm ${border} ${
          open ? "w-[260px]" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          title={open ? "Hide processing" : "Show processing"}
          className={`flex items-center gap-2 px-2 py-1 text-left ${tone}`}
        >
          <span className="min-w-0 flex-1 truncate text-[10px] tracking-wide uppercase">{summary}</span>
          <span className="shrink-0 text-[10px] text-slate-500" aria-hidden>
            {open ? "\u25be" : "\u25b8"}
          </span>
        </button>

        {open ? (
          <div className="min-h-0 flex-1 overflow-y-auto border-b border-[var(--color-edge)] px-1.5 py-1.5 text-[10px]">
            {error ? (
              <div className="mb-2 flex items-start justify-between gap-2 rounded bg-rose-950/50 px-1.5 py-1 text-rose-200">
                <span className="min-w-0 leading-snug">{error}</span>
                <button
                  type="button"
                  className="shrink-0 text-rose-300 hover:text-white"
                  onClick={() => useUi.getState().setError(null)}
                >
                  dismiss
                </button>
              </div>
            ) : null}

            {notice ? (
              <div className="mb-2 flex items-start justify-between gap-2 rounded bg-emerald-950/40 px-1.5 py-1 text-emerald-200">
                <span className="min-w-0 leading-snug">{notice}</span>
                <button
                  type="button"
                  className="shrink-0 text-emerald-300 hover:text-white"
                  onClick={() => useUi.getState().setNotice(null)}
                >
                  dismiss
                </button>
              </div>
            ) : null}

            <label className="mb-1.5 flex items-center gap-2 px-1 text-slate-400">
              <span className="min-w-0 flex-1">workers</span>
              <NumberInput
                integer
                min={MIN_PROCESS_WORKERS}
                max={MAX_PROCESS_WORKERS}
                value={processWorkers}
                width={40}
                title={`${MIN_PROCESS_WORKERS}–${MAX_PROCESS_WORKERS} local process threads`}
                onChange={(value) => useUi.getState().setProcessWorkers(value)}
              />
            </label>

            {count === 0 && snapshot.recent.length === 0 ? (
              <p className="px-1 py-1 text-slate-500">nothing in flight</p>
            ) : null}

            {snapshot.active.length + snapshot.pending.length > 0 ? (
              <div className="mb-1.5">
                {snapshot.active.map((job) => (
                  <JobRow key={job.id} job={job} label={jobLabel(job, names)} now={now} onSelect={select} />
                ))}
                {snapshot.pending.map((job) => (
                  <JobRow key={job.id} job={job} label={jobLabel(job, names)} now={now} onSelect={select} />
                ))}
              </div>
            ) : null}

            {snapshot.recent.length > 0 ? (
              <div>
                <div className="px-1 pt-1 pb-0.5 text-[9px] tracking-wider text-slate-600 uppercase">
                  recent
                </div>
                {snapshot.recent.map((job) => (
                  <JobRow key={`${job.id}-done`} job={job} label={jobLabel(job, names)} now={now} onSelect={select} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
