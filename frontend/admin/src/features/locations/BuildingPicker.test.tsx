import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuildingPicker } from "./BuildingPicker";

const buildings = [
  { id: "1", name: "Unnamed OSM building", code: "OSM way 111" },
  { id: "2", name: "Unnamed OSM building", code: "OSM way 222" },
];

const renderPicker = (value: string | null) =>
  render(
    <BuildingPicker
      buildings={buildings}
      value={value}
      onChange={vi.fn()}
      label="Association"
      noneLabel="No Building"
      clearLabel="Clear Building"
    />,
  );

describe("BuildingPicker", () => {
  it("keeps the identifier of a chosen Building visible once the list is closed", () => {
    renderPicker("2");

    const combobox = screen.getByRole("combobox", { name: "Association" });
    expect(combobox).toHaveValue("Unnamed OSM building");
    expect(combobox).toHaveAccessibleDescription("OSM way 222");
    expect(screen.queryByText("OSM way 111")).not.toBeInTheDocument();
  });

  it("shows no identifier when nothing is chosen", () => {
    renderPicker(null);

    expect(screen.getByRole("combobox", { name: "Association" })).not.toHaveAccessibleDescription();
  });
});
