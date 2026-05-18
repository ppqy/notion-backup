import { CheckCircle2, Loader2, Square, XCircle } from "lucide-react";
import type { BackupRunStatus, RestoreRunStatus } from "../shared/types";

type StatusBadgeStatus = BackupRunStatus | RestoreRunStatus | "failed" | "succeeded" | "running";
type StatusBadgeIcon = "success" | "failure" | "canceled" | "active";
type ItemStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export function statusBadgeIcon(status: StatusBadgeStatus): StatusBadgeIcon {
  if (status === "succeeded") {
    return "success";
  }
  if (status === "failed" || status === "partial_failed") {
    return "failure";
  }
  if (status === "canceled") {
    return "canceled";
  }
  return "active";
}

export function itemStatusBadgeStatus(status: ItemStatus): "running" | "succeeded" | "failed" | "canceled" {
  if (status === "succeeded" || status === "failed") {
    return status;
  }
  if (status === "skipped") {
    return "canceled";
  }
  return "running";
}

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  const icon = statusBadgeIcon(status);
  const element =
    icon === "success" ? (
      <CheckCircle2 />
    ) : icon === "failure" ? (
      <XCircle />
    ) : icon === "canceled" ? (
      <Square />
    ) : (
      <Loader2 className="spin" />
    );
  return <span className={`status-badge ${status}`}>{element}</span>;
}
