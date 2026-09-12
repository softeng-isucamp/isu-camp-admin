import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MapLegend } from "./MapLegend";

describe("MapLegend", () => {
  it("minimizes and expands the legend", () => {
    render(<MapLegend />);

    expect(screen.getByText("Campus Location")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize map legend" }));

    expect(screen.queryByText("Campus Location")).not.toBeInTheDocument();
    const expandButton = screen.getByRole("button", { name: "Expand map legend" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expandButton);
    expect(screen.getByText("Campus Location")).toBeInTheDocument();
  });
});
