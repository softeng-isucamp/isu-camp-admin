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
const noop = () => {};
const digitsOf = (text: string) => text.replace(/\D/g, "");

export interface OtpInputHandle {
  /** Empties every box, removes any invalid marking and moves focus to the first box once the input is enabled. */
  clear: () => void;
  /**
   * Marks the code on screen as rejected: every box keeps its digit as an ordinary value, becomes `aria-invalid`, and focus
   * returns to the first box with its digit selected once the input is enabled. The first edit of any box removes the marking.
   */
  markRejected: () => void;
}

interface OtpInputProps {
  ref?: Ref<OtpInputHandle>;
  disabled?: boolean;
  /** Fires with the current digits joined together after every edit; shorter than 6 characters while incomplete. */
  onChange?: (code: string) => void;
  /**
   * Fires, at most once per input event, when an edit leaves all six boxes filled and either completed a code that was incomplete,
   * entered a digit in the last box, or was a paste. Changing a digit in boxes 1 to 5 of a complete code does not fire it.
   */
  onComplete?: (code: string) => void;
}

/** Six single-digit boxes for a one-time code. It does no networking; the parent decides what a code means. */
export function OtpInput({ ref, disabled = false, onChange, onComplete }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [rejected, setRejected] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const refocusFirst = useRef(false);

  useEffect(() => {
    if (!refocusFirst.current || disabled) return;
    refocusFirst.current = false;
    // Focus alone selects through onFocus, but not when box 1 already has focus.
    inputs.current[0]?.focus();
    inputs.current[0]?.select();
  }, [digits, rejected, disabled]);

  /** Applies an edit. `submit` says the edit may complete the entry; the code is only reported when it is full. */
  const commit = (next: string[], submit = false) => {
    setDigits(next);
    setRejected(false);
    const code = next.join("");
    onChange?.(code);
    if (submit && code.length === LENGTH) onComplete?.(code);
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      refocusFirst.current = true;
      commit(emptyDigits());
    },
    markRejected: () => {
      refocusFirst.current = true;
      setRejected(true);
    },
  }));

  const focusBox = (index: number) => inputs.current[index]?.focus();

  /** A paste, or several digits arriving at once: the whole entry is replaced, filling from the first box. */
  const fillFrom = (chars: string) => {
    const typed = chars.slice(0, LENGTH);
    commit([...typed.split(""), ...emptyDigits()].slice(0, LENGTH), true);
    // After one digit, the next box; after several, the last box they filled.
    focusBox(typed.length > 1 ? typed.length - 1 : Math.min(typed.length, LENGTH - 1));
  };

  // Disabled boxes never change: a browser can still deliver paste or input events to them, so the handlers refuse them too.
  const handleInput = (index: number, value: string) => {
    if (disabled) return;
    const clean = digitsOf(value);
    if (clean.length > 1) {
      fillFrom(clean);
      return;
    }
    const next = [...digits];
    next[index] = clean;
    // Completing the code, or entering its last digit, finishes an entry; fixing a digit in the middle of a full code does not.
    commit(next, !digits.every(Boolean) || index === LENGTH - 1);
    if (clean && index < LENGTH - 1) focusBox(index + 1);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (disabled) return;
    const pasted = digitsOf(event.clipboardData.getData("text"));
    if (pasted) fillFrom(pasted);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.key !== "Backspace" || digits[index] || index === 0) return;
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
          aria-invalid={rejected || undefined}
          // The input event, not change: it also fires when a digit is replaced by itself. React still wants an onChange for a controlled value.
          onChange={noop}
          onInput={(event) => handleInput(index, event.currentTarget.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
