import type { RestoreWarning, RestoreWarningSeverity, RestoreWarningSummary, RestoreWarningSummaryExample } from "../shared/types.js";

const WARNING_EXAMPLE_LIMIT = 3;

type WarningSummaryMetadata = {
  severity: RestoreWarningSeverity;
  title: string;
  message: (count: number) => string;
};

const WARNING_METADATA: Record<string, WarningSummaryMetadata> = {
  restore_creates_new_content: info("恢复会创建新内容", "恢复会创建新的 Notion 页面和数据源，不会覆盖或回滚原内容"),
  backup_manifest_legacy_v1: info("旧版备份兼容", "备份 manifest 来自旧版本，部分新能力不会被假定可用"),
  comments_restore_not_requested: info("评论恢复未启用", "备份中存在评论，但本次恢复未启用评论恢复"),
  comment_parent_fallback_used: info("评论父级已降级", "部分评论缺少可识别父级，已恢复到对应页面"),
  data_source_title_schema_added: info("数据源标题属性已补齐", "数据源 schema 缺少标题属性，已自动添加默认 Name 标题属性"),

  comments_read_permission_missing: warning("评论读取权限缺失", "部分页面评论未备份，Notion token 缺少 Read comments 权限"),
  comments_insert_permission_missing: warning("评论写入权限缺失", "部分评论未恢复，Notion token 缺少 Insert comments 权限"),
  comments_backup_failed: warning("评论备份失败", "部分页面评论备份失败"),
  comment_restore_failed: warning("评论恢复失败", "部分评论恢复失败"),
  page_comments_missing: warning("页面评论缺失", "部分页面没有可恢复的评论备份"),
  data_source_comments_missing: warning("数据源条目评论缺失", "部分数据源条目没有可恢复的评论备份"),
  page_comments_unsupported: warning("页面评论格式不支持", "部分页面评论备份格式无法识别"),
  data_source_comments_unsupported: warning("数据源评论格式不支持", "部分数据源条目评论备份格式无法识别"),
  page_comments_read_failed: warning("页面评论读取失败", "部分页面评论读取失败"),
  comment_attachments_skipped: warning("评论附件已跳过", "评论附件恢复尚未实现，只恢复了评论文本"),
  comment_target_unmapped: warning("评论目标未映射", "部分评论所属页面或区块没有在本次恢复中映射"),
  comment_rich_text_missing: warning("评论文本缺失", "部分评论缺少可恢复的文本内容"),
  comment_mapping_missing: warning("评论映射缺失", "部分已创建评论没有返回可记录的新 ID"),
  comment_parent_missing: warning("评论父级缺失", "部分评论缺少可恢复的父级页面或区块"),

  restore_item_skipped: warning("备份项目已跳过", "部分备份项目不是成功状态，恢复时已跳过"),
  page_artifact_missing: warning("页面备份文件缺失", "部分页面备份文件不存在"),
  child_page_artifact_missing: warning("子页面备份文件缺失", "部分子页面备份文件不存在，已跳过"),
  data_source_schema_missing: warning("数据源 schema 缺失", "部分数据源 schema 备份文件不存在"),
  data_source_entries_missing: warning("数据源 entries 缺失", "部分数据源 entries 备份文件不存在"),

  page_property_skipped: warning("页面属性未恢复", "部分页面属性当前版本不会恢复，已跳过"),
  read_only_property_skipped: warning("只读属性未恢复", "只读或计算属性无法写入，已跳过"),
  relation_property_skipped: warning("关系属性未恢复", "关系属性当前版本不会恢复，已跳过"),
  relation_property_unresolved: warning("关系属性部分未映射", "部分关系属性引用的页面没有在本次恢复中映射"),
  page_property_schema_missing: warning("目标属性缺失", "目标数据源缺少部分可写属性，相关值已跳过"),
  people_property_skipped: warning("人员属性未恢复", "人员属性当前版本不会恢复，已跳过"),
  relation_schema_skipped: warning("关系 schema 未恢复", "关系类型的数据源属性 schema 已跳过"),
  data_source_schema_property_skipped: warning("数据源属性 schema 未恢复", "部分数据源属性 schema 当前版本不会恢复，已跳过"),

  rich_text_mention_downgraded: warning("富文本 mention 已降级", "部分 mention 或暂不支持富文本类型已降级为普通文本"),
  unsupported_block_type: warning("区块类型不支持", "部分区块类型当前版本暂不支持恢复，已跳过"),
  block_append_failed: warning("区块恢复失败", "部分区块恢复失败"),
  block_mapping_missing: warning("区块映射缺失", "部分区块没有返回可记录的新 ID"),
  page_cycle_skipped: warning("循环子页面已跳过", "检测到循环子页面引用，已跳过"),

  page_icon_skipped: warning("页面图标已跳过", "部分页面图标不是可直接恢复的格式，已跳过"),
  page_cover_skipped: warning("页面封面已跳过", "部分页面封面不是可直接恢复的格式，已跳过"),
  data_source_icon_skipped: warning("数据源图标已跳过", "部分数据源图标不是可直接恢复的格式，已跳过"),
  data_source_cover_skipped: warning("数据源封面已跳过", "部分数据源封面不是可直接恢复的格式，已跳过"),
  icon_skipped: warning("图标已跳过", "部分图标不是可直接恢复的格式，已跳过"),
  cover_skipped: warning("封面已跳过", "部分封面不是可直接恢复的格式，已跳过"),

  local_file_upload_not_implemented: warning("本地文件未上传", "部分 Notion 托管文件当前版本无法上传恢复，已跳过"),
  file_property_upload_not_implemented: warning("文件属性未上传", "部分文件属性包含 Notion 托管或本地文件，已跳过"),
  file_upload_source_missing: warning("文件来源缺失", "部分文件缺少可恢复的原始 URL，已跳过"),
  asset_manifest_missing: warning("资产 manifest 缺失", "本地资产 manifest 不存在，部分文件无法上传恢复"),
  asset_not_downloaded: warning("资产未下载", "备份中没有找到部分文件对应的本地资产"),
  asset_download_skipped: warning("资产备份时已跳过", "部分文件备份时未下载，恢复时已跳过"),
  asset_file_missing: warning("本地资产文件缺失", "部分本地资产文件不存在，已跳过"),
  file_upload_multipart_required: warning("大文件未上传", "部分文件超过单次上传限制，需要 multipart 上传，当前版本已跳过"),
  file_upload_failed: warning("文件上传失败", "部分文件上传到 Notion 失败，已跳过"),

  view_artifacts_missing: warning("视图 artifact 不可用", "备份未声明视图 artifact 能力，本次会跳过视图恢复"),
  data_source_views_artifact_missing: warning("数据源视图备份缺失", "部分数据源视图备份文件不存在或格式无效，已跳过视图"),
  data_source_views_artifact_failed: warning("数据源视图备份失败", "部分数据源视图备份读取失败，只会恢复可用视图"),
  data_source_views_artifact_partial: warning("数据源视图备份不完整", "部分数据源视图备份不完整，只会恢复已成功备份的视图"),
  data_source_views_list_failed: warning("数据源视图列表读取失败", "部分数据源视图列表读取失败"),
  data_source_view_reference_invalid: warning("数据源视图引用无效", "部分数据源视图引用缺少 ID，已跳过"),
  data_source_view_retrieve_failed: warning("数据源视图读取失败", "部分数据源视图读取失败"),
  data_source_property_mapping_failed: warning("数据源属性映射失败", "无法读取部分恢复后的数据源属性 ID，视图恢复会降级"),
  view_restore_database_missing: warning("视图目标 database 缺失", "Notion 未返回新 database ID，已跳过视图恢复"),
  view_type_unsupported: warning("视图类型不支持", "部分视图类型暂不支持恢复，已跳过"),
  view_property_mapping_missing: warning("视图属性未映射", "部分视图配置引用的属性无法映射，相关配置已跳过"),
  view_configuration_skipped: warning("视图配置已降级", "部分视图配置无法完整映射，已使用默认配置创建视图"),
  view_mapping_missing: warning("视图映射缺失", "部分已创建视图没有返回可记录的新 ID"),
  view_restore_failed: warning("视图恢复失败", "部分视图恢复失败")
};

