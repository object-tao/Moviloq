import { createHash } from "node:crypto";
import { h, t, type View } from "./ops-view";

// Only this static script's hash is authorized on driver/vehicle lists. Record data
// arrives as escaped, authenticated server-rendered HTML, never executable JS.
export const resourceReviewScript = `(() => {
  const dialog = document.querySelector('[data-resource-review-dialog]');
  if (!dialog || !['driver', 'vehicle'].includes(dialog.dataset.resourceKind) || typeof dialog.showModal !== 'function') return;
  const kind = dialog.dataset.resourceKind;
  const content = dialog.querySelector('[data-review-content]');
  const alert = dialog.querySelector('[data-review-error]');
  const message = alert.querySelector('p');
  const recovery = alert.querySelector('a');
  const loading = dialog.querySelector('[data-review-loading]');
  const close = dialog.querySelector('[data-review-close]');
  let opener, controller, generation = 0, posting = false, uncertain = false, saved = false;
  const listUrl = window.location.href;
  function showError(text, recover = false, href = listUrl) {
    message.textContent = text;
    recovery.href = href;
    recovery.hidden = !recover;
    alert.hidden = false;
    alert.focus();
  }
  close.addEventListener('click', () => { if (!posting) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (posting) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    generation++;
    controller?.abort();
    opener?.focus();
  });
  document.querySelectorAll('[data-' + kind + '-review]').forEach(anchor => anchor.addEventListener('click', async event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(anchor.href);
    const id = url.pathname.split('/').pop();
    if (url.origin !== location.origin || url.pathname !== '/ops/reviews/resource/' + id) return;
    event.preventDefault();
    opener = anchor;
    content.replaceChildren();
    alert.hidden = true;
    loading.hidden = uncertain || saved;
    dialog.showModal();
    close.focus();
    if (uncertain || saved) { showError(dialog.dataset.uncertain, true); return; }
    controller?.abort();
    const loadController = new AbortController();
    controller = loadController;
    const current = ++generation;
    const timeout = setTimeout(() => loadController.abort(), 20000);
    url.search = '?dialog=1';
    try {
      const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: loadController.signal });
      if (!response.ok) throw new Error('Unable to load');
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      const fragment = html.querySelector('[data-resource-review-fragment]');
      if (!fragment || fragment.dataset.resourceId !== id || fragment.dataset.resourceKind !== kind) throw new Error('Unexpected record');
      if (current !== generation || !dialog.open) return;
      // Linked fleet and attachment details open separately, preserving this list.
      fragment.querySelectorAll('a').forEach(link => { link.target = '_blank'; link.rel = 'noopener'; });
      content.replaceChildren(document.importNode(fragment, true));
      dialog.scrollTop = 0;
    } catch {
      if (current === generation && dialog.open) showError(dialog.dataset.loadError, true);
    } finally {
      clearTimeout(timeout);
      if (current === generation) loading.hidden = true;
    }
  }));
  content.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const fragment = content.querySelector('[data-resource-review-fragment]');
    const id = fragment?.dataset.resourceId;
    const action = event.submitter?.value;
    if (posting || uncertain || saved || !id || !form.reportValidity()) return;
    if (form.getAttribute('action') !== '/ops/reviews/resource/' + id + '/status' ||
        !['approve', 'needs_info', 'reject', 'suspend', 'restore'].includes(action)) return;
    const body = new URLSearchParams(new FormData(form));
    body.set('action', action);
    posting = true;
    close.disabled = true;
    alert.hidden = true;
    form.setAttribute('aria-busy', 'true');
    const buttons = form.querySelectorAll('[type="submit"]');
    buttons.forEach(button => button.disabled = true);
    try {
      // Review buttons are named "action", which shadows HTMLFormElement.action.
      const response = await fetch(form.getAttribute('action'), {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json' }, body, signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (response.status === 200 && result.id === id && result.saved === true) {
        saved = true;
        window.location.reload();
        return;
      }
      if (response.status >= 500 || response.ok) throw new Error('Unconfirmed result');
      if (response.status === 401 || result.error === 'PASSWORD_CHANGE_REQUIRED') {
        showError(dialog.dataset.session, true, result.error === 'PASSWORD_CHANGE_REQUIRED' ? '/password' : '/login');
      } else {
        showError(result.message || dialog.dataset.invalid);
      }
    } catch {
      // A lost response may already have committed; require a fresh list before
      // another decision, even if the user closes and reopens this dialog.
      uncertain = true;
      showError(dialog.dataset.uncertain, true);
    } finally {
      posting = false;
      close.disabled = false;
      buttons.forEach(button => button.disabled = uncertain || saved);
      form.removeAttribute('aria-busy');
    }
  });
})();`;

export const resourceReviewHash = `sha256-${createHash("sha256").update(resourceReviewScript).digest("base64")}`;

export function resourceReviewDialog(v: View, kind: "driver" | "vehicle") {
  return `<dialog id="${kind}-review-dialog" class="resource-dialog review-dialog" data-resource-review-dialog data-${kind}-review-dialog data-resource-kind="${kind}" aria-labelledby="${kind}-review-title" aria-describedby="${kind}-review-description"
    data-load-error="${h(t(v,["资料加载失败，可能登录已失效。请刷新列表后重试。", "Could not load review details. Your session may have expired. Refresh the list and try again."]))}"
    data-invalid="${h(t(v,["审核未保存，请检查资料和审核权限。", "Review not saved. Check the details and your review permissions."]))}"
    data-session="${h(t(v,["登录已失效或需要修改密码，请重新验证身份。", "Your session expired or a password change is required. Authenticate again."]))}"
    data-uncertain="${h(t(v,["暂时无法确认审核保存结果。请先刷新列表核对最新状态，不要重复提交。", "The review result could not be confirmed. Refresh the list to check the latest status before submitting another decision."]))}">
    <header class="dialog-heading"><div><h2 id="${kind}-review-title">${h(t(v,kind==="driver"?["司机审核", "Driver review"]:["车辆审核", "Vehicle review"]))}</h2><p id="${kind}-review-description">${h(t(v,["在此查看资料并处理审核；关联车队及附件详情将在新标签页打开。", "View details and review here. Linked fleet and document details open in a new tab."]))}</p></div><button type="button" class="dialog-close" data-review-close aria-label="${h(t(v,["关闭弹窗", "Close dialog"]))}">×</button></header>
    <div class="dialog-error notice" data-review-error role="alert" tabindex="-1" hidden><p></p><a hidden>${h(t(v,["刷新列表 / 重新验证", "Refresh list / authenticate"]))}</a></div>
    <p class="review-loading" data-review-loading role="status">${h(t(v,["正在加载最新审核资料…", "Loading the latest review details…"]))}</p><div class="review-content" data-review-content></div>
    </dialog><script>${resourceReviewScript}</script>`;
}

export const resourceReviewCss = `
.review-dialog{width:min(960px,calc(100vw - 32px))}.review-dialog>.dialog-heading{position:sticky;top:0;z-index:1}.review-content{padding:20px 26px;min-width:0}.review-content h3{font-size:18px;margin:0 0 16px;overflow-wrap:anywhere}.review-content .detail dd{overflow-wrap:anywhere}.review-loading{padding:20px 26px}.review-content .ops-form .btn{margin:4px}.review-content .notice{overflow-wrap:anywhere}
@media(max-width:720px){.review-dialog{width:calc(100vw - 20px)}.review-content,.review-loading{padding:16px 18px}.review-content .detail{grid-template-columns:1fr}.review-content .detail dd{margin:0 0 10px}}
`;
