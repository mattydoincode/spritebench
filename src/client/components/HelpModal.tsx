"use client";

import type { ReactNode } from "react";
import { HELP_TABS } from "@/client/help";
import { useUi } from "@/client/stores/ui";
import { Modal, PanelTab } from "./ui";

/** **bold** and [text](https://...) inside a line. Everything else is plain text. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));

    if (match[1] !== undefined) {
      parts.push(
        <strong key={at} className="font-semibold text-slate-100">
          {match[1]}
        </strong>
      );
    } else {
      parts.push(
        <a
          key={at}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          {match[2]}
        </a>
      );
    }
    last = at + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * The small Markdown the help files use: ## and ### headings, "- " bullets,
 * "1. " steps, and paragraphs split by blank lines. Enough for docs someone
 * edits by hand, without a dependency.
 */
function renderMarkdown(source: string): ReactNode[] {
  const blocks = source.trim().split(/\n\s*\n/);

  return blocks.map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const first = lines[0] ?? "";

    if (first.startsWith("## ")) {
      return (
        <h2 key={index} className="mb-3 text-xl font-semibold text-white">
          {inline(first.slice(3))}
        </h2>
      );
    }
    if (first.startsWith("### ")) {
      return (
        <h3 key={index} className="mt-5 mb-1.5 text-[15px] font-semibold text-slate-100">
          {inline(first.slice(4))}
        </h3>
      );
    }
    if (lines.every((line) => line.startsWith("- "))) {
      return (
        <ul key={index} className="mb-3 list-disc space-y-1.5 pl-5">
          {lines.map((line, item) => (
            <li key={item}>{inline(line.slice(2))}</li>
          ))}
        </ul>
      );
    }
    if (lines.every((line) => /^\d+\.\s/.test(line))) {
      return (
        <ol key={index} className="mb-3 list-decimal space-y-1.5 pl-5">
          {lines.map((line, item) => (
            <li key={item}>{inline(line.replace(/^\d+\.\s/, ""))}</li>
          ))}
        </ol>
      );
    }
    return (
      <p key={index} className="mb-3">
        {inline(lines.join(" "))}
      </p>
    );
  });
}

/** How SpriteBench works: an overview, then a tab per deeper topic. Copy lives in src/client/help/. */
export function HelpModal() {
  const tab = useUi((state) => state.helpTab) ?? HELP_TABS[0].id;
  const current = HELP_TABS.find((entry) => entry.id === tab) ?? HELP_TABS[0];

  return (
    <Modal
      title="Help"
      width={760}
      pinTop
      tabs={
        <>
          {HELP_TABS.map((entry) => (
            <PanelTab
              key={entry.id}
              selected={entry.id === current.id}
              onClick={() => useUi.getState().openHelp(entry.id)}
            >
              {entry.label}
            </PanelTab>
          ))}
        </>
      }
      onClose={() => useUi.getState().closeHelp()}
    >
      <div className="max-h-[65vh] overflow-y-auto px-2 py-1 text-sm leading-relaxed text-slate-300">
        {renderMarkdown(current.content)}
      </div>
    </Modal>
  );
}
