import './index.css';

const root = document.querySelector('#app');
let previewExpiryTimer;
const state = {
  authenticated: null,
  sessionError: '',
  loginError: '',
  orderText: '',
  action: 'sold_out',
  preview: null,
  applyResult: null,
  error: '',
  busy: '',
  confirmed: false,
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  let data = null;
  try { data = await response.json(); } catch { /* Empty response body. */ }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') {
      state.authenticated = false;
      state.sessionError = 'Your session expired. Sign in again.';
      clearOperation();
    }
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function clearOperation() {
  clearTimeout(previewExpiryTimer);
  state.preview = null;
  state.applyResult = null;
  state.error = '';
  state.confirmed = false;
}

function ordersCount(text) {
  return new Set(text.split(/[\s,]+/).map((part) => part.trim().replace(/^#/, '')).filter(Boolean)).size;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function loadingView() {
  return `<div class="loading-page"><div class="loading-card" aria-label="Checking private session">
    <div class="skeleton" style="width:108px;height:11px"></div>
    <div class="skeleton" style="width:70%;height:32px;margin-top:23px"></div>
    <div class="skeleton" style="width:94%;height:13px;margin-top:15px"></div>
    <div class="skeleton" style="width:82%;height:13px;margin-top:8px"></div>
  </div></div>`;
}

function loginView() {
  const error = state.loginError || state.sessionError;
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">/s</span><span class="brand-name">Shopify Bulk Stock Manager</span></div>
    <div class="topbar-meta"><span class="live-dot"></span> Private workspace</div>
  </header>
  <main class="login-screen">
    <section class="login-story" aria-label="Inventory workflow overview">
      <div class="story-index">01 / OPERATIONS TOOL</div>
      <div class="story-main">
        <h1>Stock changes,<br><em>without guesswork.</em></h1>
        <p>Look up the orders. Review every variant and its automatically discovered locations. Confirm before changing stock or tracking.</p>
      </div>
      <div class="story-footer"><span>ORDER-LED</span><span>PREVIEW FIRST</span><span>OWNER ACCESS</span></div>
    </section>
    <section class="login-side">
      <form class="login-form" id="login-form">
        <p class="eyebrow">Private store access</p>
        <h2>Sign in to continue</h2>
        <p class="login-intro">Use the operations password configured for this store. Your Shopify credentials are never entered here.</p>
        <label class="field-label" for="password">Workspace password</label>
        <input class="field-control password-input" id="password" name="password" type="password" autocomplete="current-password" required maxlength="512" placeholder="Enter password" data-testid="input-password">
        <p class="form-error" role="status" data-testid="status-login-error">${esc(error)}</p>
        <button class="btn btn-primary" type="submit" ${state.busy === 'login' ? 'disabled' : ''} data-testid="button-login">
          ${state.busy === 'login' ? 'Checking access…' : 'Enter workspace'} <span class="arrow" aria-hidden="true">→</span>
        </button>
        <p class="login-footnote">Session is private to this browser.</p>
      </form>
    </section>
  </main>`;
}

function steps() {
  const reviewed = Boolean(state.preview || state.applyResult);
  const applied = Boolean(state.applyResult);
  const stepClass = (index) => {
    if (index === 1) return !reviewed ? 'active' : 'done';
    if (index === 2) return reviewed ? (applied ? 'done' : 'active') : '';
    return applied ? 'active' : '';
  };
  return `<ol class="step-rail" aria-label="Inventory change steps">
    <li class="step ${stepClass(1)}"><span class="step-num">1</span> Identify</li>
    <li class="step ${stepClass(2)}"><span class="step-num">2</span> Review</li>
    <li class="step ${stepClass(3)}"><span class="step-num">3</span> Apply</li>
  </ol>`;
}

function countOrdersText() {
  const count = ordersCount(state.orderText);
  return `${count} ${count === 1 ? 'order entered' : 'orders entered'}`;
}

function sidebar() {
  return `<aside class="aside">
    <section class="panel aside-card">
      <h2 class="aside-title">A careful sequence</h2>
      <ul class="guard-list">
        <li class="guard-item"><span class="guard-icon">1</span><span>Orders are looked up before stock is touched.</span></li>
        <li class="guard-item"><span class="guard-icon">2</span><span>Each variant and its current quantity is shown for review.</span></li>
        <li class="guard-item"><span class="guard-icon">3</span><span>Nothing changes until you confirm the exact preview.</span></li>
      </ul>
    </section>
    <section class="panel aside-card aside-callout">
      <p class="callout-kicker">Location scope</p>
      <p class="callout-text">Locations are discovered automatically. Sold Out zeros every active stocked location. In Stock disables tracking without writing quantities.</p>
      <div class="aside-rule"></div>
      <span class="small-muted">Preview expires at the time shown<br>in the review summary.</span>
    </section>
  </aside>`;
}

function notice() {
  if (state.error) return `<div class="notice error" role="alert" data-testid="status-operation-error"><span class="notice-icon">!</span><span>${esc(state.error)}</span></div>`;
  return '';
}

function summaryPanel(summary) {
  const cells = [
    ['inputOrders', 'Orders entered'],
    ['validOrders', 'Orders found'],
    ['variantsFound', 'Variants found'],
    ['successfulUpdates', 'Updated'],
    ['failedUpdates', 'Failed'],
    ['skippedItems', 'Skipped'],
  ];
  return `<div class="summary-grid" aria-label="Operation summary">${cells.map(([key, label]) =>
    `<div class="summary-cell"><span class="summary-value">${esc(summary?.[key] ?? 0)}</span><span class="summary-label">${label}</span></div>`
  ).join('')}</div>`;
}

function orderRows(orders = []) {
  if (!orders.length) return `<div class="empty-preview"><span class="empty-symbol">—</span><div><p class="empty-title">No order lookup results</p><p class="empty-copy">The preview did not return any order records.</p></div></div>`;
  return `<div class="order-list">${orders.map((order, index) => {
    const status = ['found', 'not_found', 'ambiguous', 'inaccessible'].includes(order.status) ? order.status : 'not_found';
    const text = {
      found: 'Found',
      not_found: 'Not found',
      ambiguous: 'Ambiguous',
      inaccessible: 'No access',
    }[status];
    return `<div class="order-row" data-testid="row-order-${index}">
      <span class="order-name">${esc(order.entered)}</span>
      <span class="order-right">${order.orderName ? `<span class="order-canonical">${esc(order.orderName)}</span>` : ''}
      <span class="status-pill ${status}">${text}</span></span>
      <span class="purchaser">${order.purchaserName ? `Purchaser: <strong>${esc(order.purchaserName)}</strong>` : `Purchaser unavailable${order.purchaserNameReason ? `: ${esc(order.purchaserNameReason)}` : ''}`}</span>
      ${order.reason ? `<span class="blocked-text">${esc(order.reason)}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function variantRows(variants = [], action = '') {
  if (!variants.length) return `<div class="empty-preview"><span class="empty-symbol">—</span><div><p class="empty-title">No variants to show</p><p class="empty-copy">No inventory variants were returned for this operation.</p></div></div>`;
  return `<div class="variant-list">${variants.map((variant, index) => {
    const status = variant.updateStatus || (variant.eligible ? 'pending' : 'skipped');
    const stateLabel = variant.skipReason?.startsWith('Blocked:')
      ? 'Blocked' : { pending: 'Ready', success: 'Updated', failed: 'Failed', skipped: 'Skipped' }[status] || status;
    const activeText = (location) => location.active === null || location.active === undefined
      ? (action === 'sold_out' ? 'Active status UNKNOWN' : 'Active status not needed')
      : location.active ? 'Active' : 'Inactive';
    const locations = (variant.locations || []).map((location) => `<li class="loc-row">
      <div class="loc-main"><span class="loc-name">${esc(location.name)}</span><span class="loc-active">${esc(activeText(location))}</span></div>
      <span class="qty-value">${location.stocked ? esc(location.currentQuantity ?? 'Unknown') : 'Not stocked'} → ${location.targetQuantity === null ? 'quantity unchanged' : esc(location.targetQuantity)}</span>
      ${location.updateStatus || location.updateMessage ? `<span class="variant-sub">${esc(location.updateStatus || '')}${location.updateMessage ? ` · ${esc(location.updateMessage)}` : ''}</span>` : ''}
      <span class="id-text">${esc(location.locationId)}</span>
    </li>`).join('') || '<li class="variant-sub">No location inventory returned.</li>';
    const orderNames = Array.isArray(variant.orderNumbers) ? variant.orderNumbers.join(', ') : '';
    const annotation = variant.updateMessage || variant.skipReason || variant.warning || '';
    return `<article class="variant-card" data-testid="row-variant-${index}">
      <div class="variant-head"><div class="variant-id-block"><span class="variant-title">${esc(variant.productTitle)}</span><span class="variant-sub">${esc(variant.variantTitle)} · ${esc(variant.productStatus || 'Unknown status')}</span></div>
      <span class="status-pill ${esc(status)}">${esc(stateLabel)}</span></div>
      <dl class="variant-meta"><div><dt>Orders</dt><dd>${esc(orderNames || '—')}</dd></div>
      <div><dt>Tracking</dt><dd>${variant.tracked ? 'On' : 'Off'} → ${variant.targetTracked ? 'On' : 'Off'}</dd></div></dl>
      <ul class="loc-list">${locations}</ul>
      ${annotation ? `<p class="${status === 'failed' || status === 'skipped' ? 'blocked-text' : 'warning-text'}">${esc(annotation)}</p>` : ''}
      ${variant.warning && annotation !== variant.warning ? `<p class="warning-text">${esc(variant.warning)}</p>` : ''}
      <details class="id-details"><summary>Exact IDs</summary><span class="id-text">${esc(variant.inventoryItemId)}</span></details>
    </article>`;
  }).join('')}</div>`;
}

function blockedPanel(issues) {
  return `<div class="blocked-panel" role="alert" data-testid="status-blocked">
    <p class="blocked-title">Read-only preview. This action is blocked.</p>
    <p class="blocked-copy">Nothing has been changed, and the missing Shopify permission has not been fixed. Review the matched orders below, then resolve the following and run a new preview.</p>
    <ul>${issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>
  </div>`;
}

function resultsView() {
  const response = state.applyResult || state.preview;
  if (!response) return `<div class="empty-preview" data-testid="empty-preview">
    <span class="empty-symbol" aria-hidden="true">↳</span>
    <div><p class="empty-title">No preview yet</p><p class="empty-copy">Enter order numbers, choose Sold Out or In Stock, and inspect the read-only preview before any update.</p></div>
  </div>`;
  const applied = Boolean(state.applyResult);
  const actionName = response.action === 'in_stock' ? 'Set in stock' : 'Set sold out';
  const variants = response.variants || [];
  const readyCount = variants.filter((item) => item.eligible && item.updateStatus !== 'skipped').length;
  const issues = Array.isArray(response.blockingIssues) ? response.blockingIssues : [];
  const blocked = issues.length > 0;
  const applicable = readyCount > 0 && !applied && !blocked;
  return `<section class="results" aria-live="polite" data-testid="section-results">
    ${applied ? `<div class="notice ${response.summary.failedUpdates > 0 ? 'error' : 'success'}" role="status" data-testid="status-apply-complete"><span class="notice-icon">${response.summary.failedUpdates > 0 ? '!' : '✓'}</span><span>${response.summary.failedUpdates > 0 ? 'Completed with issues' : 'Verification finished'}: ${esc(response.summary.successfulUpdates)} updated, ${esc(response.summary.failedUpdates)} failed, ${esc(response.summary.skippedItems)} skipped. Review every variant and location result below.</span></div>` : ''}
    <div class="results-header">
      <div><h2 class="results-heading">${applied ? 'Apply results' : 'Review before applying'}</h2>
      <p class="results-sub">${esc(actionName)} · Automatic location discovery · ${esc(response.previewId)}</p></div>
      ${!applied && response.expiresAt ? `<span class="expiry">PREVIEW EXPIRES ${esc(formatDate(response.expiresAt))}</span>` : ''}
    </div>
    ${!applied && blocked ? blockedPanel(issues) : ''}
    ${summaryPanel(response.summary)}
    <section class="panel result-panel">
      <div class="result-panel-head"><h3>Order resolution</h3><span class="result-count">${(response.orders || state.preview?.orders || []).length} checked</span></div>
      ${orderRows(response.orders || state.preview?.orders || [])}
    </section>
    <section class="panel result-panel" style="margin-top:14px">
      <div class="result-panel-head"><h3>Variants ${applied ? 'processed' : 'in scope'}</h3><span class="result-count">${variants.length} ${variants.length === 1 ? 'item' : 'items'}</span></div>
      ${variantRows(variants, response.action)}
    </section>
    ${!applied && blocked ? '' : !applied ? `<label class="confirm-box">
      <input id="confirm-change" type="checkbox" ${state.confirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''} data-testid="checkbox-confirm">
      <span class="confirm-label">I reviewed this preview and authorize these inventory changes.
        <span class="confirm-detail">${readyCount} eligible variant${readyCount === 1 ? '' : 's'}. ${response.action === 'sold_out' ? 'Enable tracking and zero every active stocked location shown.' : 'Disable tracking for these variants; do not write quantities.'} Skipped items will not be updated.</span>
      </span>
    </label>
    <div class="apply-bar"><p class="apply-explainer">This applies the variants in this preview only. Editing the order list or settings clears this review and requires a new preview.</p>
      <button class="btn btn-danger" type="button" data-action="apply" ${!applicable || !state.confirmed || state.busy ? 'disabled' : ''} data-testid="button-apply">
        ${state.busy === 'apply' ? 'Applying changes…' : 'Apply confirmed changes'} <span class="arrow" aria-hidden="true">→</span>
      </button>
    </div>` : `<div class="apply-bar"><p class="apply-explainer">${esc(response.summary.successfulUpdates ?? 0)} updated · ${esc(response.summary.failedUpdates ?? 0)} failed · ${esc(response.summary.skippedItems ?? 0)} skipped. These are the results returned by Shopify.</p>
      <button class="btn btn-secondary" type="button" data-action="new-operation" data-testid="button-new-operation">Start another operation</button>
    </div>`}
  </section>`;
}

function appView() {
  const canPreview = Boolean(state.orderText.trim() && !state.busy);
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">/s</span><span class="brand-name">Shopify Bulk Stock Manager</span></div>
    <div class="topbar-meta"><span class="live-dot"></span> Authenticated session <button class="topbar-action" type="button" data-action="logout" ${state.busy ? 'disabled' : ''} data-testid="button-logout">Sign out</button></div>
  </header>
  <main class="main">
    <div class="page-heading"><div><p class="eyebrow">Inventory operations / 01</p><h1>Order-based stock change</h1></div>
      <p class="heading-note">Start with the orders. Verify the exact variants. Apply only after the preview is right.</p>
    </div>
    ${steps()}
    ${notice()}
    <div class="workspace">
      <section class="panel input-panel">
        <div class="panel-topline"><h2 class="panel-title">Build a stock preview</h2><span class="index-label">READ-ONLY FIRST</span></div>
        <label class="field-label" for="orders">Order numbers <span class="field-hint">LINES, COMMAS, OR SPACES</span></label>
        <textarea class="orders-input" id="orders" name="orders" maxlength="20000" ${state.busy ? 'disabled' : ''} placeholder="#1001&#10;#1002&#10;1003" data-testid="input-orders">${esc(state.orderText)}</textarea>
        <div class="input-foot"><span>Paste order names or numbers</span><span id="order-count">${countOrdersText()}</span></div>
        <div class="settings-grid" style="grid-template-columns:1fr">
          <div class="setting">
            <span class="field-label">Inventory action</span>
            <div class="segmented" role="radiogroup" aria-label="Inventory action">
              <label class="segment-option"><input type="radio" name="action" value="sold_out" ${state.action === 'sold_out' ? 'checked' : ''} ${state.busy ? 'disabled' : ''} data-testid="radio-sold-out"><span>Sold Out</span></label>
              <label class="segment-option"><input type="radio" name="action" value="in_stock" ${state.action === 'in_stock' ? 'checked' : ''} ${state.busy ? 'disabled' : ''} data-testid="radio-in-stock"><span>In Stock</span></label>
            </div>
          </div>
        </div>
        <div class="notice" role="note" style="margin-top:18px">${state.action === 'sold_out'
          ? 'Sold Out enables tracking and sets available inventory to exactly 0 at every active stocked location. Inactive locations are shown and skipped. Shopify’s CONTINUE selling policy can still permit sales at zero.'
          : 'In Stock disables inventory tracking. It does not set, invent, or restore quantities, publish products, or change sales channels. Availability depends on Shopify settings.'}</div>
        <div class="button-row">
          <p class="quiet-note">A preview reads live order and inventory data. It does not change stock.</p>
          <button class="btn btn-primary" type="button" data-action="preview" ${!canPreview ? 'disabled' : ''} data-testid="button-preview">
            ${state.busy === 'preview' ? 'Reading orders…' : 'Preview inventory changes'} <span class="arrow" aria-hidden="true">→</span>
          </button>
        </div>
        ${resultsView()}
      </section>
      ${sidebar()}
    </div>
    <div class="footer-line"><span>SHOPIFY BULK STOCK MANAGER</span><span>NO CHANGE WITHOUT EXPLICIT CONFIRMATION</span></div>
  </main>`;
}

function render() {
  if (state.authenticated === null) {
    root.innerHTML = state.sessionError ? `<div class="loading-page"><div class="loading-card">
      <p class="eyebrow">Session check unavailable</p><p class="aside-copy">${esc(state.sessionError)}</p>
      <button class="btn btn-secondary" data-action="retry-session" type="button">Retry session check</button>
    </div></div>` : loadingView();
    return;
  }
  root.innerHTML = state.authenticated ? appView() : loginView();
}

async function checkSession() {
  state.sessionError = '';
  state.authenticated = null;
  render();
  try {
    const result = await request('/api/auth/session');
    state.authenticated = Boolean(result?.authenticated);
  } catch (error) {
    if (error.status === 401) state.authenticated = false;
    else {
      state.authenticated = null;
      state.sessionError = error.message || 'Could not check the current session.';
    }
  }
  render();
}

function getPayload() {
  return {
    orders: state.orderText,
    action: state.action,
  };
}

async function preview() {
  if (!state.orderText.trim() || state.busy) return;
  clearOperation();
  state.busy = 'preview';
  render();
  try {
    state.preview = await request('/api/shopify/preview', {
      method: 'POST',
      body: JSON.stringify(getPayload()),
    });
    if (!state.preview || typeof state.preview.previewId !== 'string') {
      state.preview = null;
      state.error = 'The preview response was incomplete. No changes were made.';
    } else {
      const previewId = state.preview.previewId;
      previewExpiryTimer = setTimeout(() => {
        if (state.preview?.previewId === previewId && !state.applyResult && state.busy !== 'apply') {
          clearOperation();
          state.error = 'The preview expired. Create a fresh preview before applying.';
          render();
        }
      }, Math.max(0, Date.parse(state.preview.expiresAt) - Date.now()));
    }
  } catch (error) {
    state.error = error.message || 'Could not create a preview. No changes were made.';
  } finally {
    state.busy = '';
    render();
  }
}

async function applyChanges() {
  if (!state.preview?.previewId || !state.confirmed || state.busy) return;
  if ((state.preview.blockingIssues || []).length) return;
  if (Date.parse(state.preview.expiresAt) <= Date.now()) {
    clearOperation();
    state.error = 'The preview expired. Create a fresh preview before applying.';
    render();
    return;
  }
  const eligible = state.preview.variants.filter((item) => item.eligible);
  if (!eligible.length || !window.confirm(
    state.preview.action === 'sold_out'
      ? `Enable tracking and set ${eligible.length} confirmed variant(s) to exactly 0 available at every active stocked location shown? Inactive locations are skipped. CONTINUE selling policy can still permit sales. This changes real inventory.`
      : `Disable inventory tracking for ${eligible.length} confirmed variant(s)? No quantities will be written or restored. Availability still depends on product status, channels, and Shopify settings.`,
  )) return;
  state.busy = 'apply';
  state.error = '';
  render();
  try {
    state.applyResult = await request('/api/shopify/apply', {
      method: 'POST',
      body: JSON.stringify({ previewId: state.preview.previewId, confirmed: true }),
    });
    clearTimeout(previewExpiryTimer);
    if (!state.applyResult || !Array.isArray(state.applyResult.variants)) {
      state.applyResult = null;
      state.error = 'The apply response was incomplete. Refresh inventory before continuing.';
    }
  } catch (error) {
    state.error = error.message || 'The inventory update could not be completed.';
    state.preview = null;
    state.confirmed = false;
    clearTimeout(previewExpiryTimer);
  } finally {
    state.busy = '';
    render();
  }
}

root.addEventListener('submit', async (event) => {
  if (event.target.id !== 'login-form') return;
  event.preventDefault();
  const password = new FormData(event.target).get('password');
  if (typeof password !== 'string' || !password.trim()) return;
  state.busy = 'login';
  state.loginError = '';
  render();
  try {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!result?.authenticated) throw new Error('The server did not confirm an authenticated session.');
    state.authenticated = true;
    state.sessionError = '';
  } catch (error) {
    state.authenticated = false;
    state.loginError = error.message || 'Could not sign in. Check the password and try again.';
  } finally {
    state.busy = '';
    render();
  }
});

root.addEventListener('input', (event) => {
  if (event.target.id === 'orders') {
    state.orderText = event.target.value;
    clearOperation();
    const count = root.querySelector('#order-count');
    if (count) count.textContent = countOrdersText();
    const results = root.querySelector('.results, .empty-preview');
    if (results) results.outerHTML = resultsView();
    const previewButton = root.querySelector('[data-action="preview"]');
    if (previewButton) previewButton.disabled = !state.orderText.trim() || state.busy !== '';
  }
});

root.addEventListener('change', (event) => {
  const target = event.target;
  if (target.name === 'action') {
    state.action = target.value;
    clearOperation();
    render();
  } else if (target.id === 'confirm-change') {
    state.confirmed = target.checked;
    const applyButton = root.querySelector('[data-action="apply"]');
    if (applyButton) applyButton.disabled = (state.preview?.blockingIssues || []).length > 0 || !state.confirmed || !state.preview || state.busy !== '' || !(state.preview.variants || []).some((item) => item.eligible && item.updateStatus !== 'skipped');
  }
});

root.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'preview') await preview();
  if (action === 'apply') await applyChanges();
  if (action === 'logout') {
    button.disabled = true;
    try { await request('/api/auth/logout', { method: 'POST' }); }
    catch (error) {
      state.error = error.message || 'Could not end the session.';
      render();
      return;
    }
    state.authenticated = false;
    state.orderText = '';
    state.loginError = '';
    clearOperation();
    render();
  }
  if (action === 'retry-session') await checkSession();
  if (action === 'new-operation') {
    state.orderText = '';
    state.action = 'sold_out';
    clearOperation();
    render();
  }
});

render();
checkSession();
