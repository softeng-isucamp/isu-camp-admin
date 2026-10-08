import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../lib/format";

export type FeedbackTone = "success" | "error" | "info";

export interface FeedbackMessage {
  id: number;
  tone: FeedbackTone;
  text: string;
}

/** How long each tone stays on screen. A failure needs longer to read than a confirmation. */
const dismissDelays: Record<FeedbackTone, number> = {
  success: 5000,
  info: 5000,
  error: 9000,
};

let nextMessageId = 0;

/**
 * Outcome reporting for one page: "… was added successfully", "… was deleted
 * successfully", or the reason an action failed. Messages dismiss themselves so
 * a stale confirmation never describes the current state.
 */
export function useFeedback() {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const report = useCallback((tone: FeedbackTone, text: string) => {
    if (!text.trim()) return;
    const id = (nextMessageId += 1);
    // Repeating the same outcome refreshes the existing message instead of stacking a duplicate.
    setMessages((current) => [...current.filter((message) => message.text !== text), { id, tone, text }]);
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      setMessages((current) => current.filter((message) => message.id !== id));
    }, dismissDelays[tone]));
  }, []);

  const reportSuccess = useCallback((text: string) => report("success", text), [report]);
  const reportError = useCallback((text: string) => report("error", text), [report]);
  const reportInfo = useCallback((text: string) => report("info", text), [report]);

  const clear = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    setMessages([]);
  }, []);

  return { messages, report, reportSuccess, reportError, reportInfo, dismiss, clear };
}

export type Feedback = ReturnType<typeof useFeedback>;

const toneIcons: Record<FeedbackTone, string> = {
  success: "✓",
  error: "!",
  info: "i",
};

const toneLabels: Record<FeedbackTone, string> = {
  success: "Success",
  error: "Error",
  info: "Notice",
};

/** The stack of reported outcomes, anchored over the page it belongs to. */
export function FeedbackStack({
  messages,
  onDismiss,
  className,
}: {
  messages: FeedbackMessage[];
  onDismiss: (id: number) => void;
  className?: string;
}) {
  if (!messages.length) return null;
  return (
    <div className={cx("feedback-stack", className)}>
      {messages.map((message) => (
        <div
          key={message.id}
          className={cx("feedback-toast", `feedback-${message.tone}`)}
          role={message.tone === "error" ? "alert" : "status"}
          aria-live={message.tone === "error" ? "assertive" : "polite"}
        >
          <span className="feedback-icon" aria-hidden="true">{toneIcons[message.tone]}</span>
          <span className="feedback-text">{message.text}</span>
          <button
            type="button"
            className="feedback-dismiss"
            aria-label={`Dismiss ${toneLabels[message.tone].toLowerCase()} message`}
            onClick={() => onDismiss(message.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
