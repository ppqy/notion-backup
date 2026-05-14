import { describe, expect, it } from "vitest";
import { cronForPreset, planMissingRequirements } from "./validation.js";

describe("plan validation", () => {
  it("uses preset cron expressions", () => {
    expect(cronForPreset("daily", null)).toBe("0 2 * * *");
    expect(cronForPreset("custom", "*/10 * * * *")).toBe("*/10 * * * *");
  });

  it("allows manual runs without schedule fields", () => {
    const missing = planMissingRequirements(
      {
        selectedContent: [{ objectId: "id", objectType: "page", title: "Page" }],
        scheduleEnabled: false,
        schedulePreset: "custom",
        cronExpression: null,
        timezone: ""
      },
      true,
      "manual"
    );
    expect(missing).toEqual([]);
  });

  it("requires token, content, and schedule for scheduling", () => {
    const missing = planMissingRequirements(
      {
        selectedContent: [],
        scheduleEnabled: true,
        schedulePreset: "custom",
        cronExpression: null,
        timezone: ""
      },
      false,
      "schedule"
    );
    expect(missing).toEqual(["请先设置有效的 Notion token", "请至少选择一个页面或数据源", "请设置时区", "请设置定时规则"]);
  });
});
