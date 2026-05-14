import { describe, expect, it } from "vitest";
import { NOTION_TOKEN_PREFIX, PASSWORD_MIN_LENGTH } from "../shared/constants.js";
import { createAdminSchema, cronForPreset, notionTokenSchema, parseBody, planMissingRequirements } from "./validation.js";

describe("notion token validation", () => {
  it("requires the current ntn_ token prefix", () => {
    expect(notionTokenSchema.safeParse({ token: `${NOTION_TOKEN_PREFIX}valid_token` }).success).toBe(true);
    expect(notionTokenSchema.safeParse({ token: "secret_legacy_token" }).success).toBe(false);
  });
});

describe("admin validation", () => {
  it("uses a specific message for short passwords", () => {
    const result = createAdminSchema.safeParse({ username: "admin", password: "admin" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(`密码至少 ${PASSWORD_MIN_LENGTH} 个字符`);
    }
  });

  it("surfaces localized request validation messages", () => {
    expect(() => parseBody(createAdminSchema, { username: "admin", password: "admin" })).toThrow(`密码至少 ${PASSWORD_MIN_LENGTH} 个字符`);
  });
});

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
