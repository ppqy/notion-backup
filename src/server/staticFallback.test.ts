import { describe, expect, it } from "vitest";
import { requestPathname, shouldServeClientIndex } from "./staticFallback.js";

describe("static fallback routing", () => {
  it("serves index.html only for client routes", () => {
    expect(shouldServeClientIndex("/")).toBe(true);
    expect(shouldServeClientIndex("/history")).toBe(true);
    expect(shouldServeClientIndex("/restore/run-1")).toBe(true);
  });

  it("does not serve html for missing api or static asset paths", () => {
    expect(shouldServeClientIndex("/api/session")).toBe(false);
    expect(shouldServeClientIndex("/healthz")).toBe(false);
    expect(shouldServeClientIndex("/assets/index-old.js")).toBe(false);
    expect(shouldServeClientIndex("/favicon.ico")).toBe(false);
  });

  it("parses paths before fallback decisions", () => {
    expect(requestPathname("/assets/index-old.js?v=1")).toBe("/assets/index-old.js");
  });
});
