import {
  type ClipboardEvent,
  type CompositionEvent,
  type InputEvent as ReactInputEvent,
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

/** What one input event did to a box. `ignore` leaves the box exactly as it was. */
type Edit = { kind: "bulk"; digits: string } | { kind: "digit"; digit: string } | { kind: "ignore" };

/**
 * Reads an edit of a box that held `old` (empty or one digit) and now reports `value`, with the caret at `caret` after the edit.
 * `inserted` is how many characters the event put in. Two or more is bulk input (autofill, a drop, a suggestion) and replaces the
 * whole code. Fewer is one digit: when the value grew, the character just before the caret is the new one, wherever the caret was
 * and whatever it equals; otherwise the box was replaced or emptied and the value is the digit.
 */
function interpretEdit(old: string, value: string, caret: number | null, inserted: number): Edit {
  if (inserted >= 2) {
    const bulk = digitsOf(value);
    return bulk.length >= 2 ? { kind: "bulk", digits: bulk } : bulk ? { kind: "digit", digit: bulk } : { kind: "ignore" };
  }
  if (value === "") return { kind: "digit", digit: "" };
  const typed = value.length > old.length ? value.charAt(Math.max(0, (caret ?? value.length) - 1)) : value;
  const digit = digitsOf(typed);
  return digit ? { kind: "digit", digit } : { kind: "ignore" };
}

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
  /** The id of an element that describes the code, such as its error. Set on the group, so the boxes keep their own names. */
  describedBy?: string;
  /** Fires with the current digits joined together after every edit; shorter than 6 characters while incomplete. */
  onChange?: (code: string) => void;
  /**
   * Fires, at most once per input event, when an edit leaves all six boxes filled and either completed a code that was incomplete,
   * entered a digit in the last box, or was a paste. Changing a digit in boxes 1 to 5 of a complete code does not fire it.
   */
  onComplete?: (code: string) => void;
}

/** Six single-digit boxes for a one-time code. It does no networking; the parent decides what a code means. */
export function OtpInput({ ref, disabled = false, describedBy, onChange, onComplete }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [rejected, setRejected] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const refocusFirst = useRef(false);
  // Text an IME is still composing in one box. It is shown as the box's value but is not part of the code until compositionend.
  const [composing, setComposing] = useState<{ index: number; text: string } | null>(null);
  // Some browsers report a composed digit again in a plain input event right after compositionend.
  const justComposed = useRef(false);

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

  /** Applies what an input event (or the end of a composition) did to box `index`, which held `digits[index]`. */
  const applyEdit = (index: number, input: HTMLInputElement, inserted: number) => {
    const old = digits[index];
    const edit = interpretEdit(old, input.value, input.selectionStart, inserted);
    if (edit.kind === "ignore") {
      // Not a digit: the box keeps what it held.
      input.value = old;
      return;
    }
    if (edit.kind === "bulk") {
      fillFrom(edit.digits);
      return;
    }
    const next = [...digits];
    next[index] = edit.digit;
    // Completing the code, or entering its last digit, finishes an entry; fixing a digit in the middle of a full code does not.
    commit(next, !digits.every(Boolean) || index === LENGTH - 1);
    if (edit.digit && index < LENGTH - 1) focusBox(index + 1);
  };

  // Disabled boxes never change: a browser can still deliver paste or input events to them, so the handlers refuse them too.
  const handleInput = (index: number, event: ReactInputEvent<HTMLInputElement>) => {
    if (disabled) return;
    const input = event.currentTarget;
    const native = event.nativeEvent;
    if (native.isComposing) {
      // Nothing is entered until the composition ends: no code change, no completion, no focus move.
      setComposing({ index, text: input.value });
      return;
    }
    if (justComposed.current) return;
    applyEdit(index, input, native.data ? native.data.length : input.value.length - digits[index].length);
  };

  const handleCompositionEnd = (index: number, event: CompositionEvent<HTMLInputElement>) => {
    const pending = composing;
    setComposing(null);
    if (disabled || pending?.index !== index) return;
    justComposed.current = true;
    setTimeout(() => {
      justComposed.current = false;
    }, 0);
    const input = event.currentTarget;
    applyEdit(index, input, event.data ? event.data.length : input.value.length - digits[index].length);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (disabled) return;
    const pasted = digitsOf(event.clipboardData.getData("text"));
    if (pasted) fillFrom(pasted);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.nativeEvent.isComposing || event.key !== "Backspace" || digits[index] || index === 0) return;
    const next = [...digits];
    next[index - 1] = "";
    commit(next);
    focusBox(index - 1);
  };

  return (
    <div className="segmented-code-container" role="group" aria-label="Verification code" aria-describedby={describedBy}>
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
          value={composing?.index === index ? composing.text : digit}
          disabled={disabled}
          aria-invalid={rejected || undefined}
          // The input event, not change: it also fires when a digit is replaced by itself. React still wants an onChange for a controlled value.
          onChange={noop}
          onInput={(event) => handleInput(index, event)}
          onCompositionEnd={(event) => handleCompositionEnd(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          // A click, or a tap, on a box that already has focus collapses the selection to a caret; select again so typing replaces.
          onClick={(event) => event.currentTarget.select()}
        />
      ))}
    </div>
  );
}
