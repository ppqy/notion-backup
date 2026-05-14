import { z } from "zod";
import { ADMIN_USERNAME_MIN_LENGTH, NOTION_TOKEN_PREFIX, PASSWORD_MIN_LENGTH } from "../shared/constants.js";
import type { SchedulePreset, SelectedContent } from "../shared/types.js";
import { badRequest } from "./errors.js";

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const createAdminSchema = z.object({
  username: z.string().trim().min(ADMIN_USERNAME_MIN_LENGTH, `用户名至少 ${ADMIN_USERNAME_MIN_LENGTH} 个字符`),
  password: z.string().min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 个字符`)
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  nextPassword: z.string().min(PASSWORD_MIN_LENGTH, `新密码至少 ${PASSWORD_MIN_LENGTH} 个字符`)
});

export const notionTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(10)
    .refine((value) => value.startsWith(NOTION_TOKEN_PREFIX), `Notion token 必须以 ${NOTION_TOKEN_PREFIX} 开头`)
});

export const manualAddSchema = z.object({
  input: z.string().trim().min(1)
});

export const selectedContentSchema = z.object({
  objectId: z.string().min(1),
  objectType: z.enum(["page", "data_source"]),
  title: z.string().min(1)
});

export const backupPlanInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  selectedContent: z.array(selectedContentSchema).default([]),
  scheduleEnabled: z.boolean().default(false),
  schedulePreset: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]).default("daily"),
  cronExpression: z.string().trim().nullable().optional(),
  timezone: z.string().trim().min(1).default("Asia/Shanghai"),
  includeComments: z.boolean().default(false),
  includeChildPages: z.boolean().default(true),
  downloadNotionFiles: z.boolean().default(true),
  mirrorExternalFiles: z.boolean().default(false),
  fileSizeLimitBytes: z.number().int().positive().nullable().default(100 * 1024 * 1024)
});

export type BackupPlanInput = z.infer<typeof backupPlanInputSchema>;

export function parseBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(localizedValidationMessage(result.error), result.error.flatten());
  }
  return result.data;
}

function localizedValidationMessage(error: z.ZodError): string {
  return error.issues.find((issue) => /[\u4e00-\u9fff]/.test(issue.message))?.message || "请求参数无效";
}

export function cronForPreset(preset: SchedulePreset, custom: string | null | undefined): string | null {
  switch (preset) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return "0 2 * * *";
    case "weekly":
      return "0 2 * * 1";
    case "monthly":
      return "0 2 1 * *";
    case "custom":
      return custom?.trim() || null;
  }
}

export function planMissingRequirements(
  input: Pick<BackupPlanInput, "selectedContent" | "scheduleEnabled" | "schedulePreset" | "cronExpression" | "timezone">,
  hasToken: boolean,
  mode: "manual" | "schedule"
): string[] {
  const missing: string[] = [];
  if (!hasToken) {
    missing.push("请先设置有效的 Notion token");
  }
  if (input.selectedContent.length === 0) {
    missing.push("请至少选择一个页面或数据源");
  }
  if (mode === "schedule") {
    if (!input.timezone) {
      missing.push("请设置时区");
    }
    if (!cronForPreset(input.schedulePreset, input.cronExpression)) {
      missing.push("请设置定时规则");
    }
  }
  return missing;
}

export function hasSelectedContent(value: SelectedContent[]): boolean {
  return value.length > 0;
}
