import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowActionMenu } from "./RowActionMenu";

/** A row's menu: View, a disabled Locked item, a separator, Edit, and Delete. */
function renderMenu(onDelete = vi.fn(), onView = vi.fn()) {
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <RowActionMenu label="Actions for Ana" triggerProps={{ "data-row-trigger": "ana" }}>
              <button role="menuitem" onClick={onView}>View</button>
              <button role="menuitem" disabled>Locked</button>
              <div role="separator" />
              <button role="menuitem">Edit</button>
              <button role="menuitem" className="danger" onClick={onDelete}>Delete</button>
            </RowActionMenu>
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return { trigger: screen.getByRole("button", { name: "Actions for Ana" }), onDelete, onView };
}

const focusedLabel = () => document.activeElement?.textContent;

describe("RowActionMenu", () => {
  it("opens from its trigger, labels it as a menu button, and focuses the first enabled item", async () => {
    const { trigger } = renderMenu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-row-trigger", "ana");

    await userEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["View", "Locked", "Edit", "Delete"]);
    expect(focusedLabel()).toBe("View");
  });

  it("moves between enabled items with ArrowDown and ArrowUp, skipping disabled ones and wrapping", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Ana" }));

    await userEvent.keyboard("{ArrowDown}");
    expect(focusedLabel()).toBe("Edit");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedLabel()).toBe("Delete");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedLabel()).toBe("View");
    await userEvent.keyboard("{ArrowUp}");
    expect(focusedLabel()).toBe("Delete");
    await userEvent.keyboard("{ArrowUp}");
    expect(focusedLabel()).toBe("Edit");
  });

  it("jumps to the first and last enabled items with Home and End", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Ana" }));

    await userEvent.keyboard("{End}");
    expect(focusedLabel()).toBe("Delete");
    await userEvent.keyboard("{Home}");
    expect(focusedLabel()).toBe("View");
  });

  it("closes on Escape and returns focus to its trigger", async () => {
    const { trigger } = renderMenu();
    await userEvent.click(trigger);
    await userEvent.keyboard("{ArrowDown}");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes on Tab, so focus leaves the menu instead of cycling through its items", async () => {
    const { trigger } = renderMenu();
    await userEvent.click(trigger);

    await userEvent.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("opens from the keyboard with ArrowDown on the trigger, focusing the first item", async () => {
    const { trigger } = renderMenu();
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(focusedLabel()).toBe("View");
  });

  it("runs the chosen item and closes, returning focus to the trigger first", async () => {
    const { trigger, onDelete } = renderMenu();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("toggles closed when its trigger is clicked again and closes on an outside click", async () => {
    const { trigger } = renderMenu();
    await userEvent.click(trigger);
    await userEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not open while disabled", async () => {
    render(
      <RowActionMenu label="Actions for Ben" disabled>
        <button role="menuitem">View</button>
      </RowActionMenu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for Ben" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
