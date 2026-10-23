import { KeyboardEvent, PropsWithChildren, useEffect, useRef } from 'react';

/** Candidates, in order, for where focus goes when the dialog closes. */
export type FocusReturn = () => (HTMLElement | null | undefined)[];
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)';
const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  !!element && element.isConnected && !(element as HTMLButtonElement).disabled;

/**
 * Wraps a shared `Modal`, which does not manage focus: focuses the first field (or switch) on
 * open, else the first action (the safe one, for a confirmation without fields), keeps Tab
 * inside, returns focus on close, and parks focus on the close control while `busy` disables
 * the fields. Focus returns to the first usable `returnTo` candidate, else to the element
 * focused before opening; callers whose opener disappears (a closed menu) pass `returnTo`.
 */
export function DialogFocus({ busy = false, returnTo, children }: PropsWithChildren<{ busy?: boolean; returnTo?: FocusReturn }>) {
  const trap = useRef<HTMLDivElement>(null);
  const returnToRef = useRef(returnTo);
  returnToRef.current = returnTo;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = trap.current;
    (dialog?.querySelector<HTMLElement>('input:not(:disabled), [role="switch"]:not(:disabled)')
      ?? dialog?.querySelector<HTMLElement>('.modal-actions button:not(:disabled)')
      ?? dialog?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => { [...(returnToRef.current?.() ?? []), previous].find(usable)?.focus(); };
  }, []);
  useEffect(() => { if (busy) trap.current?.querySelector<HTMLElement>('.modal-close-btn')?.focus(); }, [busy]);
  const keepFocus = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const elements = Array.from(trap.current!.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = elements[0], last = elements[elements.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div ref={trap} onKeyDown={keepFocus}>{children}</div>;
}
