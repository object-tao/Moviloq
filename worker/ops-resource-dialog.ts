import { createHash } from "node:crypto";
import { h, t, type View } from "./ops-view";

// Static script only: no record data is interpolated into executable JavaScript.
// Supported lists authorize this exact hash, not arbitrary inline/self scripts.
export const resourceDialogScript = `(() => {
  const dialog = document.querySelector('[data-resource-create-dialog]');
  if (!dialog || !['fleet', 'driver'].includes(dialog.dataset.resourceKind)) return;
  const kind = dialog.dataset.resourceKind;
  const listPath = '/ops/resources/' + kind;
  const opener = document.querySelector('[data-' + kind + '-create]');
  if (!dialog || !opener || typeof dialog.showModal !== 'function') return;
  const form = dialog.querySelector('form');
  const save = form.querySelector('[type="submit"]');
  const alert = dialog.querySelector('[data-dialog-error]');
  const message = alert.querySelector('p');
  const recovery = alert.querySelector('a');
  let pending = false;
  let uncertain = false;
  let saved = false;
  opener.addEventListener('click', (event) => {
    event.preventDefault();
    dialog.showModal();
    form.querySelector('[name="name"]').focus();
  });
  dialog.querySelectorAll('[data-dialog-close]').forEach(button => button.addEventListener('click', () => {
    if (!pending) dialog.close();
  }));
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => opener.focus());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || uncertain || saved || !form.reportValidity()) return;
    pending = true;
    save.disabled = true;
    form.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('[data-dialog-close]').forEach(button => button.disabled = true);
    alert.hidden = true;
    recovery.hidden = true;
    const normalLabel = save.textContent;
    save.textContent = dialog.dataset.saving;
    try {
      const response = await fetch(form.action, {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)), signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (response.status === 201 && result.redirect === listPath + '?created=1') {
        saved = true;
        window.location.assign(result.redirect);
        return;
      }
      if (response.status >= 500 || response.ok) throw new Error('Unconfirmed result');
      if (response.status === 401 || result.error === 'PASSWORD_CHANGE_REQUIRED') {
        message.textContent = dialog.dataset.session;
        recovery.textContent = dialog.dataset.login;
        recovery.href = result.error === 'PASSWORD_CHANGE_REQUIRED' ? '/password' : '/login';
        recovery.hidden = false;
      } else {
        message.textContent = result.message || dialog.dataset.invalid;
      }
    } catch {
      // An interrupted response may have committed. Never automatically resubmit.
      uncertain = true;
      message.textContent = dialog.dataset.uncertain;
      recovery.textContent = dialog.dataset.checkList;
      recovery.href = listPath;
      recovery.hidden = false;
    } finally {
      pending = false;
      save.disabled = uncertain || saved;
      save.textContent = normalLabel;
      form.removeAttribute('aria-busy');
      dialog.querySelectorAll('[data-dialog-close]').forEach(button => button.disabled = false);
    }
    alert.hidden = false;
    alert.focus();
  });
})();`;
export const resourceDialogHash = `sha256-${createHash("sha256").update(resourceDialogScript).digest("base64")}`;

export const resourceCreationLabels = {
  fleet: {
    add: ["新增车队", "Add fleet"], name: ["车队名称", "Fleet name"], save: ["保存车队", "Save fleet"],
    success: ["车队已新增并保存为草稿，操作日志已记录。", "Fleet added as a draft and recorded in the audit log."],
    description: ["保存为草稿，不会自动创建车队账号或通过审核。", "Save as a draft. No fleet account or approval is created automatically."],
    checkList: ["检查车队列表", "Check fleet list"],
  },
  driver: {
    add: ["新增司机", "Add driver"], name: ["司机姓名", "Driver name"], save: ["保存司机", "Save driver"],
    success: ["司机已新增并保存为草稿，操作日志已记录。", "Driver added as a draft and recorded in the audit log."],
    description: ["保存司机档案草稿，不会自动创建登录账号、通过审核或开放接单。", "Save a driver record draft. No login account, approval or live jobs are enabled automatically."],
    checkList: ["检查司机列表", "Check driver list"],
  },
} as const;

