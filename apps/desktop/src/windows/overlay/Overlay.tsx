import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Check, CircleAlert, Copy, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { count, duration } from "@/lib/format";
import {
  EVENTS,
  ipc,
  on,
  toFixError,
  type FixError,
  type FixOutcome,
  type Persona,
} from "@/lib/ipc";
import type { DiffSegment } from "@/lib/bindings/DiffSegment";

type State =
  | { status: "working" }
  | { status: "done"; outcome: FixOutcome; retrying?: boolean; error?: FixError }
  | { status: "failed"; error: FixError };

const WIDTH = 560;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;

export function Overlay() {
  const [state, setState] = useState<State>({ status: "working" });
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [applied, setApplied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const renderedVersion = requestVersion.current;


  const dismiss = useCallback(() => {
    requestVersion.current++;
    void ipc.cancelFix();
    void ipc.dismissOverlay();
  }, []);

  const apply = useCallback(async () => {
    if (state.status !== "done" || state.retrying || applied) return;
    setApplied(true);
    try {
      await ipc.applyFix(state.outcome.corrected, state.outcome.original, "replace");


      setTimeout(() => void ipc.dismissOverlay(), 450);
    } catch {


      setApplied(false);
    }
  }, [state, applied]);

  const copy = useCallback(async () => {
    if (state.status !== "done" || state.retrying) return;
    await ipc.applyFix(state.outcome.corrected, state.outcome.original, "clipboard");
    dismiss();
  }, [state, dismiss]);

  const retry = useCallback(() => {
    if (requestVersion.current !== renderedVersion) return;
    if (state.status !== "done") {
      setState({ status: "working" });
      void ipc.runFix();
      return;
    }
    if (state.retrying) return;
    const version = ++requestVersion.current;
    const outcome = state.outcome;
    setApplied(false);
    setState({ status: "done", outcome, retrying: true });
    void ipc.retryFix(outcome.original).then(
      (next) => {
        if (requestVersion.current !== version) return;
        setState({ status: "done", outcome: next ?? outcome });
      },
      (error) => {
        if (requestVersion.current !== version) return;
        setState({ status: "done", outcome, error: toFixError(error) });
      },
    );
  }, [state, renderedVersion]);

  const showRetryError = useCallback((error: unknown) => {
    if (requestVersion.current !== renderedVersion) return;
    setState((current) => current.status === "done"
      ? { ...current, error: toFixError(error) }
      : current);
  }, [renderedVersion]);

  useEffect(() => {
    void ipc.getPersonas().then(setPersonas);


    void ipc.getSettings().then(({ appearance }) => {
      const root = document.documentElement;
      root.style.opacity = String(appearance.opacity / 100);

      if (appearance.theme === "system") {
        const light = window.matchMedia("(prefers-color-scheme: light)").matches;
        root.setAttribute("data-theme", light ? "light" : "dark");
      } else {
        root.setAttribute("data-theme", appearance.theme);
      }
    });
  }, []);

  useEffect(() => {
    const subscriptions = [
      on(EVENTS.fixStarted, () => {
        requestVersion.current++;
        setApplied(false);
        setState({ status: "working" });
      }),
      on<FixOutcome>(EVENTS.fixCompleted, (outcome) => setState({ status: "done", outcome })),
      on<FixError>(EVENTS.fixFailed, (error) => setState({ status: "failed", error })),
    ];
    return () => {
      requestVersion.current++;
      for (const subscription of subscriptions) {
        void subscription.then((off) => off());
      }
    };
  }, []);


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void apply();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apply, dismiss]);


  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const resize = () => {
      const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, card.scrollHeight + 16));
      void getCurrentWindow().setSize(new LogicalSize(WIDTH, height));
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    return () => observer.disconnect();
  }, [state]);

  return (
    <div className="flex h-full w-full items-start justify-center p-2">
      <div
        ref={cardRef}
        className="w-full overflow-hidden rounded-xl border border-line bg-surface shadow-overlay"
      >
        <header className="drag-region flex items-center gap-2 border-b border-line-subtle px-3 py-2">
          <span className="text-2xs font-medium tracking-wide text-faint uppercase">ZyntaxAI</span>

          {state.status === "done" ? (
            <PersonaSwitcher
              personas={personas}
              disabled={state.retrying ?? false}
              onSwitch={retry}
              onError={showRetryError}
            />
          ) : null}

          <div className="no-drag ml-auto flex items-center gap-1">
            {state.status !== "working" ? (
              <Button
                variant="ghost" size="sm" icon onClick={retry}
                disabled={state.status === "done" && state.retrying}
                aria-label="Try again"
              >
                <RotateCcw />
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" icon onClick={dismiss} aria-label="Dismiss">
              <X />
            </Button>
          </div>
        </header>

        {state.status === "working" ? <Working /> : null}
        {state.status === "failed" ? <Failure error={state.error} /> : null}
        {state.status === "done" ? (
          <>
            {state.retrying ? <Working /> : null}
            {state.error ? <Failure error={state.error} /> : null}
            <Result
              outcome={state.outcome} applied={applied} busy={state.retrying ?? false}
              onApply={apply} onCopy={copy}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Working() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-5">
      <span className="size-1.5 animate-skeleton rounded-full bg-accent" aria-hidden />
      <span className="text-sm text-muted">Correcting…</span>
      <span className="ml-auto text-2xs text-faint">Esc to cancel</span>
    </div>
  );
}

function Failure({ error }: { error: FixError }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-sm text-fg">{error.message}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{error.remedy}</p>
      </div>
    </div>
  );
}

function Result({
  outcome,
  applied,
  busy,
  onApply,
  onCopy,
}: {
  outcome: FixOutcome;
  applied: boolean;
  busy: boolean;
  onApply: () => void;
  onCopy: () => void;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const changes = outcome.diff.filter((segment) => segment.kind !== "equal").length;

  return (
    <>
      <div
        data-selectable
        className="scroll-area max-h-80 px-4 py-3.5 text-base leading-relaxed text-fg"
      >
        {outcome.changed ? (
          <Diff segments={outcome.diff} showRemoved={showRemoved} />
        ) : (
          <p className="text-muted">No changes needed — this already reads correctly.</p>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-line-subtle bg-raised px-3 py-2.5">
        <span data-numeric className="text-2xs text-faint">
          {count(outcome.usage.inputTokens + outcome.usage.outputTokens)} tokens &middot;{" "}
          {duration(outcome.elapsedMs)}
        </span>

        {outcome.changed ? (
          <button
            onClick={() => setShowRemoved((shown) => !shown)}
            className="text-2xs text-faint transition-colors duration-fast ease-out hover:text-muted"
          >
            {showRemoved ? "Hide what was removed" : `Show what was removed (${changes})`}
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCopy} disabled={busy}>
            <Copy />
            Copy
          </Button>
          <Button variant="primary" size="sm" onClick={onApply} disabled={applied || busy}>
            <Check />
            {applied ? "Applied" : "Apply"}
          </Button>
        </div>
      </footer>
    </>
  );
}


function Diff({ segments, showRemoved }: { segments: DiffSegment[]; showRemoved: boolean }) {
  return (
    <p className="whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (segment.kind === "equal") {
          return <span key={index}>{segment.text}</span>;
        }

        if (segment.kind === "delete") {
          if (!showRemoved) return null;
          return (
            <span
              key={index}
              className="rounded-sm bg-diff-del-bg px-0.5 text-diff-del line-through"
            >
              {segment.text}
            </span>
          );
        }

        return (
          <span key={index} className="rounded-sm bg-diff-add-bg px-0.5 text-diff-add">
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}


function PersonaSwitcher({
  personas,
  disabled,
  onSwitch,
  onError,
}: {
  personas: Persona[];
  disabled: boolean;
  onSwitch: () => void;
  onError: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    void ipc.getSettings().then((settings) => setActiveId(settings.personaId));
  }, []);

  return (
    <div className="no-drag flex items-center gap-0.5 overflow-x-auto">
      {personas.slice(0, 5).map((persona) => {
        const active = persona.id === activeId;
        return (
          <button
            key={persona.id}
            disabled={disabled || busy || active}
            aria-pressed={active}
            onClick={async () => {
              setBusy(true);
              try {
                const settings = await ipc.getSettings();
                await ipc.saveSettings({ ...settings, personaId: persona.id });
                setActiveId(persona.id);
                onSwitch();
              } catch (error) {
                onError(error);
              } finally {
                setBusy(false);
              }
            }}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-2xs whitespace-nowrap",
              "transition-colors duration-fast ease-out",
              active
                ? "bg-hover font-medium text-fg"
                : "text-faint hover:bg-hover/60 hover:text-muted",
              busy && "pointer-events-none opacity-50",
            )}
          >
            {persona.name}
          </button>
        );
      })}
    </div>
  );
}
