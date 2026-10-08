import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackStack, useFeedback } from "./Feedback";

function Harness() {
  const feedback = useFeedback();
  return (
    <div>
      <button type="button" onClick={() => feedback.reportSuccess("Hierarchy Room was added successfully.")}>
        report added
      </button>
      <button type="button" onClick={() => feedback.reportSuccess("Hierarchy Room was deleted successfully.")}>
        report deleted
      </button>
      <button type="button" onClick={() => feedback.reportError("Hierarchy Room could not be saved.")}>
        report failure
      </button>
      <FeedbackStack messages={feedback.messages} onDismiss={feedback.dismiss} />
    </div>
  );
}

describe("outcome reporting", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("reports each outcome in its own live region", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "report added" }));
    fireEvent.click(screen.getByRole("button", { name: "report deleted" }));

    const reported = screen.getAllByRole("status").map((element) => element.textContent);
    expect(reported).toEqual([
      expect.stringContaining("was added successfully."),
      expect.stringContaining("was deleted successfully."),
    ]);
  });

  it("reports a failure as an assertive alert", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "report failure" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Hierarchy Room could not be saved.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("refreshes a repeated outcome instead of stacking a duplicate", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "report added" }));
    act(() => void vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole("button", { name: "report added" }));

    expect(screen.getAllByRole("status")).toHaveLength(1);

    // The repeat restarted the delay, so the original 5 s deadline no longer applies.
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("dismisses a confirmation on its own and a failure on request", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "report added" }));
    fireEvent.click(screen.getByRole("button", { name: "report failure" }));

    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss error message/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing while no outcome has been reported", () => {
    const { container } = render(<FeedbackStack messages={[]} onDismiss={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