export function summarizeRestoreWarnings(warnings: RestoreWarning[]): RestoreWarningSummary[] {
  const groups = new Map<
    string,
    {
      code: string;
      severity: RestoreWarningSeverity;
      title: string;
      count: number;
      order: number;
      examples: RestoreWarningSummaryExample[];
      seenExamples: Set<string>;
    }
  >();

  warnings.forEach((warningItem, index) => {
    const code = warningItem.code || "unknown_warning";
    const metadata = WARNING_METADATA[code] ?? fallbackMetadata(warningItem);
    const group = groups.get(code) ?? {
      code,
      severity: metadata.severity,
      title: metadata.title,
      count: 0,
      order: index,
      examples: [],
      seenExamples: new Set<string>()
    };
    group.count += 1;
    addExample(group, warningItem);
    groups.set(code, group);
  });

  return [...groups.values()]
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.order - right.order)
    .map((group) => {
      const metadata =
        WARNING_METADATA[group.code] ??
        ({
          severity: group.severity,
          title: group.title,
          message: (count: number) => (count === 1 ? group.examples[0]?.message ?? group.title : `${group.title}：${count} 项`)
        } satisfies WarningSummaryMetadata);
      return {
        code: group.code,
        severity: group.severity,
        title: group.title,
        message: metadata.message(group.count),
        count: group.count,
        examples: group.examples
      };
    });
}

function addExample(group: { examples: RestoreWarningSummaryExample[]; seenExamples: Set<string> }, warningItem: RestoreWarning): void {
  if (group.examples.length >= WARNING_EXAMPLE_LIMIT) {
    return;
  }
  const exampleKey = `${warningItem.message}|${warningItem.objectId ?? ""}|${warningItem.blockId ?? ""}`;
  if (group.seenExamples.has(exampleKey)) {
    return;
  }
  group.seenExamples.add(exampleKey);
  group.examples.push({
    message: warningItem.message,
    ...(warningItem.objectId ? { objectId: warningItem.objectId } : {}),
    ...(warningItem.blockId ? { blockId: warningItem.blockId } : {}),
    ...(warningItem.details !== undefined ? { details: warningItem.details } : {})
  });
}

function info(title: string, singleMessage: string): WarningSummaryMetadata {
  return {
    severity: "info",
    title,
    message: (count) => countMessage(singleMessage, count)
  };
}

function warning(title: string, singleMessage: string): WarningSummaryMetadata {
  return {
    severity: "warning",
    title,
    message: (count) => countMessage(singleMessage, count)
  };
}

function countMessage(singleMessage: string, count: number): string {
  return count === 1 ? singleMessage : `${singleMessage}：${count} 项`;
}

function fallbackMetadata(warningItem: Pick<RestoreWarning, "code" | "message">): WarningSummaryMetadata {
  const title = warningItem.code.split("_").filter(Boolean).join(" ") || "restore warning";
  return {
    severity: "warning",
    title,
    message: (count) => (count === 1 ? warningItem.message : `${warningItem.message}：${count} 项`)
  };
}

function severityRank(severity: RestoreWarningSeverity): number {
  return severity === "warning" ? 0 : 1;
}
