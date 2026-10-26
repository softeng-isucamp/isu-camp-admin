import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { services } from "../../services/api";
import type { AuditEntry } from "../../types";
import { formatDateTime } from "../../lib/format";
import { chooseFilterOption, filterOptionNames } from "../../test/filterCombobox";
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

// Logs reads ?q= and ?category= so User Management can link to one account's activity.
function renderLogs(initialEntry = "/system-logs") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}><Logs /></MemoryRouter>
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

describe("Logs deep links", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts filtered by the account named in the query string", async () => {
    const list = vi.spyOn(services.logs, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });

    renderLogs("/system-logs?q=maria.santos1&category=User");

    await waitFor(() => expect(list).toHaveBeenCalledWith("User", "maria.santos1", "All Actors", "all", 1, 10));
    expect(screen.getByPlaceholderText(/search actions/i)).toHaveValue("maria.santos1");
    expect(screen.getByRole("button", { name: "User Activity" })).toHaveClass("active");
  });

  it("ignores an unknown category and shows every log", async () => {
    const list = vi.spyOn(services.logs, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });

    renderLogs("/system-logs?category=Nonsense");

    await waitFor(() => expect(list).toHaveBeenCalledWith("All", "", "All Actors", "all", 1, 10));
  });
});

describe("Logs DATE filter", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists the date ranges with All Dates first", async () => {
    vi.spyOn(services.logs, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    renderLogs();

    expect(filterOptionNames("DATE")).toEqual(["All Dates", "Today", "Last 7 days", "Last 30 days"]);
  });

  it("filters the list by DATE and restores it when All Dates is chosen", async () => {
    const list = vi.spyOn(services.logs, "list").mockImplementation(async (_category, _q, _actor, date) => {
      const items = date === "7d" ? [entries[1]] : entries;
      return { items, total: items.length, page: 1, pageSize: 10 };
    });
    renderLogs();
    await screen.findByText("login");

    chooseFilterOption("DATE", "Last 7 days");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("All", "", "All Actors", "7d", 1, 10));
    await waitFor(() => expect(screen.queryByText("login")).not.toBeInTheDocument());
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(screen.getByLabelText("DATE")).toHaveTextContent("Last 7 days");

    chooseFilterOption("DATE", "All Dates");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("All", "", "All Actors", "all", 1, 10));
    expect(await screen.findByText("login")).toBeInTheDocument();
  });
});

describe("Logs search requests", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asks the server once typing pauses, not for every keystroke", async () => {
    const list = vi.spyOn(services.logs, "list").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    renderLogs();
    await waitFor(() => expect(list).toHaveBeenCalledWith("All", "", "All Actors", "all", 1, 10));

    await userEvent.type(screen.getByPlaceholderText(/search actions/i), "create");

    await waitFor(() => expect(list).toHaveBeenCalledWith("All", "create", "All Actors", "all", 1, 10));
    const searched = list.mock.calls.map((call) => call[1]).filter(Boolean);
    expect(searched).toEqual(["create"]);
  });
});
