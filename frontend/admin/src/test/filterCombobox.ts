import { fireEvent, screen, within } from "@testing-library/react";

const optionName = (option: HTMLElement) => option.querySelector(".parent-building-option-name")?.textContent;

/** The option names a filter dropdown lists, in order (group headings are not options). Opens it by a click and closes it again. */
export function filterOptionNames(label: string) {
  const field = screen.getByLabelText(label);
  fireEvent.click(field);
  const names = within(screen.getByRole("listbox")).getAllByRole("option").map(optionName);
  fireEvent.keyDown(field, { key: "Escape" });
  return names;
}

/** Drives a select-only filter dropdown: open it, then pick the option by exact name. */
export function chooseFilterOption(label: string, name: string) {
  const field = screen.getByLabelText(label);
  if (field.getAttribute("aria-expanded") !== "true") fireEvent.click(field);
  const option = within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .find((candidate) => optionName(candidate) === name);
  if (!option) throw new Error(`No ${label} filter option named "${name}" is listed.`);
  fireEvent.click(option);
}
