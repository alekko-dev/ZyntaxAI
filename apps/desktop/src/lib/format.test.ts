import { describe, expect, it, vi, afterEach, afterAll } from "vitest";
import { cost, count, duration, relativeTime, timestamp } from "./format";

// These assertions use English text and separators, regardless of the runner's locale.
vi.hoisted(() => {
  const NumberFormat = Intl.NumberFormat;
  const RelativeTimeFormat = Intl.RelativeTimeFormat;
  vi.spyOn(Intl, "NumberFormat").mockImplementation(
    (locales, options) => new NumberFormat(locales ?? "en-US", options),
  );
  vi.spyOn(Intl, "RelativeTimeFormat").mockImplementation(
    (locales, options) => new RelativeTimeFormat(locales ?? "en-US", options),
  );
});

afterAll(() => vi.restoreAllMocks());

describe("count", () => {
  it("shows small numbers exactly", () => {
    expect(count(0)).toBe("0");
    expect(count(9_999)).toBe("9,999");
  });


  it("compacts large numbers so columns stay narrow", () => {
    const compact = count(1_500_000);
    expect(compact).not.toBe(count(1_499));
    expect(compact.length).toBeLessThan("1,500,000".length);
    expect(compact).toMatch(/1[.,]5/);
  });
});

describe("cost", () => {
  it("shows nothing spent as a clean zero", () => {
    expect(cost(0)).toBe("$0.00");
  });


  it("keeps precision below a cent", () => {
    expect(cost(0.0004)).toBe("$0.0004");
  });

  it("uses ordinary currency formatting above a cent", () => {
    expect(cost(12.3456)).toBe("$12.35");
  });
});

describe("duration", () => {
  it("uses milliseconds below a second", () => {
    expect(duration(840)).toBe("840ms");
  });

  it("switches to seconds above one", () => {
    expect(duration(1_240)).toBe("1.2s");
  });
});

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  it("reports never when there is nothing to report", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(undefined)).toBe("never");
  });

  it("treats the last few seconds as now", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const tenSecondsAgo = Math.floor(Date.now() / 1000) - 10;
    expect(relativeTime(tenSecondsAgo)).toBe("just now");
  });

  it("scales to the largest sensible unit", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const now = Math.floor(Date.now() / 1000);

    expect(relativeTime(now - 300)).toMatch(/5 minutes ago/);
    expect(relativeTime(now - 7_200)).toMatch(/2 hours ago/);
    expect(relativeTime(now - 172_800)).toMatch(/2 days ago/);
  });
});

describe("timestamp", () => {
  it("renders a real local date rather than a raw number", () => {
    const formatted = timestamp(1_767_268_800);
    expect(formatted).not.toMatch(/^\d+$/);
    expect(formatted.length).toBeGreaterThan(8);
  });
});
