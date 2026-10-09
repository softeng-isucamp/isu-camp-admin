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
}

export interface OtpInputProps {
  ref?: Ref<OtpInputHandle>;
  disabled?: boolean;
  /** Fires with the current digits joined together after every edit; shorter than 6 characters while incomplete. */
  onChange?: (code: string) => void;
  /** Fires once per distinct completed code, so the same code is never reported twice in a row. Only `clear` forgets the last code. */
  onComplete?: (code: string) => void;
}

/** Six single-digit boxes for a one-time code. It does no networking; the parent decides what a code means. */
export function OtpInput({ ref, disabled = false, onChange, onComplete }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(emptyDigits);
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
      commit(emptyDigits());
    },
  }));

  const focusBox = (index: number) => inputs.current[index]?.focus();

  const applyInput = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, "");
    if (clean.length > 1) {
      const chars = clean.slice(0, LENGTH).split("");
      commit([...chars, ...emptyDigits()].slice(0, LENGTH));
      focusBox(chars.length - 1);
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
          onChange={(event) => applyInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}
