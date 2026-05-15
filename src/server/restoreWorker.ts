import { getNotionToken } from "./repositories/notionRepository.js";
import { getRun } from "./repositories/runRepository.js";
import {
  claimNextQueuedRestoreRun,
  getRestoreRun,
  markRestoreItemsCanceled,
  restoreCancelRequested,
  updateRestoreRun,
  updateRestoreRunFromReport,
  updateRestoreRunItem
} from "./repositories/restoreRepository.js";
import { executeRestoreToNotion, RestoreCanceledError } from "./restore.js";
import { nowIso } from "./time.js";

export class RestoreWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      let restore = claimNextQueuedRestoreRun();
      while (restore) {
        await this.executeRun(restore.id);
        restore = claimNextQueuedRestoreRun();
      }
    } finally {
      this.running = false;
    }
  }

  private async executeRun(restoreRunId: string): Promise<void> {
    const restore = getRestoreRun(restoreRunId);
    const token = getNotionToken();
    if (!token) {
      this.failRestore(restoreRunId, "Notion token 未配置");
      return;
    }

    const restoreItemByObjectId = new Map(restore.items.map((item) => [item.objectId, item]));
    try {
      const sourceRun = getRun(restore.sourceRunId);
      const report = await executeRestoreToNotion({
        runId: sourceRun.id,
        targetParentId: restore.targetParentId,
        token,
        hooks: {
          restoreId: restore.restoreKey,
          shouldCancel: () => restoreCancelRequested(restoreRunId),
          onPhase: (phase, currentItemTitle) => {
            updateRestoreRun(restoreRunId, {
              current_phase: phase,
              current_item_title: currentItemTitle ?? null
            });
          },
          onItemStart: (item) => {
            const restoreItem = restoreItemByObjectId.get(item.objectId);
            if (!restoreItem) {
              return;
            }
            updateRestoreRunItem(restoreItem.id, {
              status: "running",
              started_at: nowIso()
            });
            updateRestoreRun(restoreRunId, {
              current_item_title: item.title
            });
          },
          onItemFinish: (item, result) => {
            const restoreItem = restoreItemByObjectId.get(item.objectId);
            if (!restoreItem) {
              return;
            }
            updateRestoreRunItem(restoreItem.id, {
              status: result.status,
              new_page_id: result.newPageId ?? null,
              new_data_source_id: result.newDataSourceId ?? null,
              warning_count: result.warningCount,
              error_message: result.error ?? null,
              finished_at: nowIso()
            });
          },
          onProgress: (report) => {
            updateRestoreRun(restoreRunId, {
              processed_items: report.items.length,
              failed_items: report.summary.failedItems,
              skipped_items: report.summary.skippedItems,
              warning_count: report.summary.warningCount,
              error_count: report.errors.length,
              created_pages: report.summary.createdPages,
              created_data_sources: report.summary.createdDataSources,
              created_blocks: report.summary.createdBlocks
            });
          }
        }
      });
      if (report.status === "canceled") {
        markRestoreItemsCanceled(restoreRunId, "用户取消，未执行");
      }
      updateRestoreRunFromReport(restoreRunId, report);
    } catch (error) {
      if (error instanceof RestoreCanceledError) {
        updateRestoreRun(restoreRunId, {
          status: "canceled",
          status_message: "用户已取消，已创建内容保留",
          current_phase: "已取消",
          current_item_title: null,
          finished_at: nowIso()
        });
        markRestoreItemsCanceled(restoreRunId, "用户取消，未执行");
        return;
      }
      const message = error instanceof Error ? error.message : "恢复失败";
      this.failRestore(restoreRunId, message);
    }
  }

  private failRestore(restoreRunId: string, message: string): void {
    updateRestoreRun(restoreRunId, {
      status: "failed",
      status_message: message,
      current_phase: "失败",
      current_item_title: null,
      error_count: 1,
      finished_at: nowIso()
    });
    markRestoreItemsCanceled(restoreRunId, "恢复失败，未执行");
  }
}
