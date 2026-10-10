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

export interface OtpInputHandle {
  /** Empties every box and moves focus to the first one once the input is enabled. */
  clear: () => void;
  /**
   * Marks the digits on screen as a rejected code: they stay visible and `aria-invalid`, focus returns to the first box once the input is enabled,
   * and they count as stale. The first digit typed, or Backspace or Delete, then empties every box and starts again from the first box;
   * a paste replaces them as usual. The same code entered afterwards fires `onComplete` again.
   */
  markRejected: () => void;
}

interface OtpInputProps {
  ref?: Ref<OtpInputHandle>;
  disabled?: boolean;
  /** Fires with the current digits joined together after every edit; shorter than 6 characters while incomplete. */
  onChange?: (code: string) => void;
  /** Fires once per distinct completed code, so the same code is never reported twice in a row. `clear` and `markRejected` forget the last code. */
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

  /** Drops a stale code: every box empties and a typed digit, if any, lands in the first box. */
  const restart = (digit: string) => {
    setStale(false);
    lastCompleted.current = null;
    commit([digit, ...emptyDigits().slice(1)]);
    focusBox(digit ? 1 : 0);
  };

  const applyInput = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, "");
    if (clean.length > 1) {
      setStale(false);
      const chars = clean.slice(0, LENGTH).split("");
      commit([...chars, ...emptyDigits()].slice(0, LENGTH));
      focusBox(chars.length - 1);
      return;
    }
    if (stale) {
      // A letter typed over a rejected code changes nothing; deleting the box's text starts over.
      if (clean || !raw) restart(clean);
      return;
    }
    const next = [...digits];
    next[index] = clean;
    commit(next);
    if (clean && index < LENGTH - 1) focusBox(index + 1);
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text");
    if (pasted.replace(/\D/g, "")) applyInput(index, pasted);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (stale && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      restart("");
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
          onChange={(event) => applyInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
