"use client";

import { useState } from "react";
import { api } from "@/client/api";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { Button, Panel, TextButton } from "./ui";

/**
 * Bug reports, feedback and feature requests, straight from the studio. What
 * is sent lands on the admin page with who sent it and from which project.
 */
export function FeedbackPanel() {
  const projectId = useServer((state) => state.project?.id ?? null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const send = async () => {
    const body = text.trim();
    if (!body || state === "sending") return;

    setState("sending");
    try {
      await api("/api/feedback", { method: "POST", body: JSON.stringify({ body, projectId }) });
      setText("");
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <Panel
      title="Feedback"
      actions={
        <TextButton
          title="Hide the feedback panel. The strip at the bottom of this column brings it back."
          onClick={() => useUi.getState().setFeedbackHidden(true)}
        >
          &times;
        </TextButton>
      }
    >
      <p className="mb-2 text-[11px] leading-snug text-slate-500">
        This software is in alpha development. Feel free to file bug reports, give feedback, or
        request features.
      </p>

      {state === "sent" ? (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-[12px] text-[var(--color-accent)]">Thanks for your comment.</p>
          <TextButton onClick={() => setState("idle")}>send another</TextButton>
        </div>
      ) : (
        <>
          <textarea
            value={text}
            rows={4}
            placeholder="Your comment"
            className="mb-2 resize-y"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void send();
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!text.trim() || state === "sending"}
              title="Send (Ctrl+Enter)"
              onClick={() => void send()}
            >
              {state === "sending" ? "sending..." : "send"}
            </Button>
            {state === "failed" ? (
              <span className="text-[11px] text-rose-300">Could not send. Try again?</span>
            ) : null}
          </div>
        </>
      )}
    </Panel>
  );
}
