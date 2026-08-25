import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PropsWithChildren,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  useEffect,
  useId,
} from "react";
import { cx } from "../lib/format";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "subtle" | "danger" | "secondary";
  pill?: boolean;
}

export function Button({
  className,
  variant = "primary",
  pill = true,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        "btn",
        `btn-${variant}`,
        pill ? "btn-pill" : "",
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("card", className)} {...props} />;
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helper?: string;
  subhelper?: string;
  error?: string;
  badge?: string;
}

export function Field({
  label,
  helper,
  subhelper,
  error,
  badge,
  className,
  required,
  id: customId,
  ...props
}: FieldProps) {
  const sub = subhelper || helper;
  const id = customId || (label ? `field-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}` : undefined);
  return (
    <div className={cx("field-group", className)}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="field-required" aria-hidden="true">*</span>}
        </label>
        {badge && <span className="field-badge">{badge}</span>}
      </div>
      <input
        id={id}
        className={cx("field-input", error ? "field-input-error" : "")}
        required={required}
        {...props}
      />
      {sub && <span className="field-subhelper">{sub}</span>}
      {error && <span className="field-error-msg">{error}</span>}
    </div>
  );
}

export interface SelectFieldProps
  extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  helper?: string;
  subhelper?: string;
  badge?: string;
}

export function SelectField({
  label,
  helper,
  subhelper,
  badge,
  children,
  className,
  required,
  id: customId,
  ...props
}: PropsWithChildren<SelectFieldProps>) {
  const sub = subhelper || helper;
  const id = customId || (label ? `select-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}` : undefined);
  return (
    <div className={cx("field-group", className)}>
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="field-required">*</span>}
        </label>
        {badge && <span className="field-badge">{badge}</span>}
      </div>
      <div className="relative flex items-center">
        <select id={id} className="field-select pr-9 appearance-none" required={required} {...props}>
          {children}
        </select>
        <div className="pointer-events-none absolute right-3 text-[#5b716b]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {sub && <span className="field-subhelper">{sub}</span>}
    </div>
  );
}

export function Badge({
  children,
  tone = "green",
  className,
}: PropsWithChildren<{ tone?: string; className?: string }>) {
  return (
    <span className={cx("badge", `badge-${tone}`, className)}>
      {children}
    </span>
  );
}

export function Empty({ children }: PropsWithChildren) {
  return <div className="empty">{children}</div>;
}

export interface ModalProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "green" | "danger" | "neutral";
  className?: string;
}

export function Modal({
  title,
  subtitle,
  icon,
  children,
  onClose,
  size = "md",
  variant = "green",
  className,
}: PropsWithChildren<ModalProps>) {
  const titleId = useId();
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx("modal-card", `modal-${size}`, className)}>
        <div className={cx("modal-header", `modal-header-${variant}`)}>
          <div className="flex items-center gap-3.5">
            {icon && (
              <div className="modal-header-icon-badge">
                {icon}
              </div>
            )}
            <div className="modal-header-text">
              <h2 id={titleId}>{title}</h2>
              {subtitle && <p className="modal-subtitle">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              width="20"
              height="20"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({
  total,
  page = 1,
  pageSize = 20,
  onChange,
}: {
  total: number;
  page?: number;
  pageSize?: number;
  onChange?: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)}{" "}
        of {total}
      </span>
      <div>
        {Array.from({ length: Math.min(pages, 3) }, (_, i) => i + 1).map(
          (p) => (
            <button
              key={p}
              type="button"
              className={p === page ? "active" : ""}
              onClick={() => onChange?.(p)}
            >
              {p}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