export function resourceCreateDialog(v: View, kind: keyof typeof resourceCreationLabels, contents: string) {
  const labels = resourceCreationLabels[kind];
  return `<dialog id="${kind}-create-dialog" class="resource-dialog" data-resource-create-dialog data-resource-kind="${kind}" aria-labelledby="${kind}-create-title" aria-describedby="${kind}-create-description"
    data-saving="${h(t(v,["保存中…", "Saving…"]))}" data-invalid="${h(t(v,["未保存，请检查资料和登录状态后重试。", "Not saved. Check your details and sign-in state before retrying."]))}"
    data-session="${h(t(v,["登录已失效或需要修改密码，请重新验证身份后再新增。", "Your session expired or a password change is required. Authenticate before adding a record."]))}"
    data-login="${h(t(v,["重新验证身份", "Authenticate again"]))}" data-check-list="${h(t(v,labels.checkList))}"
    data-uncertain="${h(t(v,["暂时无法确认保存结果。为避免重复新增，请先检查列表，不要重复提交。", "The save result could not be confirmed. Check the list before creating another record to avoid duplicates."]))}">
    <header class="dialog-heading"><div><h2 id="${kind}-create-title">${h(t(v,labels.add))}</h2><p id="${kind}-create-description">${h(t(v,labels.description))}</p></div><button class="dialog-close" type="button" data-dialog-close aria-label="${h(t(v,["关闭弹窗", "Close dialog"]))}">×</button></header>
    <div class="dialog-error notice" data-dialog-error role="alert" tabindex="-1" hidden><p></p><a href="/ops/resources/${kind}" hidden></a></div>
    ${contents}</dialog><script>${resourceDialogScript}</script>`;
}

export const resourceDialogCss = `
.resource-dialog{color:#183d35;border:1px solid #dfe5da;border-radius:14px;padding:0;width:min(780px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-shadow:0 20px 90px #09261f44;overscroll-behavior:contain}
.resource-dialog::backdrop{background:#102e27a6}.dialog-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 26px;border-bottom:1px solid #e3e9df;background:#f9fbf6}.dialog-heading h2{font-size:22px}.dialog-heading p{font-size:12px;line-height:1.8;color:#687c6e;margin:8px 0 0}
.dialog-close{flex-shrink:0;border:1px solid #cbd7c9;border-radius:6px;background:white;color:#183d35;min-width:36px;min-height:36px;font-size:24px}.resource-dialog>.ops-form{padding:24px 26px}.dialog-error{margin:20px 26px 0}.dialog-error a{text-decoration:underline}.dialog-actions{display:flex;justify-content:flex-end;gap:12px;padding-top:8px}.btn.secondary{background:#e9eee4;color:#254838}.btn:disabled{opacity:.65;cursor:wait}
.resource-table td:last-child,.resource-table th:last-child{position:sticky;right:0;background:#fff;box-shadow:-5px 0 8px #183d3508;min-width:154px}.resource-table th:last-child{background:#fafbf7}.row-actions{display:flex;align-items:center;gap:12px;white-space:nowrap}.row-actions a{font-weight:600}.resource-table .row-actions{min-width:115px}
@media(max-width:720px){.resource-dialog{width:calc(100vw - 20px);max-height:calc(100dvh - 20px)}.dialog-heading{padding:18px}.resource-dialog>.ops-form{padding:18px}.dialog-error{margin:16px 18px 0}.dialog-actions{position:sticky;bottom:-18px;background:white;padding:12px 0;margin-bottom:-6px}.resource-table td:last-child,.resource-table th:last-child{min-width:124px}.row-actions{gap:10px;font-size:11px}}
`;
