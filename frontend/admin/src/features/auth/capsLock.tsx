import { useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

/**
 * Tracks Caps Lock while a password field is focused. Browsers only report the
 * state on key events, so nothing shows until the first key press, and it
 * clears on blur.
 *
 * Spread onto a plain input, or call `onBlur` from your own blur handler when
 * the input already has one (react-hook-form's `register` returns `onBlur`):
 *
 *   const capsLock = useCapsLock();
 *   const field = register("password");
 *   <input {...field} onBlur={(e) => { void field.onBlur(e); capsLock.onBlur(); }}
 *          onKeyDown={capsLock.onKeyDown} onKeyUp={capsLock.onKeyUp} />
 *   <CapsLockWarning visible={capsLock.capsLockOn} />
 */
export function useCapsLock() {
  const [capsLockOn, setCapsLockOn] = useState(false);
  const read = (event: KeyboardEvent<HTMLElement>) => setCapsLockOn(event.getModifierState("CapsLock"));
  return {
    capsLockOn,
    onKeyDown: read,
    onKeyUp: read,
    onBlur: (_event?: FocusEvent<HTMLElement>) => setCapsLockOn(false),
  };
}

/** Always rendered so screen readers announce the text when it appears. */
export function CapsLockWarning({ visible }: { visible: boolean }) {
  return (
    <span className="caps-lock-warning" role="status">
      {visible ? "Caps Lock is on" : ""}
    </span>
  );
}
