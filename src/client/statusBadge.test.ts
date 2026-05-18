import { describe, expect, it } from "vitest";
import { itemStatusBadgeStatus, statusBadgeIcon } from "./statusBadge";

describe("statusBadgeIcon", () => {
  it("uses a static canceled icon for canceled runs", () => {
    expect(statusBadgeIcon("canceled")).toBe("canceled");
  });

  it("keeps in-flight run states active", () => {
    expect(statusBadgeIcon("queued")).toBe("active");
    expect(statusBadgeIcon("running")).toBe("active");
    expect(statusBadgeIcon("cancel_requested")).toBe("active");
  });

  it("maps skipped detail items to canceled badges", () => {
    expect(itemStatusBadgeStatus("skipped")).toBe("canceled");
    expect(statusBadgeIcon(itemStatusBadgeStatus("skipped"))).toBe("canceled");
  });
});
