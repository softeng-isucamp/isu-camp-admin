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

export interface OtpInputHandle {
  /** Empties every box and moves focus to the first one once the input is enabled. */
  clear: () => void;
  /**
   * Marks the digits on screen as a rejected code: the boxes empty, each shows its rejected digit as a placeholder and is `aria-invalid`,
   * and focus returns to the first box once the input is enabled. The shown digits are not values, so nothing typed or pasted can mix with them.
   * The first box to receive a value, or `clear`, removes them. Moving around changes nothing.
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
  // A rejected code shown as placeholders in the empty boxes; null when there is none.
  const [ghost, setGhost] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const lastCompleted = useRef<string | null>(null);
  const refocusFirst = useRef(false);

  useEffect(() => {
    if (!refocusFirst.current || disabled) return;
    refocusFirst.current = false;
    inputs.current[0]?.focus();
  }, [digits, disabled]);

  const commit = (next: string[]) => {
    setDigits(next);
    if (next.some(Boolean)) setGhost(null);
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
      refocusFirst.current = true;
      setGhost(null);
      commit(emptyDigits());
    },
    markRejected: () => {
      const rejected = digits.join("");
      refocusFirst.current = true;
      commit(emptyDigits());
      setGhost(rejected || null);
    },
  }));

  const focusBox = (index: number) => inputs.current[index]?.focus();

  /** A paste, or several digits arriving at once: the whole entry is replaced, filling from the first box. */
  const fillFrom = (chars: string) => {
    const typed = chars.slice(0, LENGTH);
    lastCompleted.current = null;
    commit([...typed.split(""), ...emptyDigits()].slice(0, LENGTH));
    // After one digit, the next box; after several, the last box they filled.
    focusBox(typed.length > 1 ? typed.length - 1 : Math.min(typed.length, LENGTH - 1));
  };

  const handleInput = (index: number, value: string) => {
    const clean = digitsOf(value);
    if (clean.length > 1) {
      fillFrom(clean);
      return;
    }
    const next = [...digits];
    next[index] = clean;
    commit(next);
    if (clean && index < LENGTH - 1) focusBox(index + 1);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = digitsOf(event.clipboardData.getData("text"));
    if (pasted) fillFrom(pasted);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
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
          placeholder={ghost?.[index]}
          aria-invalid={ghost !== null || undefined}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
