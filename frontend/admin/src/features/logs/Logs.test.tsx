import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import type { AuditEntry } from "../../types";
import { formatDateTime } from "../../lib/format";
import { Logs } from "./Logs";

const isoTimestamp = "2026-09-13T03:47:29.990831+00:00";
const fixtureTimestamp = "September 5, 2026 · 9:02 PM";
const readable = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
}).format(new Date(value.replace(" · ", " ")));

const entries: AuditEntry[] = [
  {
    id: "log-iso",
    actor: "user",
    action: "login",
    target: "Admin",
    createdAt: isoTimestamp,
    category: "System",
  },
  {
    id: "log-fixture",
    actor: "admin01",
    action: "create",
    target: "Route Node",
    createdAt: fixtureTimestamp,
    category: "Admin",
  },
];

function renderLogs() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Logs />
    </QueryClientProvider>,
  );
}

describe("formatDateTime", () => {
  it("formats ISO and fixture timestamps as readable local date/time values", () => {
    expect(formatDateTime(isoTimestamp)).toBe(readable(isoTimestamp));
    expect(formatDateTime(fixtureTimestamp)).toBe(readable(fixtureTimestamp));
    expect(formatDateTime(isoTimestamp)).not.toBe(isoTimestamp);
  });

  it("uses the em dash fallback for missing or invalid values", () => {
    expect(formatDateTime()).toBe("—");
    expect(formatDateTime("   ")).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("preserves the mock adapter's intentional relative timestamp", () => {
    expect(formatDateTime("Just now")).toBe("Just now");
  });
});

describe("Logs", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses normalized date/time values in the table and Log Details modal", async () => {
    vi.spyOn(services.logs, "list").mockResolvedValue({
      items: entries,
      total: entries.length,
      page: 1,
      pageSize: 20,
    });
    renderLogs();

    await screen.findByText("login");
    const table = screen.getByRole("table");
    expect(within(table).getByText(readable(isoTimestamp))).toBeInTheDocument();
    expect(within(table).getByText(readable(fixtureTimestamp))).toBeInTheDocument();
    expect(within(table).queryByText(isoTimestamp)).not.toBeInTheDocument();

    await userEvent.click(within(table).getAllByRole("button", { name: "View Details" })[0]);

    const dialog = await screen.findByRole("dialog", { name: "Log Details" });
    expect(within(dialog).getByText(readable(isoTimestamp))).toBeInTheDocument();
    expect(within(dialog).queryByText(isoTimestamp)).not.toBeInTheDocument();
  });
});
