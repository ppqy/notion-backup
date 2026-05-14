import { appendFile } from "node:fs/promises";
import path from "node:path";

export class RunLogger {
  constructor(private readonly runDir: string) {}

  async write(level: "debug" | "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}): Promise<void> {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data
    });
    await appendFile(path.join(this.runDir, "logs.jsonl"), `${line}\n`, "utf8");
  }
}
