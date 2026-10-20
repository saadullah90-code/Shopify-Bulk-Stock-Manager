import './index.css';

const root = document.querySelector('#app');
let previewExpiryTimer;
let feedbackDismissTimer;
let productSearchTimer;
let productSearchGeneration = 0;
let productVariantGeneration = 0;
const state = {
  authenticated: null,
  sessionError: '',
  loginError: '',
  activeSection: 'orders',
  orderText: '',
  action: 'sold_out',
  preview: null,
  applyResult: null,
  error: '',
  busy: '',
  confirmed: false,
  productSearch: '',
  productSearchSearched: '',
  products: [],
  productCursor: null,
  productHasNextPage: false,
  collections: [],
  collectionsLoaded: false,
  collectionCursor: null,
  collectionHasNextPage: false,
  collectionError: '',
  selectedCollectionId: '',
  selectedCollectionTitle: '',
  collectionProducts: [],
  collectionProductCursor: null,
  collectionProductsHasNextPage: false,
  productBusy: '',
  productError: '',
  stockSaveError: '',
  productId: '',
  productTitle: '',
  productStatus: '',
  productFeaturedImage: null,
  productVariants: [],
  variantCursor: null,
  variantHasNextPage: false,
  productStockDraft: {},
  pendingProductPreviews: [],
  previewSource: '',
  applyDialogOpen: false,
  applyFeedback: null,
  selectedDeleteProducts: [],
  deleteReviewOpen: false,
  deleteConfirmed: false,
  deleteError: '',
  deleteResults: [],
  deleteSummary: null,
  scrollPositions: {},
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function clearApplyFeedback() {
  clearTimeout(feedbackDismissTimer);
  feedbackDismissTimer = undefined;
  state.applyFeedback = null;
}

function setApplyFeedback(feedback) {
  clearApplyFeedback();
  state.applyFeedback = feedback;
  if (feedback.kind === 'success') {
    feedbackDismissTimer = setTimeout(() => {
      if (state.applyFeedback === feedback) {
        clearApplyFeedback();
        render();
      }
    }, 2800);
  }
}

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
      clearProductSection();
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
  state.previewSource = '';
  state.applyDialogOpen = false;
  clearApplyFeedback();
  state.pendingProductPreviews = [];
}

function clearProductSection() {
  clearTimeout(productSearchTimer);
  productSearchGeneration += 1;
  productVariantGeneration += 1;
  state.productSearch = '';
  state.productSearchSearched = '';
  state.activeSection = 'orders';
  state.products = [];
  state.productCursor = null;
  state.productHasNextPage = false;
  state.collections = [];
  state.collectionsLoaded = false;
  state.collectionCursor = null;
  state.collectionHasNextPage = false;
  state.collectionError = '';
  state.selectedCollectionId = '';
  state.selectedCollectionTitle = '';
  state.collectionProducts = [];
  state.collectionProductCursor = null;
  state.collectionProductsHasNextPage = false;
  state.productBusy = '';
  state.productError = '';
  state.stockSaveError = '';
  state.productId = '';
  state.productTitle = '';
  state.productStatus = '';
  state.productFeaturedImage = null;
  state.productVariants = [];
  state.variantCursor = null;
  state.variantHasNextPage = false;
  state.productStockDraft = {};
  state.pendingProductPreviews = [];
  state.selectedDeleteProducts = [];
  state.deleteReviewOpen = false;
  state.deleteConfirmed = false;
  state.deleteError = '';
  state.deleteResults = [];
  state.deleteSummary = null;
  state.scrollPositions = {};
}

