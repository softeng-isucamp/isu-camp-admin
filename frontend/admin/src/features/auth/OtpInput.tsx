import {
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const LENGTH = 6;
const emptyDigits = () => Array<string>(LENGTH).fill("");
const digitsOf = (text: string) => text.replace(/\D/g, "");

/** What an input event added to a box that already held `old`: the box's own text is not part of what was typed. */
const addedTo = (old: string, value: string) =>
  old && value.startsWith(old) ? value.slice(old.length) : old && value.endsWith(old) ? value.slice(0, -old.length) : value;

export interface OtpInputHandle {
  /** Empties every box and moves focus to the first one once the input is enabled. */
  clear: () => void;
  /**
   * Marks the digits on screen as a rejected code: they stay visible and `aria-invalid`, focus returns to the first box once the input is enabled,
   * and they count as stale. Moving around (arrows, Tab, a click) changes nothing. The first digit typed in any box, or Backspace or Delete,
   * then empties every box and starts again from the first box, so old and new digits never mix; a paste replaces them as usual.
   * The same code entered afterwards fires `onComplete` again.
   */
  markRejected: () => void;
}

interface OtpInputProps {
  ref?: Ref<OtpInputHandle>;
  disabled?: boolean;
  /** Fires with the current digits joined together after every edit; shorter than 6 characters while incomplete. */
  onChange?: (code: string) => void;
  /** Fires once per completed entry, so one entry is never reported twice. Making the code incomplete, `clear` and `markRejected` forget the last code. */
  onComplete?: (code: string) => void;
}

/** Six single-digit boxes for a one-time code. It does no networking; the parent decides what a code means. */
export function OtpInput({ ref, disabled = false, onChange, onComplete }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  // The digits are a rejected code kept on screen, not an entry in progress.
  const [stale, setStale] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const lastCompleted = useRef<string | null>(null);
  const refocusFirst = useRef(false);

  useEffect(() => {
    if (!refocusFirst.current || disabled) return;
    refocusFirst.current = false;
    inputs.current[0]?.focus();
  }, [digits, disabled, stale]);

  const commit = (next: string[]) => {
    setDigits(next);
    const code = next.join("");
    onChange?.(code);
    // An incomplete code ends the entry, so completing it again is a new one.
    if (code.length < LENGTH) lastCompleted.current = null;
    if (code.length === LENGTH && code !== lastCompleted.current) {
      lastCompleted.current = code;
      onComplete?.(code);
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      lastCompleted.current = null;
      refocusFirst.current = true;
      setStale(false);
      commit(emptyDigits());
    },
    markRejected: () => {
      lastCompleted.current = null;
      refocusFirst.current = true;
      setStale(true);
    },
  }));

  const focusBox = (index: number) => inputs.current[index]?.focus();

  /** Starts a fresh entry: every box empties, `chars` fill from the first box, and any rejected code is gone. */
  const startOver = (chars: string) => {
    const typed = chars.slice(0, LENGTH);
    setStale(false);
    lastCompleted.current = null;
    commit([...typed.split(""), ...emptyDigits()].slice(0, LENGTH));
    // After one digit, the next box; after a paste, the last box it filled.
    focusBox(typed.length > 1 ? typed.length - 1 : Math.min(typed.length, LENGTH - 1));
  };

  const handleInput = (index: number, value: string) => {
    if (stale) {
      // The box still shows its rejected digit; a letter typed over the rejected code changes nothing, deleting the box's text starts over.
      const typed = digitsOf(addedTo(digits[index], value));
      if (typed || !value) startOver(typed);
      return;
    }
    const clean = digitsOf(value);
    if (clean.length > 1) {
      startOver(clean);
      return;
    }
    const next = [...digits];
    next[index] = clean;
    commit(next);
    if (clean && index < LENGTH - 1) focusBox(index + 1);
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = digitsOf(event.clipboardData.getData("text"));
    if (!pasted) return;
    if (stale || pasted.length > 1) startOver(pasted);
    else handleInput(index, pasted);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (stale && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      startOver("");
      return;
    }
    // The keystroke itself is used because no input event fires when a selected digit is replaced by the same digit.
    // Keyboards that report no key (most touch ones) fall through to the input event.
    if (stale && /^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      startOver(event.key);
      return;
    }
    if (event.key !== "Backspace" || digits[index] || index === 0) return;
    const next = [...digits];
    next[index - 1] = "";
    commit(next);
    focusBox(index - 1);
  };

  return (
    <div className="segmented-code-container" role="group" aria-label="Verification code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          className="segmented-code-input"
          aria-label={`Digit ${index + 1} of ${LENGTH}`}
          value={digit}
          disabled={disabled}
          aria-invalid={stale || undefined}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
