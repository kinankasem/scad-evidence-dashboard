(() => {
  'use strict';

  const STORAGE_KEY = 'scad-dashboard-data-v1';
  const API_KEY = 'scad-dashboard-api-url';
  const RATING_SCORE = { 'Established': 3, 'Partially Established': 2, 'Significant Gap': 1, 'Not Established': 0 };
  const RATING_COLORS = { 'Established': '#2c9b74', 'Partially Established': '#d49a36', 'Significant Gap': '#d56b4d', 'Not Established': '#b83d4e', 'Not Assessed': '#a7b5bf' };
  const STATUS_COLORS = { 'Received': '#2c9b74', 'Partially Received': '#3182a7', 'Requested': '#d49a36', 'To Request': '#b83d4e', 'Other': '#8799a8' };
  const DOMAIN_ALIASES = {
    'GIS Schema Change Management, Impact Assessment & Periodic Review': 'GIS Schema Change Management',
    'Spatial Data Schema': 'Spatial Data Schema Development & Maintenance',
  };
  const seed = structuredClone(window.SCAD_SEED || { requests: [], gaps: [], evidenceRegister: [], existingEvidence: [] });
  const clone = (value) => structuredClone(value);
  let state = loadLocalState();
  let apiUrl = localStorage.getItem(API_KEY) || window.SCAD_CONFIG?.API_URL || '';
  let currentRecordTab = 'register';
  let editing = null;
  let toastTimer;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const nonEmpty = (value) => value !== null && value !== undefined && String(value).trim() !== '';
  const canonicalDomain = (domain) => DOMAIN_ALIASES[domain] || domain || 'Unassigned';
  const pct = (value) => `${Math.round(Number.isFinite(value) ? value : 0)}%`;
  const unique = (items) => [...new Set(items.filter(nonEmpty))].sort((a, b) => String(a).localeCompare(String(b)));
  const slug = (value) => String(value || 'blank').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const shortDomain = (domain) => ({
    'All Domains / Cross-cutting': 'All Domains / Cross-cutting',
    'GIS Field Enumeration & Data Collection': 'Field Enumeration & Collection',
    'Spatial Data Schema Development & Maintenance': 'Spatial Data Schema',
    'GIS Schema Change Management': 'Schema Change Management',
    'Geo-Pipeline Operations': 'Geo-Pipeline Operations',
    'Enumeration Area (EA) Management': 'Enumeration Area Management',
    'GIS Incident Management': 'GIS Incident Management',
  }[canonicalDomain(domain)] || canonicalDomain(domain));

  function loadLocalState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.requests && saved?.gaps) return saved;
    } catch (_) {}
    return clone(seed);
  }

  function saveLocalState() {
    state.meta = { ...(state.meta || {}), updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function evidenceStatusGroup(status) {
    const value = String(status || '').trim();
    if (/partially received/i.test(value)) return 'Partially Received';
    if (/received/i.test(value)) return 'Received';
    if (/^requested$/i.test(value)) return 'Requested';
    if (/to request/i.test(value)) return 'To Request';
    return 'Other';
  }

  function domainStats() {
    const domains = unique([
      ...state.requests.map((item) => canonicalDomain(item.domain)),
      ...state.gaps.map((item) => canonicalDomain(item.domain)),
    ]);
    return domains.map((domain) => {
      const requests = state.requests.filter((item) => canonicalDomain(item.domain) === domain);
      const gaps = state.gaps.filter((item) => canonicalDomain(item.domain) === domain);
      const known = requests.filter((item) => evidenceStatusGroup(item.trackingStatus) !== 'To Request').length;
      const assessed = gaps.filter((item) => nonEmpty(item.rating));
      const maturity = assessed.length ? assessed.reduce((sum, item) => sum + (RATING_SCORE[item.rating] ?? 0), 0) / (assessed.length * 3) * 100 : 0;
      const coverage = requests.length ? known / requests.length * 100 : 0;
      const composite = (coverage + maturity) / 2;
      return { domain, requests: requests.length, known, gaps: gaps.length, assessed: assessed.length, coverage, maturity, composite };
    });
  }

  function metrics() {
    const known = state.requests.filter((item) => evidenceStatusGroup(item.trackingStatus) !== 'To Request').length;
    const assessed = state.gaps.filter((item) => nonEmpty(item.rating));
    const maturity = assessed.length ? assessed.reduce((sum, item) => sum + (RATING_SCORE[item.rating] ?? 0), 0) / (assessed.length * 3) * 100 : 0;
    const criticalOpen = state.requests.filter((item) => item.priority === 'Critical' && evidenceStatusGroup(item.trackingStatus) !== 'Received').length;
    return { known, coverage: state.requests.length ? known / state.requests.length * 100 : 0, assessed: assessed.length, maturity, criticalOpen, domains: domainStats() };
  }

  function badge(value, kind = '') {
    const label = nonEmpty(value) ? value : 'Not set';
    return `<span class="badge ${kind} ${slug(label)}">${esc(label)}</span>`;
  }

  function formatDate(value) {
    if (!nonEmpty(value)) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  function updateSyncPill(mode = apiUrl ? 'shared' : 'local', message = '') {
    const pill = $('#sync-pill');
    pill.className = `sync-pill ${mode}`;
    const copy = {
      local: ['Local mode', 'Saved on this device'],
      shared: ['Shared mode', message || 'Connected to shared data'],
      syncing: ['Synchronizing', 'Updating shared records...'],
      error: ['Sync unavailable', message || 'Using local data'],
    }[mode];
    pill.innerHTML = `<span class="live-dot"></span><div><strong>${copy[0]}</strong><small>${copy[1]}</small></div>`;
  }

  function toast(message, tone = 'success') {
    const element = $('#toast');
    element.textContent = message;
    element.className = `toast show ${tone}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.className = 'toast', 3200);
  }

  function navigate(page) {
    $$('.page').forEach((item) => item.classList.toggle('active', item.dataset.view === page));
    $$('.nav-item[data-page]').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
    $('#sidebar').classList.remove('open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'dashboard') requestAnimationFrame(renderDashboardCharts);
  }

  function renderAll() {
    renderDashboard();
    renderFilters();
    renderRequests();
    renderGaps();
    renderEvidenceCards();
    renderCompletion();
    $('#nav-request-count').textContent = state.requests.length;
    $('#nav-gap-count').textContent = state.gaps.length;
    $('#api-url').value = apiUrl;
    const updated = state.meta?.updatedAt ? new Date(state.meta.updatedAt) : new Date();
    $('#last-update').textContent = `Updated ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(updated)}`;
    updateSyncPill(apiUrl ? 'shared' : 'local');
  }

  function renderDashboard() {
    const m = metrics();
    $('#kpi-total-requests').textContent = state.requests.length;
    $('#kpi-domain-count').textContent = `Across ${m.domains.length} operational domains`;
    $('#kpi-coverage').textContent = pct(m.coverage);
    $('#kpi-known-count').textContent = `${m.known} known / current evidence items`;
    $('#kpi-maturity').textContent = pct(m.maturity);
    $('#kpi-assessed').textContent = `${m.assessed} of ${state.gaps.length} requirements assessed`;
    $('#kpi-critical').textContent = m.criticalOpen;
    $('#donut-center-value').textContent = state.requests.length;

    const statusCounts = state.requests.reduce((map, item) => {
      const group = evidenceStatusGroup(item.trackingStatus);
      map[group] = (map[group] || 0) + 1;
      return map;
    }, {});
    $('#status-legend').innerHTML = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => `<div><i style="background:${STATUS_COLORS[name]}"></i><span>${esc(name)}</span><strong>${count}</strong></div>`).join('');

    $('#domain-bars').innerHTML = m.domains.filter((item) => item.requests).map((item) => `<div class="domain-bar"><div><span title="${esc(item.domain)}">${esc(shortDomain(item.domain))}</span><strong>${pct(item.coverage)}</strong></div><div class="bar-track"><i style="width:${Math.min(100, item.coverage)}%"></i></div></div>`).join('');

    const attention = state.requests.filter((item) => ['Critical', 'High'].includes(item.priority) && evidenceStatusGroup(item.trackingStatus) !== 'Received').slice(0, 5);
    $('#attention-count').textContent = attention.length;
    $('#attention-list').innerHTML = attention.length ? attention.map((item) => `<button class="attention-row" data-edit-type="request" data-id="${esc(item.id)}"><span>${badge(item.priority, 'priority')}</span><div><strong>${esc(item.group || item.requested)}</strong><small>${esc(shortDomain(item.domain))} · ${esc(item.trackingStatus || 'Not set')}</small></div><b>${esc(item.id)}</b></button>`).join('') : '<div class="empty-state compact">No high-priority open items.</div>';

    const ratings = ['Established', 'Partially Established', 'Significant Gap', 'Not Established', 'Not Assessed'];
    const ratingCounts = ratings.map((rating) => ({ rating, count: state.gaps.filter((item) => (item.rating || 'Not Assessed') === rating).length }));
    $('#rating-summary').innerHTML = ratingCounts.map((item) => `<div><span><i style="background:${RATING_COLORS[item.rating]}"></i>${esc(item.rating)}</span><strong>${item.count}</strong><div class="mini-track"><i style="width:${state.gaps.length ? item.count / state.gaps.length * 100 : 0}%;background:${RATING_COLORS[item.rating]}"></i></div></div>`).join('');

    $('#domain-summary-body').innerHTML = m.domains.map((item) => {
      const stateLabel = item.composite >= 75 ? 'On Track' : item.composite >= 45 ? 'Needs Attention' : 'Priority Gap';
      return `<tr><td><strong>${esc(item.domain)}</strong></td><td>${item.requests}</td><td>${item.known}</td><td><div class="cell-progress"><i style="width:${item.coverage}%"></i><span>${pct(item.coverage)}</span></div></td><td><div class="cell-progress maturity"><i style="width:${item.maturity}%"></i><span>${pct(item.maturity)}</span></div></td><td>${badge(stateLabel, 'state')}</td></tr>`;
    }).join('');
    requestAnimationFrame(renderDashboardCharts);
  }

  function renderDashboardCharts() {
    const canvas = $('#status-chart');
    if (!canvas || !canvas.offsetParent) return;
    const groups = ['Received', 'Partially Received', 'Requested', 'To Request', 'Other'];
    const values = groups.map((group) => state.requests.filter((item) => evidenceStatusGroup(item.trackingStatus) === group).length);
    drawDonut(canvas, values, groups.map((group) => STATUS_COLORS[group]));
  }

  function drawDonut(canvas, values, colors) {
    const size = 220;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, size, size);
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let start = -Math.PI / 2;
    values.forEach((value, index) => {
      if (!value) return;
      const angle = value / total * Math.PI * 2;
      ctx.beginPath(); ctx.arc(size / 2, size / 2, 82, start + 0.015, start + angle - 0.015); ctx.strokeStyle = colors[index]; ctx.lineWidth = 24; ctx.lineCap = 'round'; ctx.stroke();
      start += angle;
    });
  }

  function renderFilters() {
    const requestDomain = $('#request-domain-filter').value;
    const gapDomain = $('#gap-domain-filter').value;
    const status = $('#request-status-filter').value;
    const rating = $('#gap-rating-filter').value;
    const priority = $('#gap-priority-filter').value;
    fillSelect($('#request-domain-filter'), unique(state.requests.map((item) => item.domain)), 'All domains', requestDomain);
    fillSelect($('#gap-domain-filter'), unique(state.gaps.map((item) => item.domain)), 'All domains', gapDomain);
    fillSelect($('#request-status-filter'), unique(state.requests.map((item) => item.trackingStatus)), 'All statuses', status);
    fillSelect($('#gap-rating-filter'), unique(state.gaps.map((item) => item.rating)), 'All ratings', rating);
    fillSelect($('#gap-priority-filter'), unique(state.gaps.map((item) => item.priority)), 'All priorities', priority);
  }

  function fillSelect(select, values, placeholder, selected = '') {
    select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
    select.value = selected;
  }

  function renderRequests() {
    const query = $('#request-search').value.trim().toLowerCase();
    const domain = $('#request-domain-filter').value;
    const status = $('#request-status-filter').value;
    const rows = state.requests.filter((item) => (!query || Object.values(item).some((value) => String(value || '').toLowerCase().includes(query))) && (!domain || item.domain === domain) && (!status || item.trackingStatus === status));
    $('#request-result-count').textContent = `Showing ${rows.length} of ${state.requests.length} requests`;
    $('#requests-body').innerHTML = rows.length ? rows.map((item) => `<tr><td><button class="id-link" data-edit-type="request" data-id="${esc(item.id)}">${esc(item.id)}</button></td><td><strong>${esc(item.domain)}</strong><small>${esc(item.group)}</small></td><td class="wide-cell">${esc(item.requested)}</td><td>${badge(item.priority, 'priority')}</td><td>${badge(item.trackingStatus, 'status')}</td><td>${esc(item.owner || '—')}</td><td>${formatDate(item.targetDate)}</td><td>${badge(item.reviewResult || 'Not Reviewed', 'review')}</td><td><button class="row-menu" data-edit-type="request" data-id="${esc(item.id)}" aria-label="Edit ${esc(item.id)}">•••</button></td></tr>`).join('') : emptyTableRow(9, 'No evidence requests match the current filters.');
  }

  function renderGaps() {
    const query = $('#gap-search').value.trim().toLowerCase();
    const domain = $('#gap-domain-filter').value;
    const rating = $('#gap-rating-filter').value;
    const priority = $('#gap-priority-filter').value;
    const rows = state.gaps.filter((item) => (!query || Object.values(item).some((value) => String(value || '').toLowerCase().includes(query))) && (!domain || item.domain === domain) && (!rating || item.rating === rating) && (!priority || item.priority === priority));
    $('#gap-result-count').textContent = `Showing ${rows.length} of ${state.gaps.length} requirements`;
    $('#gaps-body').innerHTML = rows.length ? rows.map((item) => `<tr><td><button class="id-link" data-edit-type="gap" data-id="${esc(item.id)}">${esc(item.id)}</button></td><td><strong>${esc(item.domain)}</strong><small>${esc(item.control)}</small></td><td>${esc(item.evidenceRefs || '—')}</td><td>${badge(item.rating || 'Not Assessed', 'rating')}</td><td class="wide-cell">${esc(item.gapIssue || item.observation || '—')}</td><td class="wide-cell">${esc(item.recommendedAction || '—')}</td><td>${badge(item.priority || 'Not set', 'priority')}</td><td><button class="row-menu" data-edit-type="gap" data-id="${esc(item.id)}" aria-label="Edit ${esc(item.id)}">•••</button></td></tr>`).join('') : emptyTableRow(8, 'No assessment requirements match the current filters.');
  }

  function emptyTableRow(columns, message) { return `<tr><td colspan="${columns}"><div class="empty-state">${message}</div></td></tr>`; }

  function renderEvidenceCards() {
    const isRegister = currentRecordTab === 'register';
    const records = isRegister ? state.evidenceRegister : state.existingEvidence;
    $('#register-tab-count').textContent = state.evidenceRegister.length;
    $('#existing-tab-count').textContent = state.existingEvidence.length;
    $$('[data-record-tab]').forEach((button) => button.classList.toggle('active', button.dataset.recordTab === currentRecordTab));
    $('#evidence-cards').innerHTML = records.length ? records.map((item) => isRegister ? `<article class="record-card"><header><div class="file-icon">${esc((item.type || 'FILE').slice(0, 4).toUpperCase())}</div><div><span>${esc(item.id)}</span><h3>${esc(item.name)}</h3></div><button class="row-menu" data-edit-type="evidence" data-id="${esc(item.id)}">•••</button></header><p>${esc(item.coverage || 'No coverage description provided.')}</p><dl><div><dt>Owner / Source</dt><dd>${esc(item.owner || '—')}</dd></div><div><dt>Received</dt><dd>${badge(item.received || 'No', 'status')}</dd></div><div><dt>Domain(s)</dt><dd>${esc(item.domains || '—')}</dd></div></dl></article>` : `<article class="record-card"><header><div class="file-icon">${esc((item.fileType || 'FILE').slice(0, 4).toUpperCase())}</div><div><span>${esc(item.id)}</span><h3>${esc(item.fileName || item.source)}</h3></div><button class="row-menu" data-edit-type="existing" data-id="${esc(item.id)}">•••</button></header><p>${esc(item.description || 'No description provided.')}</p><dl><div><dt>Source</dt><dd>${esc(item.source || '—')}</dd></div><div><dt>Working Status</dt><dd>${badge(item.workingStatus || 'Not set', 'status')}</dd></div><div><dt>Mapped Domain(s)</dt><dd>${esc(item.domains || '—')}</dd></div></dl></article>`).join('') : '<div class="empty-state">No evidence files are registered yet.</div>';
  }

  function renderCompletion() {
    const domains = domainStats();
    const overall = domains.length ? domains.reduce((sum, item) => sum + item.composite, 0) / domains.length : 0;
    $('#overall-completion').textContent = pct(overall);
    $('#overall-meter').style.width = `${overall}%`;
    $('#completion-grid').innerHTML = domains.map((item, index) => `<article class="completion-card"><header><span>${String(index + 1).padStart(2, '0')}</span><div><h3>${esc(item.domain)}</h3><p>${item.requests} evidence requests · ${item.gaps} assessment controls</p></div><strong>${pct(item.composite)}</strong></header><div class="metric-row"><span>Evidence coverage</span><div class="metric-track"><i style="width:${item.coverage}%"></i></div><b>${pct(item.coverage)}</b></div><div class="metric-row"><span>Assessment maturity</span><div class="metric-track maturity"><i style="width:${item.maturity}%"></i></div><b>${pct(item.maturity)}</b></div><footer><span>${item.known}/${item.requests} known or current</span><span>${item.assessed}/${item.gaps} assessed</span></footer></article>`).join('');
  }

  const FORM_CONFIG = {
    request: { collection: 'requests', title: 'Evidence Request', kicker: 'REQUEST TRACKER', fields: [
      ['id', 'Request ID', 'text', true], ['domain', 'Domain', 'select-domain-request', true], ['group', 'Evidence Group', 'text', true], ['requested', 'Evidence / Information Requested', 'textarea', true, 'full'], ['minimumExpected', 'Examples / Minimum Expected', 'textarea', false, 'full'], ['purpose', 'Assessment Purpose', 'textarea', false, 'full'], ['priority', 'Priority', 'select-priority', true], ['trackingStatus', 'Tracking Status', 'select-status', true], ['owner', 'SCAD Owner', 'text'], ['requestDate', 'Request Date', 'date'], ['targetDate', 'Target Date', 'date'], ['receivedDate', 'Received Date', 'date'], ['receivedFile', 'Received File / Ref', 'text', false, 'full'], ['reviewResult', 'Review Result', 'select-review'], ['reviewNotes', 'Review Notes / Gap Ref', 'textarea', false, 'full'] ] },
    gap: { collection: 'gaps', title: 'Assessment Requirement', kicker: 'GAP ASSESSMENT', fields: [
      ['id', 'ID', 'text', true], ['domain', 'Domain', 'select-domain-gap', true], ['control', 'Requirement / Control', 'text', true], ['question', 'Assessment Question', 'textarea', false, 'full'], ['typicalEvidence', 'Typical Evidence', 'textarea', false, 'full'], ['evidenceRefs', 'Evidence Ref(s)', 'text'], ['observation', 'Current Practice / Observation', 'textarea', false, 'full'], ['rating', 'Rating', 'select-rating'], ['gapIssue', 'Gap / Issue', 'textarea', false, 'full'], ['recommendedAction', 'Recommended Action', 'textarea', false, 'full'], ['priority', 'Priority', 'select-priority'] ] },
    evidence: { collection: 'evidenceRegister', title: 'Evidence File', kicker: 'EVIDENCE REGISTER', fields: [
      ['id', 'Evidence ID', 'text', true], ['name', 'Evidence Name', 'text', true], ['type', 'Type', 'text'], ['dateVersion', 'Date / Version', 'text'], ['owner', 'Owner / Source', 'text'], ['domains', 'Related Domain(s)', 'text', false, 'full'], ['coverage', 'Coverage / Relevance', 'textarea', false, 'full'], ['received', 'Received?', 'select-yesno'], ['reviewNotes', 'Review Notes', 'textarea', false, 'full'] ] },
    existing: { collection: 'existingEvidence', title: 'Current or Legacy File', kicker: 'EXISTING EVIDENCE', fields: [
      ['id', 'Evidence ID', 'text', true], ['source', 'Source', 'text', true], ['level', 'Level / Folder', 'text'], ['documentCode', 'Document Code', 'text'], ['fileName', 'Document / File Name', 'text', true], ['fileType', 'File Type', 'text'], ['description', 'Master List Description', 'textarea', false, 'full'], ['masterStatus', 'Master List Status', 'text'], ['workingStatus', 'Working Status', 'text'], ['domains', 'Mapped Domain(s)', 'text', false, 'full'] ] },
  };

  function openEditor(type, id = '') {
    const config = FORM_CONFIG[type];
    const collection = state[config.collection];
    const record = id ? collection.find((item) => item.id === id) : {};
    editing = { type, originalId: id };
    $('#modal-kicker').textContent = config.kicker;
    $('#modal-title').textContent = `${id ? 'Edit' : 'Add'} ${config.title}`;
    $('#form-fields').innerHTML = config.fields.map(([key, label, inputType, required, width]) => formField(key, label, inputType, record?.[key] || '', required, width)).join('');
    $('#modal-backdrop').hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => $('#form-fields input, #form-fields select, #form-fields textarea')?.focus(), 30);
  }

  function formField(key, label, type, value, required = false, width = '') {
    const attrs = `name="${key}" id="field-${key}" ${required ? 'required' : ''}`;
    const options = {
      'select-domain-request': unique(state.requests.map((item) => item.domain)),
      'select-domain-gap': unique(state.gaps.map((item) => item.domain)),
      'select-priority': unique(['Critical', 'High', 'Medium', 'Low', ...state.requests.map((item) => item.priority), ...state.gaps.map((item) => item.priority)]),
      'select-status': unique(['To Request', 'Requested', 'Partially Received', 'Received', ...state.requests.map((item) => item.trackingStatus)]),
      'select-review': unique(['Not Reviewed', 'Needs Clarification', 'Accepted', 'Rejected', ...state.requests.map((item) => item.reviewResult)]),
      'select-rating': ['', 'Established', 'Partially Established', 'Significant Gap', 'Not Established'],
      'select-yesno': ['Yes', 'No'],
    }[type];
    let control;
    if (type === 'textarea') control = `<textarea ${attrs} rows="3">${esc(value)}</textarea>`;
    else if (options) control = `<select ${attrs}>${options.map((option) => `<option value="${esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${esc(option || 'Not assessed')}</option>`).join('')}</select>`;
    else control = `<input ${attrs} type="${type}" value="${esc(value)}" />`;
    return `<label class="form-field ${width === 'full' ? 'full' : ''}"><span>${esc(label)}${required ? ' *' : ''}</span>${control}</label>`;
  }

  function closeEditor() {
    $('#modal-backdrop').hidden = true;
    document.body.classList.remove('modal-open');
    editing = null;
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editing) return;
    const config = FORM_CONFIG[editing.type];
    const formData = new FormData(event.currentTarget);
    const record = Object.fromEntries(config.fields.map(([key]) => [key, String(formData.get(key) || '').trim()]));
    const collection = state[config.collection];
    const duplicate = collection.some((item) => item.id === record.id && item.id !== editing.originalId);
    if (duplicate) return toast(`The ID ${record.id} already exists.`, 'error');
    const index = collection.findIndex((item) => item.id === editing.originalId);
    if (index >= 0) collection[index] = { ...collection[index], ...record };
    else collection.unshift(record);
    saveLocalState(); closeEditor(); renderAll(); toast('Record saved successfully.'); await pushRemote();
  }

  async function deleteRecord(type, id) {
    const config = FORM_CONFIG[type];
    if (!confirm(`Delete ${id}? This action cannot be undone.`)) return;
    state[config.collection] = state[config.collection].filter((item) => item.id !== id);
    saveLocalState(); closeEditor(); renderAll(); toast(`${id} deleted.`); await pushRemote();
  }

  async function pullRemote() {
    if (!apiUrl) return false;
    updateSyncPill('syncing');
    try {
      const response = await fetch(`${apiUrl}${apiUrl.includes('?') ? '&' : '?'}t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const remote = payload.data || payload;
      const count = ['requests', 'gaps', 'evidenceRegister', 'existingEvidence'].reduce((sum, key) => sum + (remote[key]?.length || 0), 0);
      if (count) { state = { ...clone(seed), ...remote, meta: { updatedAt: new Date().toISOString() } }; saveLocalState(); renderAll(); updateSyncPill('shared'); return true; }
      return false;
    } catch (error) { updateSyncPill('error', 'Using local data'); toast(`Shared sync failed: ${error.message}`, 'error'); return false; }
  }

  async function pushRemote() {
    if (!apiUrl) return;
    updateSyncPill('syncing');
    try {
      const response = await fetch(apiUrl, { method: 'POST', body: JSON.stringify({ action: 'replaceAll', data: state }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.ok === false) throw new Error(result.error || 'Unknown service error');
      updateSyncPill('shared', 'All changes synchronized');
    } catch (error) { updateSyncPill('error', 'Changes remain local'); toast(`Saved locally; shared sync failed: ${error.message}`, 'error'); }
  }

  async function smartSync() {
    if (!apiUrl) return toast('Add a Google Apps Script URL first.', 'error');
    const loaded = await pullRemote();
    if (!loaded) { await pushRemote(); toast('Shared database initialized with the current records.'); }
    else toast('Latest shared records loaded.');
  }

  function requireXlsx() {
    if (!window.XLSX) { toast('The Excel library could not load. Check the internet connection and try again.', 'error'); return false; }
    return true;
  }

  function sheetFromRecords(headers, keys, records) {
    return XLSX.utils.aoa_to_sheet([headers, ...records.map((record) => keys.map((key) => record[key] ?? ''))]);
  }

  function exportGapWorkbook() {
    if (!requireXlsx()) return;
    const workbook = XLSX.utils.book_new();
    const gapKeys = ['id','domain','control','question','typicalEvidence','evidenceRefs','observation','rating','gapIssue','recommendedAction','priority'];
    const gapHeaders = ['ID','Domain','Requirement / Control','Assessment Question','Typical Evidence','Evidence Ref(s)','Current Practice / Observation','Rating','Gap / Issue','Recommended Action','Priority'];
    const evidenceKeys = ['id','name','type','dateVersion','owner','domains','coverage','received','reviewNotes'];
    const evidenceHeaders = ['Evidence ID','Evidence Name','Type','Date / Version','Owner / Source','Related Domain(s)','Coverage / Relevance','Received?','Review Notes'];
    XLSX.utils.book_append_sheet(workbook, sheetFromRecords(gapHeaders, gapKeys, state.gaps), 'Gap Assessment');
    XLSX.utils.book_append_sheet(workbook, sheetFromRecords(evidenceHeaders, evidenceKeys, state.evidenceRegister), 'Evidence Register');
    XLSX.writeFile(workbook, 'SCAD-Gap-Assessment-Updated.xlsx');
    toast('Updated gap assessment workbook downloaded.');
  }

  function exportEvidenceWorkbook() {
    if (!requireXlsx()) return;
    const workbook = XLSX.utils.book_new();
    const requestKeys = ['id','domain','group','requested','minimumExpected','purpose','priority','legacyReference','trackingStatus','owner','requestDate','targetDate','receivedDate','receivedFile','reviewResult','reviewNotes'];
    const requestHeaders = ['Request ID','Domain','Evidence Group','Evidence / Information Requested','Examples / Minimum Expected','Assessment Purpose','Priority','Known Existing / Legacy Reference','Tracking Status','SCAD Owner','Request Date','Target Date','Received Date','Received File / Ref','Review Result','Review Notes / Gap Ref'];
    const existingKeys = ['id','source','level','documentCode','fileName','fileType','description','masterStatus','workingStatus','domains'];
    const existingHeaders = ['Evidence ID','Source','Level / Folder','Document Code','Document / File Name','File Type','Master List Description','Master List Status','Working Status','Mapped Domain(s)'];
    XLSX.utils.book_append_sheet(workbook, sheetFromRecords(requestHeaders, requestKeys, state.requests), 'Request Tracker');
    XLSX.utils.book_append_sheet(workbook, sheetFromRecords(existingHeaders, existingKeys, state.existingEvidence), 'Existing Evidence');
    XLSX.writeFile(workbook, 'SCAD-Evidence-Tracking-Updated.xlsx');
    toast('Updated evidence tracking workbook downloaded.');
  }

  function rowsFromSheet(sheet, headerRow, keys) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    return rows.slice(headerRow).filter((row) => nonEmpty(row[0])).map((row) => Object.fromEntries(keys.map((key, index) => [key, String(row[index] ?? '').trim()])));
  }

  async function importExcel(files) {
    if (!files.length || !requireXlsx()) return;
    let changed = false;
    for (const file of files) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      if (workbook.Sheets['Request Tracker']) { state.requests = rowsFromSheet(workbook.Sheets['Request Tracker'], 5, ['id','domain','group','requested','minimumExpected','purpose','priority','legacyReference','trackingStatus','owner','requestDate','targetDate','receivedDate','receivedFile','reviewResult','reviewNotes']); changed = true; }
      if (workbook.Sheets['Existing Evidence']) { state.existingEvidence = rowsFromSheet(workbook.Sheets['Existing Evidence'], 5, ['id','source','level','documentCode','fileName','fileType','description','masterStatus','workingStatus','domains']); changed = true; }
      if (workbook.Sheets['Gap Assessment']) { state.gaps = rowsFromSheet(workbook.Sheets['Gap Assessment'], 6, ['id','domain','control','question','typicalEvidence','evidenceRefs','observation','rating','gapIssue','recommendedAction','priority']); changed = true; }
      if (workbook.Sheets['Evidence Register']) { state.evidenceRegister = rowsFromSheet(workbook.Sheets['Evidence Register'], 5, ['id','name','type','dateVersion','owner','domains','coverage','received','reviewNotes']); changed = true; }
    }
    if (!changed) return toast('No recognized source worksheets were found.', 'error');
    saveLocalState(); renderAll(); toast('Excel data imported successfully.'); await pushRemote();
  }

  function clearRequestFilters() { $('#request-search').value = ''; $('#request-domain-filter').value = ''; $('#request-status-filter').value = ''; renderRequests(); }
  function clearGapFilters() { $('#gap-search').value = ''; $('#gap-domain-filter').value = ''; $('#gap-rating-filter').value = ''; $('#gap-priority-filter').value = ''; renderGaps(); }

  document.addEventListener('click', async (event) => {
    const pageButton = event.target.closest('[data-page]');
    const pageLink = event.target.closest('[data-page-link]');
    const editor = event.target.closest('[data-edit-type]');
    const action = event.target.closest('[data-action]')?.dataset.action;
    const tab = event.target.closest('[data-record-tab]');
    if (pageButton) navigate(pageButton.dataset.page);
    if (pageLink) navigate(pageLink.dataset.pageLink);
    if (editor) openEditor(editor.dataset.editType, editor.dataset.id);
    if (tab) { currentRecordTab = tab.dataset.recordTab; renderEvidenceCards(); }
    if (action === 'add-request') openEditor('request');
    if (action === 'add-gap') openEditor('gap');
    if (action === 'add-evidence') openEditor(currentRecordTab === 'register' ? 'evidence' : 'existing');
    if (action === 'export-gap') exportGapWorkbook();
    if (action === 'export-evidence') exportEvidenceWorkbook();
    if (action === 'export') { exportGapWorkbook(); setTimeout(exportEvidenceWorkbook, 350); }
    if (action === 'clear-request-filters') clearRequestFilters();
    if (action === 'clear-gap-filters') clearGapFilters();
    if (action === 'save-api') { apiUrl = $('#api-url').value.trim(); localStorage.setItem(API_KEY, apiUrl); updateSyncPill(apiUrl ? 'shared' : 'local'); toast(apiUrl ? 'Shared data URL saved.' : 'Returned to local-only mode.'); if (apiUrl) await smartSync(); }
    if (action === 'sync-now') await smartSync();
    if (action === 'reset-data' && confirm('Restore the original records and discard all local edits?')) { state = clone(seed); saveLocalState(); renderAll(); toast('Original workbook data restored.'); await pushRemote(); }
  });

  $('#record-form').addEventListener('submit', saveEditor);
  $('#modal-close').addEventListener('click', closeEditor);
  $('#modal-cancel').addEventListener('click', closeEditor);
  $('#modal-backdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeEditor(); });
  $('#mobile-menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#excel-import').addEventListener('change', (event) => importExcel([...event.target.files]));
  ['request-search','request-domain-filter','request-status-filter'].forEach((id) => $(`#${id}`).addEventListener('input', renderRequests));
  ['gap-search','gap-domain-filter','gap-rating-filter','gap-priority-filter'].forEach((id) => $(`#${id}`).addEventListener('input', renderGaps));
  $('#global-search').addEventListener('input', (event) => {
    const value = event.target.value;
    const isGap = state.gaps.some((item) => String(item.id).toLowerCase().includes(value.toLowerCase()));
    if (!value) return;
    if (isGap) { $('#gap-search').value = value; renderGaps(); navigate('gaps'); }
    else { $('#request-search').value = value; renderRequests(); navigate('requests'); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#modal-backdrop').hidden) closeEditor(); });
  window.addEventListener('resize', () => requestAnimationFrame(renderDashboardCharts));

  renderAll();
  if (apiUrl) pullRemote();
})();
