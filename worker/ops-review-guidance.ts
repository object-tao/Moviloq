import { can, readiness, type ResourceRow, type DocumentRow, type ConfigRow } from "../shared/operations";
import { OpsError } from "./ops-store";
import { h, t, label, type View } from "./ops-view";

type ReviewContext = { documents: DocumentRow[]; configs: Map<string, ConfigRow>; peers: ResourceRow[] };
export type ReviewIssue = { code: string; message: string; detail: string; actions: { href: string; label: string }[] };
export class ReviewBlockedError extends OpsError {
  constructor(public resource: Pick<ResourceRow,"id"|"name"|"kind">, public issues: ReviewIssue[]) { super("REVIEW_NOT_READY"); }
}

// Explain the existing readiness checks; this must not add or remove conditions.
export function reviewIssues(v: View, row: ResourceRow, context: ReviewContext, forApproval = false): ReviewIssue[] {
  const problems=readiness(forApproval?{...row,status:"approved"}:row,context.documents,context.configs,context.peers);
  const recordPath=`/ops/resource/${encodeURIComponent(row.id)}`;
  const reviewPath=`/ops/reviews/resource/${encodeURIComponent(row.id)}`;
  const data=JSON.parse(row.data_json);
  const edit=can(v.role,"resources:write");
  const uploadAction={href:`${recordPath}#documents`,label:t(v,edit?["上传 / 补交资料","Upload / replace documents"]:["查看资料并联系运营补齐","View documents; ask operations to upload"])};
  const latest=(type:string)=>context.documents.filter(doc=>doc.resource_id===row.id&&doc.document_type===type).sort((a,b)=>b.sequence-a.sequence)[0];
  return problems.map(problem=>{
    const [code,type]=problem.split(":");
    if(code==="authorization_missing")return {code,message:t(v,["尚未确认资料录入授权。","Authorization to record this information has not been confirmed."]),detail:t(v,["请核实资料来源，确认已获授权后再保存；不能仅为通过审核而勾选。","Verify the source and authorization before saving. Do not confirm solely to pass review."]),actions:[{href:`${recordPath}#authorized`,label:t(v,edit?["核实并填写授权","Verify and record authorization"]:["查看授权 / 联系运营","View authorization / contact operations"])}]};
    if(code==="policy_missing") {
      const scope=row.kind==="vehicle"?`vehicle:${data.vehicleClass}`:row.kind;
      const scopeName=row.kind==="vehicle"?`${label(v,"vehicle")} / ${label(v,data.vehicleClass)}`:label(v,row.kind);
      const count=context.documents.filter(doc=>doc.resource_id===row.id).length;
      return {code,message:`${t(v,["尚无已发布且生效的审核清单","No published, effective review checklist"])}：${scopeName}。`,detail:t(v,[`草稿或未来生效版本不生效于当前审核。当前附件 ${count} 份；请先确认清单，再补齐指定资料。${can(v.role,"config:publish")?"":"请联系管理员发布清单。"}`,`Draft or scheduled checklists do not apply yet. ${count} document version(s) currently uploaded; confirm the checklist before supplying required evidence.${can(v.role,"config:publish")?"":" Ask the owner to publish it."}`]),actions:[...(can(v.role,"config:read")?[{href:`/ops/configs?kind=requirements&scope=${encodeURIComponent(scope)}`,label:t(v,["配置 / 发布审核清单","Configure / publish checklist"])}]:[]),uploadAction]};
    }
    if(code==="document_required"||code==="document_expired") {
      const doc=latest(type);const name=label(v,type);
      if(code==="document_expired")return {code,message:`${t(v,["必要资料已过期","Required document expired"])}：${name}`,detail:`${t(v,["有效至（UTC 日期）","Valid through (UTC date)"])}：${doc?.expires_on??"—"}。${t(v,["请补交有效版本，再审核该附件。","Upload a valid replacement and review it."])}`,actions:[uploadAction]};
      if(!doc)return {code:"document_missing",message:`${t(v,["缺少必要资料","Required document missing"])}：${name}`,detail:t(v,["请上传该类型附件并填写有效至日期，文件通过后再审核档案。","Upload this document type with its valid-through date, and approve the file before the record."]),actions:[uploadAction]};
      return {code:doc.status==="submitted"?"document_pending":"document_correction",message:`${t(v,["必要资料尚未通过","Required document not approved"])}：${name}（${label(v,doc.status)}）`,detail:t(v,[`仅最新第 ${doc.sequence} 版参与审核，旧版本通过不能替代新版本。${doc.status==="submitted"?"请先审核该附件。":"请补交修正后的有效资料。"}`,`Only the latest version (${doc.sequence}) counts; an older approval cannot replace it. ${doc.status==="submitted"?"Review this file first.":"Supply corrected, valid evidence."}`]),actions:[{href:`/ops/document/${encodeURIComponent(doc.id)}`,label:t(v,can(v.role,"review:write")?["查看 / 审核该附件","View / review this document"]:["查看附件 / 联系审核员","View document / contact reviewer"])},...(doc.status==="submitted"?[]:[uploadAction])]};
    }
    if(code==="fleet_not_ready") {
      const fleet=context.peers.find(peer=>peer.id===row.fleet_id&&peer.kind==="fleet");
      return {code,message:`${t(v,["所属车队尚未就绪","Associated fleet is not ready"])}${fleet?`：${fleet.name}（${label(v,fleet.status)}）`:""}`,detail:t(v,["请先处理车队的授权、审核清单、资料及档案审核；本档案通过不能跳过车队条件。","Resolve the fleet's authorization, checklist, documents and record review first; this record cannot bypass fleet requirements."]),actions:[fleet?{href:`/ops/reviews/resource/${encodeURIComponent(fleet.id)}`,label:t(v,["查看车队缺少项 / 处理审核","View fleet requirements / review"])}:{href:recordPath,label:t(v,["检查所属车队关联","Check the fleet association"])}]};
    }
    if(code==="driver_not_ready") {
      const driver=context.peers.find(peer=>peer.id===row.driver_id&&peer.kind==="driver");
      const mismatch=driver&&(driver.fleet_id!==row.fleet_id||!JSON.parse(driver.data_json).vehicleClasses.includes(data.vehicleClass));
      return {code,message:t(v,mismatch?["配对司机的所属车队或允许车型不匹配。","The paired driver's fleet or permitted vehicle class does not match."]:["配对司机的资料或审核状态尚未就绪。","The paired driver's documents or review status are not ready."]),detail:t(v,["核对司机与车辆的车队关系、允许车型及司机审核条件。","Check fleet membership, permitted vehicle classes and driver review requirements."]),actions:[...(driver?[{href:`/ops/reviews/resource/${encodeURIComponent(driver.id)}`,label:t(v,["查看司机缺少项 / 审核","View driver requirements / review"])}]:[]),{href:`${recordPath}#pairing`,label:t(v,edit?["检查 / 调整配对","Check / adjust pairing"]:["查看配对 / 联系运营","View pairing / contact operations"])}]};
    }
    return {code,message:`${t(v,["档案尚未审核通过","Record not yet approved"])}（${label(v,row.status)}）`,detail:t(v,["草稿或补件档案需先提交审核；待审档案需由审核人员作出决定。","Drafts and corrected records need submission; pending records need a review decision."]),actions:[{href:["draft","needs_info","rejected"].includes(row.status)?`${recordPath}#submission`:reviewPath,label:t(v,["查看提交与审核进度","View submission / review progress"])}]};
  });
}

export function reviewIssuesHtml(issues: ReviewIssue[]) {
  return `<ul class="review-issues" data-review-issues>${issues.map(issue=>`<li data-issue-code="${h(issue.code)}"><strong>${h(issue.message)}</strong><p>${h(issue.detail)}</p><div class="review-issue-actions">${issue.actions.map(action=>`<a href="${h(action.href)}">${h(action.label)}</a>`).join("")}</div></li>`).join("")}</ul>`;
}

export const reviewGuidanceCss = `
.review-issues{padding:0;margin:14px 0;list-style:none}.review-issues>li{padding:14px 16px;margin:10px 0;border:1px solid #e5d7bf;border-radius:8px;background:#fffdf8;overflow-wrap:anywhere}.review-issues p{margin:8px 0;font-size:12px;line-height:1.8}.review-issue-actions{display:flex;flex-wrap:wrap;gap:8px 16px}.review-issue-actions a{font-size:12px;font-weight:600;text-decoration:underline}.readiness .review-issues{margin-bottom:18px}
`;
