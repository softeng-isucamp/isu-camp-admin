import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MapLegend } from "./MapLegend";

describe("MapLegend", () => {
  it("starts minimized, then expands and minimizes", () => {
    render(<MapLegend />);

    expect(screen.queryByText("Campus Location")).not.toBeInTheDocument();
    const expandButton = screen.getByRole("button", { name: "Expand map legend" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expandButton);
    expect(screen.getByText("Campus Location")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Minimize map legend" }));
    expect(screen.queryByText("Campus Location")).not.toBeInTheDocument();
  });

  it("lists a swatch for each Way type", () => {
    render(<MapLegend />);
    fireEvent.click(screen.getByRole("button", { name: "Expand map legend" }));

    expect(screen.getByText("Walkway").previousElementSibling).toHaveClass("border-dashed", "border-[#005931]");
    expect(screen.getByText("Road").previousElementSibling).toHaveClass("border-[#1d4ed8]");
    expect(screen.getByText("Road").previousElementSibling).not.toHaveClass("border-dashed");
    expect(screen.queryByText("Walking Path")).not.toBeInTheDocument();
  });

  it("gives way to an open inspector, honours an explicit expand over it, and restores the choice afterwards", () => {
    const { rerender } = render(<MapLegend />);
    fireEvent.click(screen.getByRole("button", { name: "Expand map legend" }));
    expect(screen.getByText("Campus Location")).toBeInTheDocument();

    rerender(<MapLegend yieldToInspector />);
    expect(screen.queryByText("Campus Location")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand map legend" })).toHaveAttribute("aria-expanded", "false");

    rerender(<MapLegend />);
    expect(screen.getByText("Campus Location")).toBeInTheDocument();
  });

  it("keeps an expand made while the inspector is open until it closes", () => {
    const { rerender } = render(<MapLegend yieldToInspector />);
    fireEvent.click(screen.getByRole("button", { name: "Expand map legend" }));
    expect(screen.getByText("Campus Location")).toBeInTheDocument();

    rerender(<MapLegend yieldToInspector={false} />);
    expect(screen.getByText("Campus Location")).toBeInTheDocument();
  });
});
