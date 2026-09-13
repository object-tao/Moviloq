import type { Role, ResourceRow, DocumentRow, ConfigRow } from "../shared/operations";
import { publishedConfigs } from "./public-config";

export class OpsError extends Error {
  constructor(public code: string, public status: 403 | 404 | 409 | 413 | 422 = 422) { super(code); }
}
export async function revision(db: D1Database) {
  const row = await db.prepare("SELECT revision FROM ops_meta WHERE id = 1").first<{ revision: number }>();
  if (!row) throw new Error("Operations migration missing");
  return row.revision;
}
export type Change = { sql: string; values: (string | number | null | ArrayBuffer)[] };
export type Actor = { id: string; role: Role };
export const guard = "EXISTS (SELECT 1 FROM ops_meta WHERE id = 1 AND last_event_id = ?)";
// Global revision is deliberately conservative for this small preparation workspace.
// Read it BEFORE validation reads. The guarded D1 transaction then prevents TOCTOU
// races across documents, policies, fleet membership, pairing and review decisions.
export async function mutate(db: D1Database, expectedRevision: number, actor: Actor, event: { action: string; type: string; id: string; reason: string; before?: unknown; after?: unknown }, changes: Change[]) {
  const eventId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare("UPDATE ops_meta SET revision = revision + 1, last_event_id = ? WHERE id = 1 AND revision = ?").bind(eventId, expectedRevision),
    ...changes.map(change => db.prepare(change.sql).bind(...change.values, eventId)),
    db.prepare(`INSERT INTO ops_events (id,actor_id,actor_role,action,resource_type,resource_id,reason,before_json,after_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(eventId, actor.id, actor.role, event.action, event.type, event.id, event.reason, event.before === undefined ? null : JSON.stringify(event.before), event.after === undefined ? null : JSON.stringify(event.after), new Date().toISOString(), eventId),
  ]);
  if (results[0].meta.changes !== 1) throw new OpsError("VERSION_CONFLICT", 409);
}
export const docColumns = "id,resource_id,document_type,expires_on,status,filename,mime_type,byte_length,sequence,version,created_at,updated_at";
export async function getResource(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM ops_resources WHERE id = ?").bind(id).first<ResourceRow>();
  if (!row) throw new OpsError("NOT_FOUND", 404);
  return row;
}
export async function getConfig(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM ops_configs WHERE id = ?").bind(id).first<ConfigRow>();
  if (!row) throw new OpsError("NOT_FOUND", 404);
  return row;
}
export async function reviewContext(db: D1Database, rows: ResourceRow[]) {
  const fleetIds = [...new Set(rows.flatMap(row => [row.fleet_id,row.driver_id]).filter((id): id is string => !!id))];
  const peers = fleetIds.length ? (await db.prepare(`SELECT * FROM ops_resources WHERE id IN (${fleetIds.map(() => "?").join(",")})`).bind(...fleetIds).all<ResourceRow>()).results : [];
  const ids = [...new Set([...rows, ...peers].map(row => row.id))];
  const documents = ids.length ? (await db.prepare(`SELECT ${docColumns} FROM ops_documents WHERE resource_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<DocumentRow>()).results : [];
  return { peers, documents, configs: await publishedConfigs(db) };
}
export function checkVersion(row: { version: number }, value: string) { if (row.version !== Number(value)) throw new OpsError("VERSION_CONFLICT", 409); }
export async function readyCounts(db: D1Database) {
  // Aggregate in SQL, not by loading all partner PII into a dashboard request.
  const at = new Date().toISOString();
  const result = await db.prepare(`WITH policy AS (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY scope ORDER BY effective_at DESC,publication_sequence DESC,id DESC) AS rank
      FROM ops_configs WHERE kind='requirements' AND status='published' AND effective_at<=?
    ), prepared AS (
      SELECT r.id,r.kind,r.fleet_id,r.driver_id,r.data_json,
        (r.status='approved' AND json_extract(r.data_json,'$.authorized')=1 AND EXISTS (
          SELECT 1 FROM policy p WHERE p.rank=1 AND p.scope=CASE WHEN r.kind='vehicle' THEN 'vehicle:'||json_extract(r.data_json,'$.vehicleClass') ELSE r.kind END
          AND NOT EXISTS (SELECT 1 FROM json_each(p.data_json,'$.requiredDocuments') required WHERE NOT EXISTS (
            SELECT 1 FROM ops_documents d WHERE d.resource_id=r.id AND d.document_type=required.value AND d.status='approved' AND d.expires_on>=?
            AND d.sequence=(SELECT max(newer.sequence) FROM ops_documents newer WHERE newer.resource_id=r.id AND newer.document_type=required.value)
          ))
        )) AS ready FROM ops_resources r
    ) SELECT r.kind,sum(CASE WHEN r.ready=1 AND (r.fleet_id IS NULL OR f.ready=1)
        AND (r.driver_id IS NULL OR (d.ready=1 AND d.fleet_id IS r.fleet_id AND EXISTS (SELECT 1 FROM json_each(d.data_json,'$.vehicleClasses') allowed WHERE allowed.value=json_extract(r.data_json,'$.vehicleClass'))))
      THEN 1 ELSE 0 END) AS n FROM prepared r LEFT JOIN prepared f ON f.id=r.fleet_id LEFT JOIN prepared d ON d.id=r.driver_id GROUP BY r.kind`).bind(at,at.slice(0,10)).all<{kind:string;n:number}>();
  return result.results;
}
export function publicError(code: string, zh: boolean) {
  const messages: Record<string, [string,string]> = {
    VERSION_CONFLICT: ["资料已发生变化，本次操作未保存。请刷新后重试。", "The record changed. Nothing was saved. Reload before retrying."],
    NOT_FOUND: ["找不到该记录。", "Record not found."],
    FORBIDDEN: ["当前角色无权执行此操作。", "Your role cannot perform this action."],
    INVALID_CSRF: ["表单已过期或来源不正确，请重新打开页面。", "The form expired or has an invalid origin. Reopen the page."],
    REVIEW_NOT_READY: ["尚未满足审核条件：请检查授权、当地审核清单、必要资料与所属车队。", "Review prerequisites are missing: authorization, confirmed policy, valid approved documents or fleet readiness."],
    INVALID_TRANSITION: ["当前状态不支持此操作。请先提交审核或解除暂停。", "This action is not valid for the current state. Submit for review or restore first."],
    RELATION_CONFLICT: ["关联对象、所属车队、资料状态或车型不匹配；请先解除已有配对。", "Invalid fleet, driver, readiness or vehicle class. Unpair existing assignments first."],
    DOCUMENT_INVALID: ["只接受有效的 PNG、JPEG 或 PDF，单份不超过 512 KiB。", "Use a valid PNG, JPEG or PDF up to 512 KiB."],
    DOCUMENT_LIMIT: ["单个档案最多保留 20 份资料，当前附件总容量上限为 50 MiB。需要扩容时请联系平台所有者。", "Up to 20 documents per record and 50 MiB total attachment storage. Contact the owner to expand storage."],
    IMMUTABLE_CONFIG: ["已发布版本不可编辑；请复制为新草稿，检查后重新发布。", "Published versions are immutable. Copy to a new draft, review and publish."],
    INVALID_SCOPE: ["配置类型与适用范围不匹配。", "Configuration type and scope do not match."],
    OWNER_PROTECTED: ["不能停用自己、修改自己的权限或更改平台所有者。", "You cannot disable yourself, change your own role or modify the platform owner."],
    DUPLICATE_RECORD: ["账号、车牌或司机配对已存在，请核对后重试。", "An account, registration or driver pairing already exists."],
    INVALID_INPUT: ["请检查必填资料、数字范围、操作原因和日期。", "Check required fields, numeric ranges, reason and dates."],
  };
  return (messages[code] ?? messages.INVALID_INPUT)[zh ? 0 : 1];
}
