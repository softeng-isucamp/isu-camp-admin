import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterCombobox, type FilterComboboxOption } from "./FilterCombobox";

const statuses: FilterComboboxOption[] = [
  { id: "active", name: "Active" },
  { id: "inactive", name: "Inactive" },
  { id: "pending", name: "Pending" },
  { id: "paused", name: "Paused" },
];

const types: FilterComboboxOption[] = [
  { id: "college", name: "College", group: "Places" },
  { id: "food", name: "Food", group: "Places" },
  { id: "room", name: "Room", group: "Locations" },
  { id: "office", name: "Office", group: "Locations" },
];

function renderSelectOnly(options = statuses, onChange = vi.fn(), value: string | null = null) {
  const view = render(
    <FilterCombobox label="STATUS" noun="statuses" allLabel="All Statuses" searchable={false} options={options} value={value} onChange={onChange} />,
  );
  const rerender = (next: FilterComboboxOption[]) => view.rerender(
    <FilterCombobox label="STATUS" noun="statuses" allLabel="All Statuses" searchable={false} options={next} value={value} onChange={onChange} />,
  );
  return { field: screen.getByRole("combobox", { name: "STATUS" }), onChange, rerender };
}

const activeName = (field: HTMLElement) =>
  document.getElementById(field.getAttribute("aria-activedescendant") ?? "")?.querySelector(".parent-building-option-name")?.textContent;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FilterCombobox select-only field", () => {
  it("is a focusable combobox with its label as name, not a text box", () => {
    const { field } = renderSelectOnly();
    expect(screen.queryByRole("textbox", { name: "STATUS" })).toBeNull();
    expect(field.tagName).toBe("DIV");
    expect(field).toHaveAttribute("tabindex", "0");
    expect(field).toHaveAttribute("aria-haspopup", "listbox");
    expect(field).toHaveTextContent("All Statuses");
  });

  it("moves to the next option starting with the typed letter, with the list closed or open", () => {
    vi.useFakeTimers();
    const { field, onChange } = renderSelectOnly();
    const pause = () => act(() => { vi.advanceTimersByTime(600); });
    fireEvent.keyDown(field, { key: "i" });
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(activeName(field)).toBe("Inactive");

    pause();
    fireEvent.keyDown(field, { key: "p" });
    expect(activeName(field)).toBe("Pending");
    // Repeating a letter cycles through its matches, wrapping around.
    fireEvent.keyDown(field, { key: "p" });
    expect(activeName(field)).toBe("Paused");
    fireEvent.keyDown(field, { key: "p" });
    expect(activeName(field)).toBe("Pending");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("pending");
  });

  it("matches a quick multi-letter prefix and starts over after a pause", () => {
    vi.useFakeTimers();
    const { field } = renderSelectOnly();
    fireEvent.keyDown(field, { key: "p" });
    fireEvent.keyDown(field, { key: "a" });
    expect(activeName(field)).toBe("Paused");

    act(() => { vi.advanceTimersByTime(600); });
    // Fresh buffer: "a" moves on to the next option starting with A, not on from "pa".
    fireEvent.keyDown(field, { key: "a" });
    expect(activeName(field)).toBe("All Statuses");
  });

  it("types a space into a prefix in progress instead of choosing", () => {
    const { field, onChange } = renderSelectOnly([{ id: "week", name: "Last 7 days" }, { id: "month", name: "Last 30 days" }]);
    for (const key of ["l", "a", "s", "t", " ", "3"]) fireEvent.keyDown(field, { key });
    expect(activeName(field)).toBe("Last 30 days");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens on Home or End when closed and lands on the first or last option", () => {
    const { field } = renderSelectOnly();
    fireEvent.keyDown(field, { key: "End" });
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(activeName(field)).toBe("Paused");
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.keyDown(field, { key: "Home" });
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(activeName(field)).toBe("All Statuses");
  });

  it("steps ArrowUp from the shown highlight after the list shrinks while open", () => {
    const { field, rerender } = renderSelectOnly();
    fireEvent.keyDown(field, { key: "End" });
    expect(activeName(field)).toBe("Paused");
    rerender(statuses.slice(0, 1));
    // The highlight is clamped to the last remaining option, "Active".
    expect(activeName(field)).toBe("Active");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(activeName(field)).toBe("All Statuses");
  });
});

describe("FilterCombobox group headings", () => {
  it("puts each heading inside its own group and keeps it out of the options", () => {
    render(<FilterCombobox label="TYPE" noun="types" allLabel="All Types" searchable={false} options={types} value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "TYPE" }));
    const listbox = screen.getByRole("listbox");

    const places = within(listbox).getByRole("group", { name: "Places" });
    expect(within(places).getAllByRole("option").map((option) => option.textContent)).toEqual(["College", "Food"]);
    expect(within(places).getByText("Places")).not.toHaveAttribute("role", "option");
    expect(within(listbox).queryByRole("option", { name: "Places" })).toBeNull();
    expect(within(listbox).getByRole("group", { name: "Locations" })).toBeInTheDocument();
    // Every direct child of the listbox is an option or a group, never loose heading text.
    for (const child of Array.from(listbox.children)) expect(["option", "group"]).toContain(child.getAttribute("role"));
  });

  it("lists a group once, in order of first appearance, even when its options are interleaved", () => {
    const interleaved: FilterComboboxOption[] = [
      { id: "college", name: "College", group: "Places" },
      { id: "room", name: "Room", group: "Locations" },
      { id: "food", name: "Food", group: "Places" },
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<FilterCombobox label="TYPE" noun="types" allLabel="All Types" searchable={false} options={interleaved} value={null} onChange={vi.fn()} />);
    const field = screen.getByRole("combobox", { name: "TYPE" });
    fireEvent.click(field);

    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: "Places" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["College", "Food"]);
    // Keyboard order is the order on screen.
    const walked: Array<string | null | undefined> = [];
    for (let step = 0; step < 3; step += 1) {
      fireEvent.keyDown(field, { key: "ArrowDown" });
      walked.push(activeName(field));
    }
    expect(walked).toEqual(["College", "Food", "Room"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("FilterCombobox searchable field", () => {
  it("keeps a text input with a short placeholder and the full chosen name as its title", () => {
    const buildings: FilterComboboxOption[] = [{ id: "long", name: "College of Information Communication Technology Annex", code: "CICT" }];
    render(<FilterCombobox label="BUILDING" noun="buildings" allLabel="All Buildings" options={buildings} value="long" onChange={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "BUILDING" });
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("placeholder", "Search buildings…");
    expect(input).toHaveAttribute("title", "College of Information Communication Technology Annex");
  });
});
