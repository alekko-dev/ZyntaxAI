import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "./Overlay";
import { EVENTS, ipc, type AppSettings, type FixOutcome } from "@/lib/ipc";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload?: unknown) => void>(),
  settings: { personaId: "professional", appearance: { opacity: 100, theme: "dark" } },
}));

vi.mock("@/lib/ipc", () => ({
  EVENTS: { fixStarted: "started", fixCompleted: "completed", fixFailed: "failed" },
  on: vi.fn(async (event, handler) => {
    mocks.handlers.set(event, handler);
    return () => mocks.handlers.delete(event);
  }),
  toFixError: (error: unknown) => error,
  ipc: {
    getSettings: vi.fn(async () => mocks.settings),
    saveSettings: vi.fn(async (settings) => { mocks.settings = settings; return settings; }),
    getPersonas: vi.fn(async () => [
      { id: "professional", name: "Professional" }, { id: "friendly", name: "Friendly" },
    ]),
    runFix: vi.fn(async () => {}),
    retryFix: vi.fn(),
    applyFix: vi.fn(async () => {}),
    cancelFix: vi.fn(async () => {}),
    dismissOverlay: vi.fn(async () => {}),
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setSize: vi.fn(async () => {}) }),
  LogicalSize: class {},
}));

const outcome: FixOutcome = {
  original: "hello how are you", corrected: "Hello, how are you?",
  diff: [{ kind: "insert", text: "Hello, how are you?" }], changed: true,
  usage: { inputTokens: 10, outputTokens: 10 }, provider: "test", model: "test", elapsedMs: 1,
};
const failure = { code: "timeout", message: "Provider timed out", remedy: "Try again.", retryable: true };

async function showResult() {
  render(<Overlay />);
  act(() => mocks.handlers.get(EVENTS.fixCompleted)?.(outcome));
  await waitFor(() => expect((screen.getByRole("button", { name: "Professional" }) as HTMLButtonElement).disabled).toBe(true));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.settings = { personaId: "professional", appearance: { opacity: 100, theme: "dark" } };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("overlay retries", () => {
  it("switches style using the original text and keeps the preview while waiting", async () => {
    let complete!: (result: FixOutcome) => void;
    vi.mocked(ipc.retryFix).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await showResult();
    fireEvent.click(screen.getByRole("button", { name: "Friendly" }));
    await waitFor(() => expect(ipc.retryFix).toHaveBeenCalledWith(outcome.original));
    expect(ipc.runFix).not.toHaveBeenCalled();
    expect(mocks.settings.personaId).toBe("friendly");
    expect(screen.getByText(outcome.corrected)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(ipc.applyFix).not.toHaveBeenCalled();
    const friendly = { ...outcome, corrected: "Hey, how are you?", diff: [{ kind: "insert" as const, text: "Hey, how are you?" }] };
    await act(async () => complete(friendly));
    expect(screen.getByText(friendly.corrected)).toBeTruthy();
    vi.mocked(ipc.retryFix).mockResolvedValue(friendly);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(ipc.retryFix).toHaveBeenLastCalledWith(outcome.original));
  });

  it("keeps the previous result after a failed retry and can retry again", async () => {
    vi.mocked(ipc.retryFix).mockRejectedValueOnce(failure).mockResolvedValueOnce(outcome);
    await showResult();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(failure.message);
    expect(screen.getByText(outcome.corrected)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(failure.message)).toBeNull());
    expect(ipc.retryFix).toHaveBeenLastCalledWith(outcome.original);
  });

  it("keeps the result and recovers the style controls if saving settings fails", async () => {
    vi.mocked(ipc.saveSettings).mockRejectedValueOnce(failure);
    await showResult();
    fireEvent.click(screen.getByRole("button", { name: "Friendly" }));
    await screen.findByText(failure.message);
    expect(screen.getByText(outcome.corrected)).toBeTruthy();
    expect(ipc.retryFix).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Friendly" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ignores a retry that completes after a new hotkey request starts", async () => {
    let complete!: (result: FixOutcome) => void;
    vi.mocked(ipc.retryFix).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await showResult();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    act(() => mocks.handlers.get(EVENTS.fixStarted)?.());
    await act(async () => complete(outcome));
    expect(screen.queryByText(outcome.corrected)).toBeNull();
  });

  it("does not start an old style retry after a new hotkey request starts", async () => {
    let save!: (settings: AppSettings) => void;
    vi.mocked(ipc.saveSettings).mockImplementationOnce(() => new Promise(resolve => { save = resolve; }));
    await showResult();
    fireEvent.click(screen.getByRole("button", { name: "Friendly" }));
    await waitFor(() => expect(ipc.saveSettings).toHaveBeenCalled());
    act(() => mocks.handlers.get(EVENTS.fixStarted)?.());
    await act(async () => save(mocks.settings as AppSettings));
    expect(ipc.retryFix).not.toHaveBeenCalled();
    expect(ipc.runFix).not.toHaveBeenCalled();
  });

  it("ignores a retry failure after dismissing the overlay", async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(ipc.retryFix).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await showResult();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await act(async () => reject(failure));
    expect(ipc.cancelFix).toHaveBeenCalled();
    expect(ipc.dismissOverlay).toHaveBeenCalled();
    expect(screen.queryByText(failure.message)).toBeNull();
  });
});
