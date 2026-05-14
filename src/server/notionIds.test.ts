import { describe, expect, it } from "vitest";
import { compactNotionId, normalizeNotionId } from "./notionIds.js";

describe("notion id parsing", () => {
  it("normalizes compact Notion ids", () => {
    expect(normalizeNotionId("0123456789abcdef0123456789abcdef")).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  it("extracts ids from Notion urls", () => {
    expect(
      normalizeNotionId("https://www.notion.so/workspace/Test-0123456789abcdef0123456789abcdef?pvs=4")
    ).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  it("compacts normalized ids", () => {
    expect(compactNotionId("01234567-89ab-cdef-0123-456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
  });
});
