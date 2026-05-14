import { CronExpressionParser } from "cron-parser";
import type { SchedulePreset } from "../shared/types.js";
import { cronForPreset } from "./validation.js";

export function nextRunAt(preset: SchedulePreset, cronExpression: string | null, timezone: string): string | null {
  const expression = cronForPreset(preset, cronExpression);
  if (!expression) {
    return null;
  }
  const interval = CronExpressionParser.parse(expression, {
    currentDate: new Date(),
    tz: timezone
  });
  return interval.next().toDate().toISOString();
}

export function validateSchedule(preset: SchedulePreset, cronExpression: string | null, timezone: string): string[] {
  const errors: string[] = [];
  if (!timezone) {
    errors.push("请设置时区");
  }
  try {
    nextRunAt(preset, cronExpression, timezone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "定时规则无效";
    errors.push(`定时规则无效：${message}`);
  }
  return errors;
}
