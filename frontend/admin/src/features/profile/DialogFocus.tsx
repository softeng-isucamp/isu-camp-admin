import { KeyboardEvent, PropsWithChildren, useEffect, useRef } from 'react';

/**
 * Wraps a shared `Modal`, which does not manage focus: focuses the first field on
 * open, keeps Tab inside, returns focus to the trigger on close, and parks focus on
 * the close control while `busy` disables the fields.
 */
export function DialogFocus({ busy = false, children }: PropsWithChildren<{ busy?: boolean }>) {
  const trap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    trap.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => { if (busy) trap.current?.querySelector<HTMLElement>('.modal-close-btn')?.focus(); }, [busy]);
  const keepFocus = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const elements = Array.from(trap.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
    const first = elements[0], last = elements[elements.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div ref={trap} onKeyDown={keepFocus}>{children}</div>;
}
