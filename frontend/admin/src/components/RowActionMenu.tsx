import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { FittedPopover } from "./FittedPopover";

const ITEM = '[role="menuitem"]';

export interface RowActionMenuProps {
  /** The trigger's accessible name, such as "Actions for Maria". */
  label: string;
  /** Holds the trigger shut, for example while the table's rows are locked by a running operation. */
  disabled?: boolean;
  /** Styling and data attributes for the trigger; a dialog uses a data attribute to find its row again. */
  triggerProps?: { style?: CSSProperties } & { [attribute: `data-${string}`]: string };
  /** The menu's items: `role="menuitem"` buttons, with `role="separator"` between groups. */
  children: ReactNode;
}

/**
 * A table row's "•••" menu. Opening it focuses the first enabled item; the
 * arrow keys, Home and End move between enabled items (wrapping); Escape
 * closes it and returns focus to the trigger; Tab closes it. Choosing an item
 * closes it too, after returning focus to the trigger, so a dialog the item
 * opens remembers where to return. An outside click closes it.
 */
export function RowActionMenu({ label, disabled = false, triggerProps, children }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const isOpen = open && !disabled;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // An ArrowUp on the trigger opens the menu on its last item; every other opening starts at the first.
  const openOnLast = useRef(false);

  const enabledItems = () => {
    const menu = wrapperRef.current?.querySelector<HTMLElement>('[role="menu"]');
    return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM)).filter((item) => !(item as HTMLButtonElement).disabled) : [];
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;
    const items = enabledItems();
    (openOnLast.current ? items[items.length - 1] : items[0])?.focus();
    openOnLast.current = false;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen]);

  // flushSync: the menu must be gone before the browser moves focus on from the trigger, or a Tab would land on an item that is about to unmount.
  const closeMenu = (returnFocus: boolean) => {
    flushSync(() => setOpen(false));
    if (returnFocus) triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openOnLast.current = event.key === "ArrowUp";
    setOpen(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // The menu is the innermost thing open, so an enclosing dialog must not also close.
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu(true);
      return;
    }
    const items = enabledItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let target: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown": target = items[(index + 1) % items.length]; break;
      case "ArrowUp": target = index <= 0 ? items[items.length - 1] : items[index - 1]; break;
      case "Home": target = items[0]; break;
      case "End": target = items[items.length - 1]; break;
      default: return;
    }
    event.preventDefault();
    target?.focus();
  };

  // Runs before the item's own handler, so focus is on the trigger when that handler opens a dialog.
  const onMenuClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM);
    if (!item || (item as HTMLButtonElement).disabled) return;
    triggerRef.current?.focus();
    setOpen(false);
  };

  return (
    <div className="row-actions" ref={wrapperRef}>
      <button
        type="button"
        {...triggerProps}
        ref={triggerRef}
        className="table-action menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        •••
      </button>
      {isOpen && (
        <FittedPopover
          className="row-action-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          onClickCapture={onMenuClickCapture}
        >
          {children}
        </FittedPopover>
      )}
    </div>
  );
}
