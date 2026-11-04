import { type InputHTMLAttributes, type ReactNode, type Ref, useId, useState } from "react";
import { CapsLockWarning, useCapsLock } from "../features/auth/capsLock";
import { PasswordVisibilityIcon } from "../features/auth/PasswordVisibilityIcon";
import { Field } from "./UI";

/** The show/hide button: a 32px hit area around the 18px glyph, with a visible focus ring. The one toggle every password field uses. */
function PasswordToggle({ name, shown, onToggle }: { name: string; shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="password-toggle" onClick={onToggle} aria-pressed={shown} aria-label={`Show ${name}`}>
      <PasswordVisibilityIcon shown={shown} />
    </button>
  );
}

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  /** Names the toggle: "Show {toggleName}". Defaults to the lower-cased label. */
  toggleName?: string;
  /**
   * `form`: the shared form Field (dialogs); `login`: the login card's field with its lock icon;
   * `recovery`: the recovery card's field.
   */
  variant?: "form" | "login" | "recovery";
  /** Decorative icon at the start of the input (login). */
  icon?: ReactNode;
  /** Form variant only: the error shown under the field. */
  error?: string;
  /** Form variant only: the helper line under the field. */
  subhelper?: string;
  /** Show its own Caps Lock warning under the input. Leave off when the caller already reports Caps Lock. */
  capsLockWarning?: boolean;
  ref?: Ref<HTMLInputElement>;
  /** Rendered under the input and its Caps Lock warning. */
  children?: ReactNode;
}

/** A labelled password input with its own show/hide toggle. Each field toggles separately. */
export function PasswordField({
  label,
  toggleName,
  variant = "form",
  icon,
  error,
  subhelper,
  capsLockWarning = false,
  ref,
  children,
  id: customId,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...input
}: PasswordFieldProps) {
  const generated = useId();
  const id = customId ?? generated;
  const [shown, setShown] = useState(false);
  const caps = useCapsLock();
  const toggle = <PasswordToggle name={toggleName ?? label.toLowerCase()} shown={shown} onToggle={() => setShown((on) => !on)} />;
  const type = shown ? "text" : "password";

  if (variant === "form") {
    return <Field {...input} id={id} type={type} label={label} error={error} subhelper={subhelper} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={onBlur} endAdornment={toggle} />;
  }

  const tracked = capsLockWarning
    ? {
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => { caps.onKeyDown(event); onKeyDown?.(event); },
        onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => { caps.onKeyUp(event); onKeyUp?.(event); },
        onBlur: (event: React.FocusEvent<HTMLInputElement>) => { caps.onBlur(event); onBlur?.(event); },
      }
    : { onKeyDown, onKeyUp, onBlur };
  return (
    <div className="field">
      <label className={variant === "recovery" ? "recovery-label" : "password-label"} htmlFor={id}>{label}</label>
      <div className={variant === "recovery" ? "recovery-password" : "password"}>
        {icon}
        <input {...input} {...tracked} id={id} ref={ref} type={type} />
        {toggle}
      </div>
      {capsLockWarning && <CapsLockWarning visible={caps.capsLockOn} />}
      {children}
    </div>
  );
}
