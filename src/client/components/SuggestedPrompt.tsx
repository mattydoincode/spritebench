"use client";

import { useUi } from "@/client/stores/ui";
import { appendSuggestedPrompt } from "@/shared/featurePrompt";
import { TextButton } from "./ui";

export function SuggestedPrompt({ text }: { text: string }) {
  const promptBody = useUi((state) => state.promptBody);
  const add = text.trim();
  const already = add.length > 0 && promptBody.includes(add);

  return (
    <div className="mb-2 rounded border border-sky-800/80 bg-sky-950/40 px-1.5 py-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[10px] leading-snug text-slate-400" title={text}>
          {text}
        </span>
        <TextButton
          disabled={already || add.length === 0}
          title={already ? "This text is already in the prompt" : "Append this to the prompt box"}
          onClick={() => useUi.getState().setPromptBody(appendSuggestedPrompt(promptBody, text))}
        >
          {already ? "in prompt" : "copy suggested prompt"}
        </TextButton>
      </div>
    </div>
  );
}
