import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapIssuesTray, type MapIssue } from "./MapIssuesTray";

const info: MapIssue = { id: "outside", severity: "info", title: "2 features outside boundary", body: "Legacy data is retained." };

function alertIssue(id: string, onClick = vi.fn()): MapIssue {
  return { id, severity: "alert", ariaLabel: `Alert ${id}`, title: `Title ${id}`, body: "Body", action: { label: `Fix ${id}`, onClick } };
}

describe("MapIssuesTray", () => {
  it("renders nothing without issues", () => {
    const { container } = render(<MapIssuesTray issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default and shows the issue count", () => {
    render(<MapIssuesTray issues={[info, alertIssue("a")]} />);

    const pill = screen.getByRole("button", { name: "Show map issues (2)" });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Title a")).not.toBeInTheDocument();
  });

  it("lists issues with alerts first and runs actions when the pill is clicked", () => {
    const onClick = vi.fn();
    render(<MapIssuesTray issues={[info, alertIssue("a", onClick)]} />);

    fireEvent.click(screen.getByRole("button", { name: "Show map issues (2)" }));

    expect(screen.getByRole("button", { name: "Show map issues (2)" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("alert", { name: "Alert a" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 features outside boundary");
    expect(screen.getByRole("alert", { name: "Alert a" }).compareDocumentPosition(screen.getByRole("status")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fix a" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close issues tray" }));
    expect(screen.queryByText("Title a")).not.toBeInTheDocument();
  });

  it("does not open by itself when a new alert appears", () => {
    const { rerender } = render(<MapIssuesTray issues={[info]} />);

    rerender(<MapIssuesTray issues={[info, alertIssue("new")]} />);

    expect(screen.getByRole("button", { name: "Show map issues (2)" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Title new")).not.toBeInTheDocument();
  });
});