function clearSelectedProduct() {
  productVariantGeneration += 1;
  state.productId = '';
  state.productTitle = '';
  state.productStatus = '';
  state.productFeaturedImage = null;
  state.productVariants = [];
  state.variantCursor = null;
  state.variantHasNextPage = false;
  state.productStockDraft = {};
  state.pendingProductPreviews = [];
  state.stockSaveError = '';
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

function summaryPanel(summary, source = 'orders') {
  const cells = source === 'product' ? [
    ['variantsFound', 'Sizes reviewed'],
    ['successfulUpdates', 'Updated'],
    ['failedUpdates', 'Failed'],
    ['skippedItems', 'Skipped'],
  ] : [
    ['inputOrders', 'Orders entered'],
    ['validOrders', 'Orders found'],
    ['variantsFound', 'Variants found'],
    ['successfulUpdates', 'Updated'],
    ['failedUpdates', 'Failed'],
    ['skippedItems', 'Skipped'],
  ];
  return `<div class="summary-grid${source === 'product' ? ' summary-grid-compact' : ''}" aria-label="Operation summary">${cells.map(([key, label]) =>
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
      <p class="results-sub">${esc(actionName)} · ${state.previewSource === 'product' ? esc(state.productTitle) : 'Automatic location discovery'} · ${esc(response.previewId)}</p></div>
      ${!applied && response.expiresAt ? `<span class="expiry">PREVIEW EXPIRES ${esc(formatDate(response.expiresAt))}</span>` : ''}
    </div>
    ${!applied && blocked ? blockedPanel(issues) : ''}
    ${summaryPanel(response.summary, state.previewSource === 'product' ? 'product' : 'orders')}
    <section class="panel result-panel">
      <div class="result-panel-head"><h3>${state.previewSource === 'product' ? 'Selected sizes' : 'Order resolution'}</h3><span class="result-count">${state.previewSource === 'product' ? (response.variants || []).length + ' selected' : (response.orders || state.preview?.orders || []).length + ' checked'}</span></div>
      ${state.previewSource === 'product'
        ? `<div class="order-list">${(response.variants || []).map((variant) => `<div class="product-review-row"><strong>${esc(variant.variantTitle)}</strong><span>${esc(variant.productTitle)}</span></div>`).join('')}</div>`
        : orderRows(response.orders || state.preview?.orders || [])}
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

function inventoryDialog() {
  if (state.applyDialogOpen && state.pendingProductPreviews.length) {
    const changedCount = state.pendingProductPreviews.reduce((total, batch) => total + batch.preview.variants.length, 0);
    return `<div class="dialog-backdrop" data-dialog-backdrop>
      <section class="inventory-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inventory-dialog-title" aria-describedby="inventory-dialog-description" data-inventory-dialog>
        <div class="dialog-mark is-warning" aria-hidden="true">!</div>
        <p class="eyebrow">Save stock changes</p>
        <h2 id="inventory-dialog-title">Confirm ${changedCount} size change${changedCount === 1 ? '' : 's'}</h2>
        <p id="inventory-dialog-description" class="dialog-copy">Review the selected sizes and exact Shopify location quantities. Nothing is saved until you confirm below.</p>
        <div class="dialog-variant-list" aria-label="Variants and stock changes">
          ${state.pendingProductPreviews.map(({ action, preview }) => `<div class="dialog-batch">
            <h3>${action === 'in_stock' ? 'Set in stock' : 'Set sold out'}</h3>
            ${preview.variants.map((variant) => `<article class="dialog-variant">
              <strong>${esc(variant.productTitle || '')}${variant.productTitle ? ' · ' : ''}${esc(variant.variantTitle || variant.title || 'Variant')}</strong>
              ${action === 'sold_out' ? `<ul>${(variant.locations || []).map((location) => `<li>${esc(location.name)}: ${esc(location.currentQuantity ?? 'Unknown')} → ${location.stocked && location.active === true ? '0' : 'unchanged'}${location.active === false ? ' · inactive' : ''}</li>`).join('')}</ul>` : '<p>Inventory tracking will be turned off; quantity is not changed.</p>'}
            </article>`).join('')}
          </div>`).join('')}
        </div>
        <div class="dialog-warning">These changes affect live Shopify inventory. Save only if the variants and locations above are correct.</div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" type="button" data-action="cancel-apply" data-dialog-secondary>Go back</button>
          <button class="btn btn-primary" type="button" data-action="confirm-apply" data-dialog-primary>Confirm and save</button>
        </div>
      </section>
    </div>`;
  }

  if (state.applyDialogOpen && state.preview) {
    const preview = state.preview;
    const eligible = preview.variants.filter((item) => item.eligible && item.updateStatus !== 'skipped');
    const soldOut = preview.action === 'sold_out';
    const locationCount = eligible.reduce((count, variant) => count + (variant.locations || []).filter((location) =>
      location.stocked && location.active === true,
    ).length, 0);
    return `<div class="dialog-backdrop" data-dialog-backdrop>
      <section class="inventory-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inventory-dialog-title" aria-describedby="inventory-dialog-description" data-inventory-dialog>
        <div class="dialog-mark is-warning" aria-hidden="true">!</div>
        <p class="eyebrow">Final confirmation</p>
        <h2 id="inventory-dialog-title">${soldOut ? 'Set selected stock to sold out?' : 'Set selected products in stock?'}</h2>
        <p id="inventory-dialog-description" class="dialog-copy">${soldOut
          ? `This will enable tracking and set available quantity to 0 at ${locationCount} active stocked location${locationCount === 1 ? '' : 's'}.`
          : 'This will disable inventory tracking for the selected variants. Shopify quantities will not be written or restored.'} This changes live Shopify data.</p>
        <div class="dialog-variant-list" aria-label="Variants included in this change">
          ${eligible.map((variant) => `<article class="dialog-variant">
            <strong>${esc(variant.productTitle || '')}${variant.productTitle ? ' · ' : ''}${esc(variant.variantTitle || variant.title || 'Variant')}</strong>
            ${soldOut ? `<ul>${(variant.locations || []).map((location) => `<li>${esc(location.name)}: ${esc(location.currentQuantity ?? 'Unknown')} → ${location.stocked && location.active === true ? '0' : 'unchanged'}${location.active === false ? ' · inactive' : ''}</li>`).join('')}</ul>` : '<p>Inventory tracking: Off → On. No quantity writes.</p>'}
          </article>`).join('')}
        </div>
        <div class="dialog-warning">Review the exact variants and location quantities above before continuing. This action cannot be automatically undone.</div>
        <div class="dialog-actions">
          <button class="btn btn-secondary" type="button" data-action="cancel-apply" data-dialog-secondary>Go back</button>
          <button class="btn btn-danger" type="button" data-action="confirm-apply" data-dialog-primary>Confirm and apply</button>
        </div>
      </section>
    </div>`;
  }

  if (state.applyFeedback) {
    const feedback = state.applyFeedback;
    if (feedback.kind === 'success') {
      const summary = feedback.summary || {};
      const detail = feedback.summary
        ? `${summary.successfulUpdates ?? 0} updated · ${summary.failedUpdates ?? 0} failed${Number(summary.skippedItems) ? ` · ${summary.skippedItems} skipped` : ''}`
        : 'Shopify confirmed the changes.';
      return `<div class="save-toast" role="status" aria-live="polite" data-save-toast>
        <span class="save-toast-icon" aria-hidden="true">✓</span>
        <span class="save-toast-copy"><strong>Done</strong><small>${esc(detail)}</small></span>
        <button type="button" class="save-toast-close" data-action="dismiss-apply-feedback" aria-label="Dismiss confirmation">×</button>
      </div>`;
    }
    const complete = feedback.kind === 'success';
    const summary = feedback.summary || {};
    return `<div class="dialog-backdrop" data-dialog-backdrop>
      <section class="inventory-dialog feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-feedback-title" data-inventory-dialog>
        <div class="dialog-mark ${complete ? 'is-success' : 'is-error'}" aria-hidden="true">${complete ? '✓' : '!'}</div>
        <p class="eyebrow">${complete ? 'Shopify update confirmed' : 'Update needs attention'}</p>
        <h2 id="inventory-feedback-title">${esc(feedback.title)}</h2>
        <p class="dialog-copy">${esc(feedback.message)}</p>
        ${feedback.summary ? `<div class="dialog-stats">
          <div><strong>${esc(summary.successfulUpdates ?? 0)}</strong><span>Updated</span></div>
          <div><strong>${esc(summary.failedUpdates ?? 0)}</strong><span>Failed</span></div>
          <div><strong>${esc(summary.skippedItems ?? 0)}</strong><span>Skipped</span></div>
        </div>` : ''}
        <div class="dialog-actions">
          <button class="btn ${complete ? 'btn-primary' : 'btn-secondary'}" type="button" data-action="dismiss-apply-feedback" data-dialog-primary>${feedback.context === 'product' ? 'Return to product' : 'View detailed results'}</button>
        </div>
      </section>
    </div>`;
  }
  return '';
}

function variantStockPresentation(variant) {
  if (variant.tracked === false) {
    return variant.availableForSale
      ? { label: 'In stock', className: 'is-in-stock' }
      : { label: 'Sold out', className: 'is-sold-out' };
  }

  if (typeof variant.inventoryQuantity === 'number' && Number.isFinite(variant.inventoryQuantity)) {
    return variant.inventoryQuantity > 0
      ? { label: 'In stock', className: 'is-in-stock' }
      : { label: 'Sold out', className: 'is-sold-out' };
  }

  return { label: 'Stock unknown', className: 'is-unknown' };
}

function productActionForVariant(variant) {
  const label = variantStockPresentation(variant).label;
  return label === 'In stock' ? 'in_stock' : label === 'Sold out' ? 'sold_out' : '';
}

function productStockChanges() {
  return state.productVariants
    .filter((variant) => variant.inventoryItemId)
    .map((variant) => ({ variant, action: state.productStockDraft[variant.id] }))
    .filter(({ variant, action }) => action && action !== productActionForVariant(variant));
}

function productSection() {
  const searching = state.productBusy === 'search';
  const productResults = state.selectedCollectionId ? [] : state.products;
  const hasSearchedCurrentQuery = state.productSearchSearched === state.productSearch.trim();
  const stockChanges = productStockChanges();
  return `<section class="panel product-panel" aria-labelledby="product-panel-title">
    <div class="panel-topline">
      <div><p class="eyebrow">Catalog inventory</p><h2 class="panel-title" id="product-panel-title">Collections and products</h2></div>
      <span class="index-label">LIVE SHOPIFY DATA</span>
    </div>
    <label class="field-label" for="product-search">Product name <span class="field-hint">TYPE AT LEAST 2 CHARACTERS</span></label>
    <div class="product-search-row" style="margin-bottom:12px">
      <input class="field-control" id="product-search" type="search" maxlength="80" autocomplete="off" value="${esc(state.productSearch)}" placeholder="For example, Ralph Lauren slides" ${state.busy ? 'disabled' : ''} aria-label="Search Shopify products by name">
      <button class="btn btn-secondary" type="button" data-action="search-products" ${searching || state.busy || state.productSearch.trim().length < 2 ? 'disabled' : ''}>${searching ? 'Searching…' : 'Search'}</button>
    </div>
    <p class="product-search-hint">${state.productError && !state.selectedCollectionId ? `<span role="alert" class="product-error">${esc(state.productError)}</span>` : state.productSearch.trim().length < 2 ? 'Search products by name, or browse every Shopify collection below.' : searching ? 'Searching Shopify…' : hasSearchedCurrentQuery ? `${productResults.length} matching product${productResults.length === 1 ? '' : 's'} shown.` : 'Click Search to load matching products.'}</p>
    ${productResults.length ? `<div class="product-results" data-preserve-scroll="product-search-results" aria-label="Matching Shopify products">
      ${productResults.map(productCard).join('')}
    </div>` : searching ? '<p class="product-empty">Searching Shopify…</p>' : hasSearchedCurrentQuery && state.productSearch.trim().length >= 2 && !state.productError ? '<p class="product-empty">No products found. Try another part of the product name.</p>' : ''}
    ${state.productHasNextPage ? `<div class="product-more"><button class="btn btn-secondary" type="button" data-action="load-more-products" ${state.productBusy || state.busy ? 'disabled' : ''}>${state.productBusy === 'more-products' ? 'Loading…' : 'Load more products'}</button></div>` : ''}
    ${collectionBrowser()}
    ${productDeletionPanel()}
    ${state.productId ? `<section class="product-detail" aria-label="Selected product variants">
      <div class="product-detail-heading"><div class="product-detail-product">
        ${catalogImage(state.productFeaturedImage, state.productTitle, 'large')}
         <div><p class="eyebrow">Sizes and stock status</p><h3>${esc(state.productTitle)}</h3><p>${esc(state.productStatus)}</p></div>
      </div>
        <button class="product-refresh" type="button" data-action="refresh-product" ${state.productBusy || state.busy ? 'disabled' : ''}>${state.productBusy === 'refresh-after-save' ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      ${state.productBusy === 'variants' ? '<p class="product-empty">Loading live Shopify sizes…</p>' : ''}
      ${state.productVariants.length ? `<div class="product-size-list">${state.productVariants.map((variant) => {
        const stock = variantStockPresentation(variant);
        const desiredAction = state.productStockDraft[variant.id] || '';
        const desiredInStock = desiredAction === 'in_stock';
        const pending = desiredAction && desiredAction !== productActionForVariant(variant);
        const disabled = !variant.inventoryItemId || Boolean(state.busy || state.productBusy);
        return `<label class="product-size-row${disabled ? ' is-disabled' : ''}${pending ? ' has-pending-change' : ''}">
          <input type="checkbox" role="switch" data-product-stock-toggle="${esc(variant.id)}" ${desiredInStock ? 'checked' : ''} ${disabled || !desiredAction ? 'disabled' : ''} aria-label="Set ${esc(variant.title)} ${desiredInStock ? 'in stock' : 'sold out'}">
          <span class="product-size-copy"><strong>${esc(variant.title)}</strong><small>${variant.sku ? `SKU ${esc(variant.sku)}` : variant.inventoryItemId ? 'No SKU' : 'No inventory item'}</small></span>
          <span class="product-quantity">${typeof variant.inventoryQuantity === 'number' ? `Qty ${esc(variant.inventoryQuantity)}` : 'Qty unknown'}</span>
          <span class="product-availability ${desiredAction ? (desiredInStock ? 'is-in-stock' : 'is-sold-out') : stock.className}">${desiredAction ? (desiredInStock ? 'In stock' : 'Sold out') : stock.label}${pending ? '<small class="unsaved-label">Unsaved</small>' : ''}</span>
        </label>`;
      }).join('')}</div>` : ''}
      ${state.variantHasNextPage ? `<div class="product-more"><button class="btn btn-secondary" type="button" data-action="load-more-variants" ${state.productBusy || state.busy ? 'disabled' : ''}>${state.productBusy === 'more-variants' ? 'Loading…' : 'Load more sizes'}</button></div>` : ''}
      ${state.productVariants.some((variant) => !variant.inventoryItemId) ? '<p class="product-search-hint">Sizes without an inventory item cannot be changed.</p>' : ''}
      ${state.productVariants.length ? `<div class="product-stock-actions">
        <span class="selection-count">${stockChanges.length > 25 ? 'Save up to 25 changed sizes at once' : stockChanges.length ? `${stockChanges.length} unsaved size${stockChanges.length === 1 ? '' : 's'}` : 'Choose In Stock or Sold Out for each size'}</span>
        <button class="btn btn-primary" type="button" data-action="save-product-stock" ${!stockChanges.length || stockChanges.length > 25 || state.busy || state.productBusy ? 'disabled' : ''}>${state.busy === 'product-preview' ? 'Reviewing…' : state.busy === 'apply' ? 'Saving…' : 'Save changes'}</button>
      </div>
      <p class="product-safety-note">In Stock turns tracking off. Sold Out sets available quantity to 0 at active stocked locations. Save shows a short confirmation before changes are sent to Shopify.</p>` : ''}
      ${state.stockSaveError ? `<p class="product-save-error" role="alert">${esc(state.stockSaveError)}</p>` : ''}
    </section>` : ''}
  </section>`;
}

function appView() {
  const canPreview = Boolean(state.orderText.trim() && !state.busy);
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">/s</span><span class="brand-name">Shopify Bulk Stock Manager</span></div>
    <div class="topbar-meta"><span class="live-dot"></span> Authenticated session <button class="topbar-action" type="button" data-action="logout" ${state.busy ? 'disabled' : ''} data-testid="button-logout">Sign out</button></div>
  </header>
  <main class="main">
    <nav class="section-nav" aria-label="Workspace sections">
      <button class="section-nav-button${state.activeSection === 'orders' ? ' is-active' : ''}" type="button" data-action="switch-section" data-section="orders" ${state.activeSection === 'orders' ? 'aria-current="page"' : ''}>
        <span class="section-nav-number">01</span><span class="section-nav-copy"><strong>Orders</strong><small>Stock changes by order number</small></span>
      </button>
      <button class="section-nav-button${state.activeSection === 'collections' ? ' is-active' : ''}" type="button" data-action="switch-section" data-section="collections" ${state.activeSection === 'collections' ? 'aria-current="page"' : ''}>
        <span class="section-nav-number">02</span><span class="section-nav-copy"><strong>Collections</strong><small>Browse products, stock, and deletion</small></span>
      </button>
    </nav>
    ${state.activeSection === 'orders' ? `<section class="section-view" aria-label="Orders and stock">
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
          ${state.previewSource === 'product' ? '' : resultsView()}
        </section>
        ${sidebar()}
      </div>
    </section>` : `<section class="section-view" aria-label="Collections and products">
      <div class="page-heading"><div><p class="eyebrow">Catalog operations / 02</p><h1>Collections and products</h1></div>
        <p class="heading-note">Open a collection, choose a product, then review its stock before making a change.</p>
      </div>
      ${productSection()}
    </section>`}
    <div class="footer-line"><span>SHOPIFY BULK STOCK MANAGER</span><span>NO CHANGE WITHOUT EXPLICIT CONFIRMATION</span></div>
  </main>
  ${inventoryDialog()}`;
}

function render() {
  const dialogWasOpen = Boolean(root.querySelector('[data-inventory-dialog]'));
  const searchHasFocus = document.activeElement?.id === 'product-search';
  const focusedAction = document.activeElement?.dataset?.action || '';
  const focusedSection = document.activeElement?.dataset?.section || '';
  for (const element of root.querySelectorAll('[data-preserve-scroll]')) {
    const key = element.dataset.preserveScroll;
    if (key) state.scrollPositions[key] = { top: element.scrollTop, left: element.scrollLeft };
  }
  const searchSelection = searchHasFocus
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    : null;
  if (state.authenticated === null) {
    root.innerHTML = state.sessionError ? `<div class="loading-page"><div class="loading-card">
      <p class="eyebrow">Session check unavailable</p><p class="aside-copy">${esc(state.sessionError)}</p>
      <button class="btn btn-secondary" data-action="retry-session" type="button">Retry session check</button>
    </div></div>` : loadingView();
    return;
  }
  root.innerHTML = state.authenticated ? appView() : loginView();
  for (const element of root.querySelectorAll('[data-preserve-scroll]')) {
    const position = state.scrollPositions[element.dataset.preserveScroll];
    if (position) {
      element.scrollTop = position.top;
      element.scrollLeft = position.left;
    }
  }
  if (searchHasFocus) {
    const search = root.querySelector('#product-search');
    if (search) {
      search.focus({ preventScroll: true });
      if (searchSelection?.[0] != null && searchSelection?.[1] != null) {
        search.setSelectionRange(searchSelection[0], searchSelection[1]);
      }
    }
  }
  if (focusedAction === 'switch-section') {
    [...root.querySelectorAll('[data-action="switch-section"]')]
      .find((button) => button.dataset.section === focusedSection)
      ?.focus({ preventScroll: true });
  }
  if (!dialogWasOpen && (state.applyDialogOpen || (state.applyFeedback && state.applyFeedback.kind !== 'success'))) {
    root.querySelector('[data-dialog-primary]')?.focus({ preventScroll: true });
  }
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

async function searchProducts(after = null, generation = ++productSearchGeneration) {
  const search = state.productSearch.trim();
  if (search.length < 2 || state.busy) return;
  state.productBusy = after ? 'more-products' : 'search';
  state.productError = '';
  state.productSearchSearched = search;
  if (!after) {
    state.products = [];
    state.productCursor = null;
    state.productHasNextPage = false;
  }
  render();
  try {
    const params = new URLSearchParams({ search });
    if (after) params.set('after', after);
    const result = await request(`/api/shopify/products?${params}`);
    if (generation !== productSearchGeneration) return;
    state.products = after ? [...state.products, ...result.products] : result.products;
    state.productCursor = result.endCursor;
    state.productHasNextPage = result.hasNextPage;
  } catch (error) {
    if (generation === productSearchGeneration) state.productError = error.message || 'Shopify product search failed.';
  } finally {
    if (generation === productSearchGeneration) {
      state.productBusy = '';
      render();
    }
  }
}

async function loadCollections(after = null) {
  if (state.busy || state.productBusy) return;
  state.productBusy = after ? 'more-collections' : 'collections';
  state.collectionError = '';
  if (!after) {
    state.collections = [];
    state.collectionCursor = null;
    state.collectionHasNextPage = false;
    state.collectionsLoaded = false;
  }
  render();
  try {
    const params = new URLSearchParams();
    if (after) params.set('after', after);
    const result = await request(`/api/shopify/collections${params.size ? `?${params}` : ''}`);
    state.collections = after ? [...state.collections, ...result.collections] : result.collections;
    state.collectionCursor = result.endCursor;
    state.collectionHasNextPage = result.hasNextPage;
    state.collectionsLoaded = true;
  } catch (error) {
    state.collectionError = error.message || 'Could not load Shopify collections.';
  } finally {
    state.productBusy = '';
    render();
  }
}

async function loadCollectionProducts(collectionId = state.selectedCollectionId, after = null) {
  if (!collectionId || state.busy || state.productBusy) return;
  const existingList = after ? root.querySelector('[data-preserve-scroll="collection-products"]') : null;
  const previousScrollHeight = existingList?.scrollHeight ?? null;
  let appendedNextPage = false;
  state.productBusy = after ? 'more-collection-products' : 'collection-products';
  state.productError = '';
  if (!after) {
    state.collectionProducts = [];
    state.collectionProductCursor = null;
    state.collectionProductsHasNextPage = false;
  }
  render();
  try {
    const params = new URLSearchParams({ collectionId });
    if (after) params.set('after', after);
    const result = await request(`/api/shopify/collection-products?${params}`);
    if (state.selectedCollectionId !== collectionId) return;
    state.selectedCollectionTitle = result.collectionTitle;
    if (after) {
      const existingIds = new Set(state.collectionProducts.map((product) => product.id));
      const nextProducts = result.products.filter((product) => !existingIds.has(product.id));
      if (!nextProducts.length) {
        state.collectionProductCursor = null;
        state.collectionProductsHasNextPage = false;
        state.productError = 'Shopify returned the products already shown instead of the next page. Reopen the collection and try again.';
      } else {
        state.collectionProducts = [...state.collectionProducts, ...nextProducts];
        state.collectionProductCursor = result.endCursor;
        state.collectionProductsHasNextPage = result.hasNextPage;
        appendedNextPage = true;
      }
    } else {
      state.collectionProducts = result.products;
      state.collectionProductCursor = result.endCursor;
      state.collectionProductsHasNextPage = result.hasNextPage;
    }
  } catch (error) {
    state.productError = error.message || 'Could not load products in this collection.';
  } finally {
    state.productBusy = '';
    render();
    if (appendedNextPage && previousScrollHeight !== null) {
      const list = root.querySelector('[data-preserve-scroll="collection-products"]');
      if (list) list.scrollTop = Math.min(previousScrollHeight, list.scrollHeight - list.clientHeight);
    }
  }
}

function catalogImage(image, title, size = 'small') {
  let url = '';
  try {
    const candidate = new URL(image?.url);
    if (candidate.protocol === 'https:') url = esc(candidate.href);
  } catch { /* Some products have no usable featured image. */ }
  return url
    ? `<img class="catalog-image catalog-image-${size}" src="${url}" alt="${esc(image?.altText || title)}" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="catalog-image-placeholder catalog-image-placeholder-${size}" role="img" aria-label="No product image"><span>No image</span></span>`;
}

function productCard(product, { selectable = false } = {}) {
  const openButton = `<button class="product-result product-result-with-image" type="button" data-action="open-product" data-product-id="${esc(product.id)}" data-product-title="${esc(product.title)}" ${state.productBusy || state.busy ? 'disabled' : ''}>
    ${catalogImage(product.featuredImage, product.title)}
    <span class="product-result-copy"><strong>${esc(product.title)}</strong><small>${esc(product.status)}</small></span>
    <span class="arrow" aria-hidden="true">→</span>
  </button>`;
  if (!selectable) return openButton;
  const checked = state.selectedDeleteProducts.some((item) => item.id === product.id);
  return `<div class="collection-product-row">
    <label class="collection-product-select">
      <input type="checkbox" data-delete-product-selection="${esc(product.id)}" ${checked ? 'checked' : ''} ${state.productBusy || state.busy ? 'disabled' : ''} aria-label="Select ${esc(product.title)} for permanent deletion">
    </label>
    ${openButton}
  </div>`;
}

function collectionBrowser() {
  return `<section class="collection-browser" aria-labelledby="collection-browser-title">
    <div class="collection-browser-heading"><div><p class="eyebrow">Browse your Shopify catalog</p><h3 id="collection-browser-title">Collections</h3></div>
      <button class="product-refresh" type="button" data-action="refresh-collections" ${state.productBusy || state.busy ? 'disabled' : ''}>Refresh collections</button>
    </div>
    <p class="product-search-hint">${state.collectionError ? `<span role="alert" class="product-error">${esc(state.collectionError)}</span>` : state.productBusy === 'collections' ? 'Loading Shopify collections…' : `${state.collections.length} collection${state.collections.length === 1 ? '' : 's'} loaded. Open one to browse its products.`}</p>
    ${state.collections.length ? `<div class="collection-list" data-preserve-scroll="collection-list">
      ${state.collections.map((collection) => `<button class="collection-result${state.selectedCollectionId === collection.id ? ' is-selected' : ''}" type="button" data-action="open-collection" data-collection-id="${esc(collection.id)}" data-collection-title="${esc(collection.title)}" ${state.productBusy || state.busy ? 'disabled' : ''} aria-pressed="${state.selectedCollectionId === collection.id}">${esc(collection.title)}<span aria-hidden="true">→</span></button>`).join('')}
    </div>` : state.productBusy === 'collections' ? '' : '<p class="product-empty">No Shopify collections were found.</p>'}
    ${state.collectionHasNextPage ? `<div class="product-more"><button class="btn btn-secondary" type="button" data-action="load-more-collections" ${state.productBusy || state.busy ? 'disabled' : ''}>${state.productBusy === 'more-collections' ? 'Loading…' : 'Load more collections'}</button></div>` : ''}
    ${state.selectedCollectionId ? `<div class="collection-products">
      <div class="collection-products-heading"><h4>${esc(state.selectedCollectionTitle || 'Collection products')}</h4><span>${state.collectionProducts.length} shown</span></div>
      ${state.productBusy === 'collection-products' ? '<p class="product-empty">Loading collection products…</p>' : ''}
      ${state.collectionProducts.length ? `<div class="product-results" data-preserve-scroll="collection-products" aria-label="Products in this collection">${state.collectionProducts.map((product) => productCard(product, { selectable: true })).join('')}</div>` : state.productBusy === 'collection-products' ? '' : state.productError ? `<p class="product-search-hint"><span role="alert" class="product-error">${esc(state.productError)}</span></p>` : '<p class="product-empty">No products are in this collection.</p>'}
      ${state.collectionProducts.length && state.productError ? `<p class="product-search-hint"><span role="alert" class="product-error">${esc(state.productError)}</span></p>` : ''}
      ${state.collectionProductsHasNextPage ? `<div class="product-more"><button class="btn btn-secondary" type="button" data-action="load-more-collection-products" ${state.productBusy || state.busy ? 'disabled' : ''}>${state.productBusy === 'more-collection-products' ? 'Loading…' : 'Load more products'}</button></div>` : ''}
    </div>` : ''}
  </section>`;
}

function productDeletionPanel() {
  const selected = state.selectedDeleteProducts;
  if (!selected.length && !state.deleteResults.length && !state.deleteError) return '';
  const results = state.deleteResults;
  return `<section class="bulk-delete-panel" aria-labelledby="bulk-delete-title">
    <div class="bulk-delete-heading">
      <div><p class="eyebrow">Shopify catalog</p><h3 id="bulk-delete-title">${selected.length ? `${selected.length} product${selected.length === 1 ? '' : 's'} selected` : 'Recent deletion results'}</h3></div>
      ${selected.length ? `<button class="product-refresh" type="button" data-action="clear-product-delete-selection" ${state.busy ? 'disabled' : ''}>Clear selection</button>` : ''}
    </div>
    <p class="bulk-delete-hint">Your selection stays checked as you open other collections. Select up to 50 products per batch.</p>
    ${state.deleteError ? `<p class="bulk-delete-error" role="alert">${esc(state.deleteError)}</p>` : ''}
    ${selected.length ? state.deleteReviewOpen ? `<div class="bulk-delete-review">
      <p class="bulk-delete-warning">Permanent action: these products and their variants will be deleted from Shopify and cannot be restored here. Check the exact list before continuing.</p>
      <div class="bulk-delete-list" aria-label="Products that will be permanently deleted">
        ${selected.map((item) => `<div class="bulk-delete-item">
          ${catalogImage(item.featuredImage, item.title)}
          <span>${esc(item.title)}</span>
        </div>`).join('')}
      </div>
      <label class="bulk-delete-confirm">
        <input id="confirm-product-deletion" type="checkbox" ${state.deleteConfirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''}>
        <span>I have reviewed these ${selected.length} products and understand this deletion cannot be undone.</span>
      </label>
      <div class="bulk-delete-actions">
        <button class="btn btn-secondary" type="button" data-action="cancel-product-delete-review" ${state.busy ? 'disabled' : ''}>Keep selecting</button>
        <button class="btn btn-danger" type="button" data-action="confirm-product-delete" ${!state.deleteConfirmed || state.busy ? 'disabled' : ''}>${state.busy === 'product-delete' ? 'Deleting…' : `Permanently delete ${selected.length} product${selected.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>` : `<div class="bulk-delete-actions">
      <button class="btn btn-danger" type="button" data-action="review-product-delete" ${state.busy ? 'disabled' : ''}>Review permanent deletion</button>
    </div>` : ''}
    ${results.length ? `<div class="bulk-delete-results" aria-live="polite">
      <h4>Deletion results${state.deleteSummary ? ` · ${state.deleteSummary.deleted} deleted, ${state.deleteSummary.failed} failed, ${state.deleteSummary.notAttempted} not attempted` : ''}</h4>
      ${results.map((item) => `<div class="bulk-delete-result">
        <strong>${esc(item.title)}</strong>
        <span class="bulk-delete-status is-${esc(item.status)}">${item.status === 'not_attempted' ? 'Not attempted' : item.status === 'deleted' ? 'Deleted' : 'Failed'}</span>
        ${item.message ? `<p>${esc(item.message)}</p>` : ''}
      </div>`).join('')}
    </div>` : ''}
  </section>`;
}

async function loadProductVariants(productId = state.productId, after = null) {
  if (!productId || state.busy) return;
  const generation = ++productVariantGeneration;
  state.productBusy = after ? 'more-variants' : 'variants';
  state.productError = '';
  render();
  try {
    const params = new URLSearchParams({ productId });
    if (after) params.set('after', after);
    const url = `/api/shopify/product-variants?${params}`;
    const result = await request(url);
    if (state.productId !== productId || generation !== productVariantGeneration) return;
    state.productTitle = result.title;
    state.productStatus = result.status;
    state.productFeaturedImage = result.featuredImage;
    state.productVariants = after ? [...state.productVariants, ...result.variants] : result.variants;
    state.productStockDraft = after ? { ...state.productStockDraft } : {};
    for (const variant of result.variants) {
      if (!(variant.id in state.productStockDraft)) {
        state.productStockDraft[variant.id] = productActionForVariant(variant);
      }
    }
    state.variantCursor = result.endCursor;
    state.variantHasNextPage = result.hasNextPage;
  } catch (error) {
    if (generation === productVariantGeneration) state.productError = error.message || 'Could not load the product sizes from Shopify.';
  } finally {
    if (generation === productVariantGeneration) {
      state.productBusy = '';
      render();
    }
  }
}

async function saveProductStockChanges() {
  const changes = productStockChanges();
  if (!state.productId || !changes.length || changes.length > 25 || state.busy || state.productBusy) return;
  const actions = ['in_stock', 'sold_out'].filter((action) => changes.some((item) => item.action === action));
  state.pendingProductPreviews = [];
  state.applyDialogOpen = false;
  clearApplyFeedback();
  state.stockSaveError = '';
  state.busy = 'product-preview';
  render();
  try {
    for (const action of actions) {
      const variantIds = changes.filter((item) => item.action === action).map((item) => item.variant.id);
      const preview = await request('/api/shopify/product-preview', {
        method: 'POST',
        body: JSON.stringify({ productId: state.productId, variantIds, action }),
      });
      if (!preview || typeof preview.previewId !== 'string' || !Array.isArray(preview.variants) ||
        preview.variants.length !== variantIds.length) {
        throw new Error('Shopify returned an incomplete preview. No stock changes were made.');
      }
      const blocked = [
        ...(preview.blockingIssues || []),
        ...preview.variants.filter((variant) => !variant.eligible).map((variant) => variant.skipReason || `Variant ${variant.variantTitle || ''} is not eligible.`),
      ];
      if (blocked.length) throw new Error(blocked.join(' '));
      state.pendingProductPreviews.push({ action, preview });
    }
    state.applyDialogOpen = state.pendingProductPreviews.length > 0;
  } catch (error) {
    state.pendingProductPreviews = [];
    state.stockSaveError = error.message || 'Could not prepare these stock changes. Nothing was changed.';
  } finally {
    state.busy = '';
    render();
  }
}

async function applyProductStockChanges() {
  const batches = [...state.pendingProductPreviews];
  if (!batches.length || state.busy) return;
  if (batches.some(({ preview }) => !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= Date.now())) {
    state.pendingProductPreviews = [];
    state.applyDialogOpen = false;
    state.stockSaveError = 'The stock review expired. Choose Save changes again to create a fresh review.';
    render();
    return;
  }

  state.applyDialogOpen = false;
  clearApplyFeedback();
  state.busy = 'apply';
  state.stockSaveError = '';
  render();
  const summary = { successfulUpdates: 0, failedUpdates: 0, skippedItems: 0 };
  let applyAttempted = false;
  let responsesReceived = 0;
  try {
    for (const { preview } of batches) {
      applyAttempted = true;
      const result = await request('/api/shopify/apply', {
        method: 'POST',
        body: JSON.stringify({ previewId: preview.previewId, confirmed: true }),
      });
      const resultSummary = result?.summary;
      if (!Array.isArray(result?.variants) || !resultSummary ||
        !['successfulUpdates', 'failedUpdates', 'skippedItems'].every((key) => Number.isFinite(Number(resultSummary[key])))) {
        throw new Error('Shopify returned an incomplete apply result. Refresh stock before retrying.');
      }
      responsesReceived += 1;
      for (const key of Object.keys(summary)) summary[key] += Number(resultSummary[key]);
    }
    const hasFailures = summary.failedUpdates > 0;
    setApplyFeedback({
      kind: hasFailures ? 'error' : 'success',
      context: 'product',
      title: hasFailures ? 'Some sizes need attention' : 'Changes saved',
      message: hasFailures
        ? 'Shopify reported failed or unverified sizes. Refresh and check the product before trying again.'
        : 'Shopify confirmed the requested size changes.',
      summary,
    });
    state.pendingProductPreviews = [];
    scheduleProductRefreshAfterSave();
  } catch (error) {
    state.pendingProductPreviews = [];
    state.stockSaveError = `${error.message || 'Shopify could not confirm the stock changes.'} Refresh stock before retrying; no automatic retry was sent.`;
    setApplyFeedback({
      kind: 'error',
      context: 'product',
      title: applyAttempted ? 'Changes may need checking' : 'Changes could not be confirmed',
      message: state.stockSaveError,
      ...(responsesReceived ? { summary } : {}),
    });
    if (applyAttempted) scheduleProductRefreshAfterSave();
  } finally {
    state.busy = '';
    render();
  }
}

async function refreshProductAvailability(productId = state.productId) {
  const visibleCount = Math.max(1, state.productVariants.length);
  const variants = [];
  let after = null;
  let lastPage;
  do {
    const params = new URLSearchParams({ productId });
    if (after) params.set('after', after);
    lastPage = await request(`/api/shopify/product-variants?${params}`);
    if (state.productId !== productId) return;
    variants.push(...lastPage.variants);
    after = lastPage.hasNextPage ? lastPage.endCursor : null;
  } while (after && variants.length < visibleCount);
  state.productVariants = variants;
  state.productStockDraft = Object.fromEntries(variants.map((variant) => [variant.id, productActionForVariant(variant)]));
  state.productTitle = lastPage.title;
  state.productStatus = lastPage.status;
  state.variantCursor = lastPage.endCursor;
  state.variantHasNextPage = lastPage.hasNextPage;
}

function scheduleProductRefreshAfterSave() {
  const productId = state.productId;
  state.productBusy = 'refresh-after-save';
  refreshProductAvailability(productId)
    .catch((error) => {
      if (state.productId === productId) {
        state.stockSaveError = `Stock result is saved, but the size list could not refresh: ${error.message || 'Use Refresh to reload it.'}`;
      }
    })
    .finally(() => {
      if (state.productId === productId && state.productBusy === 'refresh-after-save') {
        state.productBusy = '';
        render();
      }
    });
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
  if (!eligible.length) return;
  state.applyDialogOpen = false;
  clearApplyFeedback();
  state.busy = 'apply';
  state.error = '';
  render();
  try {
    state.applyResult = await request('/api/shopify/apply', {
      method: 'POST',
      body: JSON.stringify({ previewId: state.preview.previewId, confirmed: true }),
    });
    clearTimeout(previewExpiryTimer);
    const summary = state.applyResult?.summary;
    if (!state.applyResult || !Array.isArray(state.applyResult.variants) ||
      !summary || !['successfulUpdates', 'failedUpdates', 'skippedItems'].every((key) => Number.isFinite(Number(summary[key])))) {
      state.applyResult = null;
      state.error = 'The apply response was incomplete. Refresh inventory before continuing.';
      setApplyFeedback({
        kind: 'error',
        title: 'Shopify returned an incomplete result',
        message: 'The response could not confirm every variant. Refresh Shopify inventory and review the results before retrying.',
      });
    } else {
      const hasFailures = Number(summary.failedUpdates) > 0;
      setApplyFeedback({
        kind: hasFailures ? 'error' : 'success',
        title: hasFailures ? 'Some updates need attention' : 'Your changes are complete',
        message: hasFailures
          ? 'Shopify reported failed or unverified changes. Check each variant and location below before trying again.'
          : 'Shopify confirmed the requested changes. You can review the exact variant and location results below.',
        summary,
      });
      if (state.previewSource === 'product' && state.productId) {
        try {
          await refreshProductAvailability();
        } catch (error) {
          state.productError = `Update results are shown below, but availability could not be refreshed: ${error.message || 'Use Refresh to reload the sizes.'}`;
        }
      }
    }
  } catch (error) {
    state.error = error.message || 'The inventory update could not be completed.';
    state.preview = null;
    state.confirmed = false;
    setApplyFeedback({
      kind: 'error',
      title: 'The update could not be confirmed',
      message: `${state.error} Check Shopify and refresh the preview before trying again.`,
    });
    clearTimeout(previewExpiryTimer);
  } finally {
    state.busy = '';
    render();
  }
}

async function deleteSelectedProducts() {
  if (!state.deleteConfirmed || !state.selectedDeleteProducts.length || state.busy) return;
  const selected = [...state.selectedDeleteProducts];
  const selectedById = new Map(selected.map((item) => [item.id, item]));
  state.busy = 'product-delete';
  state.deleteError = '';
  state.deleteResults = [];
  state.deleteSummary = null;
  clearOperation();
  render();
  let refreshCollection = false;
  try {
    const response = await request('/api/shopify/products/delete', {
      method: 'POST',
      body: JSON.stringify({ productIds: selected.map((item) => item.id), confirmed: true }),
    });
    if (!Array.isArray(response?.results) || !response?.summary) {
      throw new Error('Shopify returned an incomplete deletion result.');
    }
    state.deleteResults = response.results.map((result) => ({
      ...result,
      title: selectedById.get(result.productId)?.title || 'Selected Shopify product',
    }));
    state.deleteSummary = response.summary;
    const deletedIds = new Set(response.results
      .filter((result) => result.status === 'deleted')
      .map((result) => result.productId));
    state.selectedDeleteProducts = state.selectedDeleteProducts.filter((item) => !deletedIds.has(item.id));
    state.collectionProducts = state.collectionProducts.filter((product) => !deletedIds.has(product.id));
    state.products = state.products.filter((product) => !deletedIds.has(product.id));
    if (deletedIds.has(state.productId)) clearSelectedProduct();
    state.deleteReviewOpen = false;
    state.deleteConfirmed = false;
    if (response.summary.failed || response.summary.notAttempted) {
      state.deleteError = 'Some products were not confirmed deleted. Check each result below and refresh Shopify before retrying uncertain items.';
    }
    refreshCollection = deletedIds.size > 0 && Boolean(state.selectedCollectionId);
  } catch (error) {
    state.deleteError = `${error.message || 'Shopify could not confirm the deletion.'} No automatic retry was sent. Refresh Shopify before retrying in case the result is uncertain.`;
    state.deleteReviewOpen = false;
    state.deleteConfirmed = false;
  } finally {
    state.busy = '';
    render();
    if (refreshCollection) await loadCollectionProducts();
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
    if (state.authenticated) await loadCollections();
});

root.addEventListener('input', (event) => {
  if (event.target.id === 'orders') {
    state.orderText = event.target.value;
    const oldProductPreview = state.previewSource === 'product';
    clearOperation();
    if (oldProductPreview) root.querySelector('.product-panel .results')?.remove();
    const count = root.querySelector('#order-count');
    if (count) count.textContent = countOrdersText();
    const results = root.querySelector('.results, .empty-preview');
    if (results) results.outerHTML = resultsView();
    const previewButton = root.querySelector('[data-action="preview"]');
    if (previewButton) previewButton.disabled = !state.orderText.trim() || state.busy !== '';
  }
  if (event.target.id === 'product-search') {
    state.productSearch = event.target.value;
    state.productSearchSearched = '';
    clearOperation();
    clearSelectedProduct();
    state.selectedCollectionId = '';
    state.selectedCollectionTitle = '';
    state.collectionProducts = [];
    state.collectionProductCursor = null;
    state.collectionProductsHasNextPage = false;
    clearTimeout(productSearchTimer);
    productSearchGeneration += 1;
    state.productError = '';
    if (state.productSearch.trim().length < 2) {
      state.products = [];
      state.productCursor = null;
      state.productHasNextPage = false;
      state.productBusy = '';
      render();
      return;
    }
    state.products = [];
    state.productCursor = null;
    state.productHasNextPage = false;
    state.productBusy = '';
    render();
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
  } else if (target.matches('[data-delete-product-selection]')) {
    const product = state.collectionProducts.find((item) => item.id === target.dataset.deleteProductSelection);
    if (target.checked && !state.selectedDeleteProducts.some((item) => item.id === target.dataset.deleteProductSelection)) {
      if (state.selectedDeleteProducts.length >= 50) {
        target.checked = false;
        state.deleteError = 'Select up to 50 products per deletion batch. Delete this batch before selecting more.';
        render();
        return;
      }
      if (product) state.selectedDeleteProducts = [...state.selectedDeleteProducts, {
        id: product.id, title: product.title, featuredImage: product.featuredImage,
      }];
    } else if (!target.checked) {
      state.selectedDeleteProducts = state.selectedDeleteProducts.filter((item) => item.id !== target.dataset.deleteProductSelection);
    }
    state.deleteReviewOpen = false;
    state.deleteConfirmed = false;
    render();
  } else if (target.id === 'confirm-product-deletion') {
    state.deleteConfirmed = target.checked;
    const deleteButton = root.querySelector('[data-action="confirm-product-delete"]');
    if (deleteButton) deleteButton.disabled = !state.deleteConfirmed || Boolean(state.busy);
  } else if (target.matches('[data-product-stock-toggle]')) {
    const variantId = target.dataset.productStockToggle;
    state.productStockDraft = {
      ...state.productStockDraft,
      [variantId]: target.checked ? 'in_stock' : 'sold_out',
    };
    state.pendingProductPreviews = [];
    state.applyDialogOpen = false;
    clearApplyFeedback();
    state.stockSaveError = '';
    render();
  }
});

root.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (state.applyDialogOpen || state.applyFeedback)) {
    event.preventDefault();
    if (state.applyDialogOpen) state.applyDialogOpen = false;
    else clearApplyFeedback();
    render();
    return;
  }
  if (event.key === 'Tab' && (state.applyDialogOpen || (state.applyFeedback && state.applyFeedback.kind !== 'success'))) {
    const dialog = root.querySelector('[data-inventory-dialog]');
    const focusable = [...(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  if (event.target.id === 'product-search' && event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(productSearchTimer);
    searchProducts();
  }
});

root.addEventListener('click', async (event) => {
  if (event.target.matches('[data-dialog-backdrop]')) {
    if (state.applyDialogOpen) state.applyDialogOpen = false;
    else clearApplyFeedback();
    render();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'switch-section' && ['orders', 'collections'].includes(button.dataset.section)) {
    state.activeSection = button.dataset.section;
    if (state.activeSection === 'collections' && !state.collectionsLoaded && !state.productBusy) {
      await loadCollections();
    } else {
      render();
    }
  }
  if (action === 'review-product-delete' && state.selectedDeleteProducts.length && !state.busy) {
    state.deleteReviewOpen = true;
    state.deleteConfirmed = false;
    state.deleteError = '';
    render();
  }
  if (action === 'cancel-product-delete-review') {
    state.deleteReviewOpen = false;
    state.deleteConfirmed = false;
    render();
  }
  if (action === 'clear-product-delete-selection' && !state.busy) {
    state.selectedDeleteProducts = [];
    state.deleteReviewOpen = false;
    state.deleteConfirmed = false;
    state.deleteError = '';
    render();
  }
  if (action === 'confirm-product-delete') await deleteSelectedProducts();
  if (action === 'preview') await preview();
  if (action === 'apply') {
    state.applyDialogOpen = true;
    render();
  }
  if (action === 'cancel-apply') {
    state.applyDialogOpen = false;
    render();
  }
  if (action === 'confirm-apply') {
    if (state.pendingProductPreviews.length) await applyProductStockChanges();
    else await applyChanges();
  }
  if (action === 'dismiss-apply-feedback') {
    const productResult = state.applyFeedback?.context === 'product';
    clearApplyFeedback();
    render();
    if (!productResult) root.querySelector('[data-testid="status-apply-complete"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (action === 'search-products') {
    clearTimeout(productSearchTimer);
    await searchProducts();
  }
  if (action === 'load-more-products' && state.productCursor) {
    await searchProducts(state.productCursor);
  }
  if (action === 'refresh-collections') await loadCollections();
  if (action === 'load-more-collections' && state.collectionCursor) {
    await loadCollections(state.collectionCursor);
  }
  if (action === 'open-collection' && button.dataset.collectionId) {
    clearTimeout(productSearchTimer);
    productSearchGeneration += 1;
    clearOperation();
    clearSelectedProduct();
    state.productSearch = '';
    state.productSearchSearched = '';
    state.products = [];
    state.productCursor = null;
    state.productHasNextPage = false;
    state.selectedCollectionId = button.dataset.collectionId;
    state.selectedCollectionTitle = button.dataset.collectionTitle || 'Collection';
    state.collectionProducts = [];
    state.collectionProductCursor = null;
    state.collectionProductsHasNextPage = false;
    delete state.scrollPositions['collection-products'];
    await loadCollectionProducts();
  }
  if (action === 'load-more-collection-products' && state.collectionProductCursor) {
    await loadCollectionProducts(state.selectedCollectionId, state.collectionProductCursor);
  }
  if (action === 'open-product' && button.dataset.productId) {
    clearTimeout(productSearchTimer);
    productSearchGeneration += 1;
    clearOperation();
    state.productId = button.dataset.productId;
    state.productTitle = button.querySelector('strong')?.textContent || 'Product';
    state.productStatus = '';
    state.productFeaturedImage = null;
    state.productVariants = [];
    state.variantCursor = null;
    state.variantHasNextPage = false;
    state.productStockDraft = {};
    await loadProductVariants();
  }
  if (action === 'load-more-variants' && state.variantCursor) {
    await loadProductVariants(state.productId, state.variantCursor);
  }
  if (action === 'refresh-product') {
    state.productStockDraft = {};
    state.stockSaveError = '';
    clearOperation();
    await loadProductVariants(state.productId);
  }
  if (action === 'save-product-stock') await saveProductStockChanges();
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
    clearProductSection();
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
