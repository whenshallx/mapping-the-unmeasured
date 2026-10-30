import {bindDisclaimer} from './disclaimer.js?v=disclaimer-header-2';
import {api as browserAPI,bindDownloads} from './browser-api.js';
import { createHero } from './hero.js';

// Editable exhibit defaults. Numerical predictions use the selected archived model.
const SETTINGS = { sessionKey: 'mapping-the-unmeasured.pages.current.v1', previewDelay: 320, resultsPerPage: 12 };
const FEATURE_NAMES = ['State', 'Seams', 'Walls', 'Layer Height mm', 'Bead mm', 'Infill Density', 'Overlap'];
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const number = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
let state = null;
let hero = null;
let scene = null;
let pointMap = new Map();
let mode = 'prediction';
let selectedId = null;
let previewTimer = null;
let previewAbort = null;
let previewSequence = 0;
let lastPrediction = null;
let targetResponse = null;
let targetVisible = SETTINGS.resultsPerPage;
let breathing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let referenceVisible = true;
let modelSwitching = false;
const modelDeltas = new Map();
let toastTimer = null;
let drawerPreviousFocus = null;
let isSubmittingPrediction = false;

async function api(path,body,options={}) { return browserAPI(path,body,options); }

function sessionURL(path) { return `${path}${path.includes('?') ? '&' : '?'}session=${encodeURIComponent(state.session_id)}`; }
function saveSession(id) { try { localStorage.setItem(SETTINGS.sessionKey, id); } catch {} }
function storedSession() { try { return localStorage.getItem(SETTINGS.sessionKey); } catch { return null; } }
function showError(id, error) { const element = $(`#${id}`); element.textContent = error?.message || String(error); element.hidden = false; }
function clearError(id) { $(`#${id}`).hidden = true; }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function busy(button, enabled) { button.disabled = enabled; button.classList.toggle('button-busy', enabled); }
function scrollToMessage(element) {
  if (matchMedia('(max-width:760px)').matches) { element.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  const scroll = $('#conversation-scroll');
  scroll.scrollTo({ top: Math.max(0, element.offsetTop - scroll.offsetTop - 20), behavior: 'smooth' });
}
function shortRecipe(features) {
  return `${features.State} · ${features.Seams.toLowerCase()} seams · ${features.Walls} wall${Number(features.Walls) === 1 ? '' : 's'} · layer ${number(features['Layer Height mm'])} mm · bead ${number(features['Bead mm'])} mm · infill ${number(features['Infill Density'])} · overlap ${number(features.Overlap)}`;
}
function makeMessage(thread, type, html, extraClass = '') {
  const article = document.createElement('article');
  article.className = `message ${type}-message ${extraClass}`;
  article.innerHTML = `<div class="message-author">${type === 'assistant' ? '<span class="assistant-avatar">m</span> THE MODEL' : 'YOU'} <span class="message-time">JUST NOW</span></div><div class="message-content">${html}</div>`;
  $(`#${thread}-thread`).append(article);
  return article;
}
function featuresFromForm() {
  const data = new FormData($('#prediction-form'));
  return Object.fromEntries(FEATURE_NAMES.map(key => [key, ['State', 'Seams'].includes(key) ? data.get(key) : Number(data.get(key))]));
}
function paintRange(range) { range.style.setProperty('--range-progress', `${100 * (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))}%`); }
function updateInfillConstraint() {
  const full = Number($('#infill-density').value) >= 1;
  if (full) {
    $('#overlap').value = '1';
    $('#overlap-number').value = '1';
    paintRange($('#overlap'));
  }
  $('#overlap').disabled = full;
  $('#overlap-number').disabled = full;
  // Disabled fields do not enter FormData, so preserve a hidden value at full infill.
  let hidden = $('#full-infill-overlap');
  if (full && !hidden) { hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = 'Overlap'; hidden.value = '1'; hidden.id = 'full-infill-overlap'; $('#prediction-form').append(hidden); }
  if (!full && hidden) hidden.remove();
  $('#recipe-note').textContent = full ? 'Full infill selected. Overlap is fixed to 1.00.' : 'At full infill, overlap is fixed to 1.00.';
}

function selectPoint(point, label = 'SELECTED PREDICTION', detail = '') {
  if (!point) return;
  selectedId = point['Sample ID'] || point.sample_id || null;
  hero?.setQuery(point);
  $('#hero-readout').hidden = false;
  $('#readout-label').textContent = label;
  $('#readout-value').innerHTML = `${number(point.prediction_mpa)} <small>MPa</small>`;
  $('#readout-detail').textContent = detail || selectedId || '';
}
function clearSelection() {
  selectedId = null;
  hero?.setQuery(null);
  $('#hero-readout').hidden = true;
  $$('.recipe-result.active').forEach(element => element.classList.remove('active'));
}

async function loadScene() {
  $('#hero-loading').hidden = false;
  try {
    let nextScene;
    if (!scene) nextScene = await api(state.scene_url || sessionURL('/api/scene'));
    else {
      const delta = await fetchModelDelta(state.n_train);
      nextScene = {...scene, ...delta, mesh:{...scene.mesh,...delta.mesh},
        points:scene.points.map((point,index)=>({...point,...delta.point_values[index]}))};
      delete nextScene.point_values;
    }
    scene = nextScene;
    pointMap = new Map((scene.points || []).map(point => [point['Sample ID'], point]));
    await hero?.setScene(scene);
    updateHeroHighlights();
    $('#hero-loading').hidden = true;
  } catch (error) {
    $('#hero-loading').innerHTML = `<span>The landscape could not load. ${escapeHTML(error.message)}</span>`;
    throw error;
  }
}
function updateHeroHighlights() {
  if (!hero || !state) return;
  if (mode === 'targeting') hero.highlight((targetResponse?.matches || []).map(item => item.sample_id), { kind: 'target' });
  else hero.highlight([], { kind: 'prediction' });
}

function applyState(nextState) {
  state = nextState;
  saveSession(state.session_id);
  const training = modelSwitching;
  $('#sample-count').textContent = state.n_train;
  $('#history-n').textContent = state.n_train;
  $('#header-status').textContent = training ? 'SWITCHING MODEL' : `MODEL TRAINED ON ${state.n_train} SAMPLES`;
  $('#session-label').textContent = `SESSION ${String(state.session_id).slice(-6).toUpperCase()}`;
  $('#model-round').textContent = `ROUND ${String(state.round).padStart(2, '0')} · ADAPTIVE TUNING`;
  $('#data-download').href = sessionURL('/api/download');
  $('.site-header').classList.remove('status-offline');
  renderModelPicker();
  renderHistory();
  updateHeroHighlights();
  $('#prediction-submit').disabled = training || isSubmittingPrediction;
  $('#targeting-submit').disabled = training;
  $('#new-session').disabled = training;
  $('#clear-session').disabled = training;
  if ($('#session-select')) $('#session-select').disabled = training;
}

function fetchModelDelta(n) {
  if (!modelDeltas.has(n)) modelDeltas.set(n,api(`/api/model-delta?n=${n}`).catch(error=>{modelDeltas.delete(n);throw error;}));
  return modelDeltas.get(n);
}
function renderModelPicker() {
  if (!state) return;
  $('#model-selector').innerHTML = state.models.map(model=>`<button type="button" class="model-stage${model.n_train===state.n_train?' active':''}" data-model-n="${model.n_train}" aria-pressed="${model.n_train===state.n_train}"${modelSwitching?' disabled':''}><span>n =</span><strong>${model.n_train}</strong></button>`).join('');
  const m=state.metrics.test;
  $('#model-metrics').innerHTML=`<div class="message-author"><span class="assistant-avatar">m</span> THE MODEL <span class="message-time">n = ${state.n_train}</span></div><div class="stage-metric-grid"><div><span>R²</span><strong>${number(m.r2,3)}</strong></div><div><span>RMSE / MPa</span><strong>${number(m.rmse_mpa,3)}</strong></div><div><span>MAE / MPa</span><strong>${number(m.mae_mpa,3)}</strong></div></div>`;
  $('#models-table').innerHTML=state.models.map(model=>{const m=model.metrics.test;return `<tr class="${model.n_train===state.n_train?'selected-stage':''}" aria-current="${model.n_train===state.n_train}"><th scope="row">${model.n_train}</th><td>${number(m.r2,3)}</td><td>${number(m.rmse_mpa,3)}</td><td>${number(m.mae_mpa,3)}</td></tr>`;}).join('');
}
async function switchModel(n) {
  if (modelSwitching || n===state.n_train) return;
  clearError('iteration-error');
  const previous=state;
  modelSwitching=true;
  clearConversationResults();
  applyState(state);
  try {
    const next=await api('/api/model',{session:state.session_id,n_train:n});
    applyState(next); await loadScene();
  } catch(error) {
    try { applyState(await api('/api/model',{session:previous.session_id,n_train:previous.n_train})); await loadScene(); } catch {}
    showError('iteration-error',error);
  } finally { modelSwitching=false; applyState(state); }
}

function renderHistory() {
  const metrics = state.metrics?.test || {};
  $('#metric-rmse').textContent = number(metrics.rmse_mpa, 3);
  $('#metric-r2').textContent = number(metrics.r2, 3);
  $('#metric-mae').textContent = number(metrics.mae_mpa, 3);
  const history = state.history || [];
  $('#history-list').innerHTML = [...history].reverse().map((item, index) => `<div class="history-row${item.n_train===state.n_train ? ' current' : ''}"><i aria-hidden="true"></i><div><strong>${Number(item.n_train)} samples${item.n_train===state.n_train ? ' · current model' : ''}</strong><small>ROUND ${String(item.round).padStart(2, '0')} · ${item.source === 'session' ? 'THIS SESSION' : 'BASELINE ARCHIVE'} · R² ${number(item.metrics?.test?.r2, 3)}</small></div><span>${number(item.metrics?.test?.rmse_mpa, 3)} MPa</span></div>`).join('');
  const chartData = history.map(item => ({ n: Number(item.n_train), value: Number(item.metrics?.test?.rmse_mpa) })).filter(item => Number.isFinite(item.n) && Number.isFinite(item.value));
  if (!chartData.length) { $('#learning-chart').innerHTML = '<div class="chart-empty">Evaluation metrics will appear here.</div>'; return; }
  const width = 370, height = 120, padX = 20, padTop = 17, padBottom = 22;
  const minN = Math.min(...chartData.map(d => d.n)), maxN = Math.max(...chartData.map(d => d.n));
  const minV = Math.min(...chartData.map(d => d.value)) * .9, maxV = Math.max(...chartData.map(d => d.value)) * 1.1;
  const x = n => padX + (n - minN) / (maxN - minN || 1) * (width - 2 * padX);
  const y = v => padTop + (1 - (v - minV) / (maxV - minV || 1)) * (height - padTop - padBottom);
  const path = chartData.map((d, i) => `${i ? 'L' : 'M'} ${x(d.n).toFixed(1)} ${y(d.value).toFixed(1)}`).join(' ');
  const labels = [chartData[0], chartData.at(-1)].filter((d, i, a) => !i || d.n !== a[0].n);
  $('#learning-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Test RMSE changes from ${number(chartData[0].value, 3)} to ${number(chartData.at(-1).value, 3)} megapascals"><line x1="${padX}" x2="${width - padX}" y1="${height - padBottom}" y2="${height - padBottom}" stroke="#dce4d3"/><path d="${path}" fill="none" stroke="#53734a" stroke-width="1.2"/>${chartData.map((d, i) => `<circle cx="${x(d.n)}" cy="${y(d.value)}" r="${i === chartData.length - 1 ? 3 : 2}" fill="${i === chartData.length - 1 ? '#c86c3a' : '#53734a'}"><title>n = ${d.n}, RMSE = ${number(d.value, 3)} MPa</title></circle>`).join('')}${labels.map(d => `<text x="${x(d.n)}" y="${height - 6}" text-anchor="middle">n = ${d.n}</text>`).join('')}<text x="${width - padX}" y="10" text-anchor="end">RMSE / MPa</text></svg>`;
}

async function previewPrediction() {
  if (!state || isSubmittingPrediction || modelSwitching || !$('#prediction-form').checkValidity()) return;
  previewAbort?.abort();
  previewAbort = new AbortController();
  const sequence = ++previewSequence;
  try {
    const response = await api('/api/predict', { session: state.session_id, features: featuresFromForm() }, { signal: previewAbort.signal });
    if (sequence !== previewSequence || mode !== 'prediction') return;
    lastPrediction = response;
    selectPoint(response.point, 'RECIPE PREVIEW', response.in_candidate_space ? 'Your recipe in the candidate landscape' : 'Your recipe · projected onto the fixed map');
  } catch (error) { if (error.name !== 'AbortError') { /* Live previews stay quiet; submission exposes actionable errors. */ } }
}
function queuePredictionPreview() { clearTimeout(previewTimer); previewTimer = setTimeout(previewPrediction, SETTINGS.previewDelay); }

async function submitPrediction(event) {
  event.preventDefault();
  if (!state || isSubmittingPrediction || modelSwitching) return;
  clearError('prediction-error');
  clearTimeout(previewTimer);
  previewAbort?.abort();
  previewSequence++;
  const features = featuresFromForm();
  const requestedState = state;
  isSubmittingPrediction = true;
  busy($('#prediction-submit'), true);
  try {
    const response = await api('/api/predict', { session: state.session_id, features });
    if (state !== requestedState || modelSwitching) return;
    lastPrediction = response;
    makeMessage('prediction', 'visitor', `<p>${escapeHTML(shortRecipe(features))}</p>`);
    const result = makeMessage('prediction', 'assistant', `<p>For this recipe, I predict a compressive strength of</p><div class="result-value">${number(response.prediction_mpa)}<small>MPa</small></div><div class="result-meta">${response.in_candidate_space ? escapeHTML(response.sample_id || 'Candidate recipe') : 'CUSTOM RECIPE · APPROXIMATE MAP LOCATION'}</div><button type="button" class="result-link" data-prediction-index="${Date.now()}">Locate this prediction ↗</button>`, 'prediction-result');
    $('button', result).addEventListener('click', () => selectPoint(response.point, 'YOUR PREDICTION', response.in_candidate_space ? response.sample_id : 'Custom recipe · approximate map location'));
    selectPoint(response.point, 'YOUR PREDICTION', response.in_candidate_space ? response.sample_id : 'Custom recipe · approximate map location');
    scrollToMessage(result);
  } catch (error) { showError('prediction-error', error); }
  finally { isSubmittingPrediction = false; busy($('#prediction-submit'), modelSwitching); }
}

function renderTargetResults() {
  if (!targetResponse) return;
  const response = targetResponse;
  const matches = response.matches || [];
  const isNearest = !matches.length;
  const displayed = isNearest ? (response.nearest || []) : matches.slice(0, targetVisible);
  const container = $('#target-results');
  container.hidden = false;
  container.innerHTML = `<div class="target-result-summary"><strong>${response.count ? `${response.count} possible recipe${response.count === 1 ? '' : 's'}` : 'Let’s get closer.'}</strong><p>${response.count ? `Predicted within ${number(response.tolerance_mpa)} MPa of your ${number(response.target_mpa)} MPa target.` : 'No candidate falls inside this range. Here are the closest recipes; try a wider tolerance to find more.'}</p></div><div class="target-result-tools"><span>${isNearest ? 'CLOSEST CANDIDATES' : `${response.total_candidates.toLocaleString()} CANDIDATES SEARCHED`}</span>${matches.length ? `<a class="text-button" href="${sessionURL('/api/target-download')}&target_mpa=${encodeURIComponent(response.target_mpa)}&tolerance_mpa=${encodeURIComponent(response.tolerance_mpa)}" download>Download all ↓</a>` : ''}</div><div class="target-recipes">${displayed.map(item => `<button class="recipe-result${selectedId === item.sample_id ? ' active' : ''}" type="button" data-target-id="${escapeHTML(item.sample_id)}"><span class="recipe-result-heading"><span>${escapeHTML(item.sample_id)}</span><strong>${number(item.prediction_mpa)}<small>MPa</small></strong></span><span class="recipe-result-description">${escapeHTML(shortRecipe(item.features))}</span></button>`).join('')}</div>${!isNearest && targetVisible < matches.length ? `<button class="show-more" type="button" id="target-show-more">Show ${Math.min(SETTINGS.resultsPerPage, matches.length - targetVisible)} more · ${targetVisible} / ${matches.length}</button>` : ''}${!displayed.length ? '<p class="empty-result">No candidates are available for this search.</p>' : ''}`;
  container.insertAdjacentHTML('afterbegin', '<div class="message-author"><span class="assistant-avatar">m</span> THE MODEL <span class="message-time">JUST NOW</span></div>');
}

async function submitTarget(event) {
  event.preventDefault();
  if (!state || modelSwitching) return;
  const requestedState = state;
  clearError('targeting-error');
  busy($('#targeting-submit'), true);
  const target = Number($('#target-strength').value), tolerance = Number($('#target-tolerance').value);
  try {
    const response = await api('/api/target', { session: state.session_id, target_mpa: target, tolerance_mpa: tolerance });
    if (state !== requestedState || modelSwitching) return;
    targetResponse = response;
    targetVisible = SETTINGS.resultsPerPage;
    makeMessage('targeting', 'visitor', `<p>I’m looking for <strong>${number(target)} MPa</strong>, with an allowed difference of ±${number(tolerance)} MPa.</p>`);
    renderTargetResults();
    clearSelection();
    updateHeroHighlights();
    scrollToMessage($('#target-results'));
  } catch (error) { showError('targeting-error', error); }
  finally { busy($('#targeting-submit'), modelSwitching); }
}

function setMode(next) {
  mode = next;
  $$('.mode-tab').forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  $$('.mode-panel').forEach(panel => { panel.hidden = panel.id !== `panel-${mode}`; });
  updateHeroHighlights();
  if (mode === 'prediction' && lastPrediction) selectPoint(lastPrediction.point, 'YOUR RECIPE', lastPrediction.sample_id || 'Custom recipe');
  else clearSelection();
  $('#conversation-scroll').scrollTop = 0;
}

async function openHistory() {
  drawerPreviousFocus = document.activeElement;
  $('#drawer-backdrop').hidden = false;
  $('#history-drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#history-close').focus();
  renderHistory();
  try {
    const response = await api('/api/sessions');
    let container = $('#session-switcher');
    if (!container) {
      container = document.createElement('div');
      container.id = 'session-switcher';
      container.style.marginTop = '16px';
      $('.history-current').append(container);
    }
    const sessions = response.sessions || [];
    container.innerHTML = sessions.length > 1 ? `<label class="subtle-label" for="session-select">EXPLORE A SAVED SESSION</label><select id="session-select" aria-label="Select a saved learning session"${modelSwitching ? ' disabled' : ''} style="width:100%;padding:9px 10px;background:transparent;border:1px solid #d9e1d0;color:#6d7c60;font:9px var(--mono)">${sessions.map(item => `<option value="${escapeHTML(item.session_id)}"${item.session_id === state.session_id ? ' selected' : ''}>${escapeHTML(item.session_id.slice(-6).toUpperCase())} · ${item.n_train} samples</option>`).join('')}</select>` : '';
  } catch { /* Session switching is supplemental; current history and download remain available. */ }
}
function closeHistory() { $('#drawer-backdrop').hidden = true; $('#history-drawer').hidden = true; document.body.style.overflow = ''; drawerPreviousFocus?.focus(); }

function clearConversationResults() {
  previewAbort?.abort();
  clearTimeout(previewTimer);
  previewSequence++;
  ['prediction', 'iteration', 'targeting'].forEach(name => { const messages = $$(`#${name}-thread > .message`); messages.slice(1).forEach(message => message.remove()); });
  lastPrediction = null;
  targetResponse = null;
  $('#target-results').hidden = true;
  ['prediction-error', 'targeting-error', 'iteration-error', 'session-error'].forEach(clearError);
  clearSelection();
}
async function changeSession(action) {
  clearError('session-error');
  const button = action === 'new' ? $('#new-session') : $('#clear-session');
  if (action === 'reset' && !confirm('Return to a fresh exploration at n = 120? Your saved exploration remains available in history.')) return;
  busy(button, true);
  try {
    const next = await api(action === 'new' ? '/api/sessions' : '/api/reset', action === 'new' ? {} : { session: state.session_id });
    clearConversationResults();
    applyState(next);
    await loadScene();
    closeHistory();
    toast(action === 'new' ? 'A new learning session begins at n = 120.' : 'Session reset to the original 120 samples.');
  } catch (error) { showError('session-error', error); }
  finally { busy(button, false); }
}

function bindEvents() {
  bindDisclaimer();
  $$('.mode-tab').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('.mode-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('.mode-tab');
    const active = tabs.findIndex(tab => tab.dataset.mode === mode);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (active + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); setMode(tabs[next].dataset.mode); tabs[next].focus();
  });
  $$('.range-field input[type=range]').forEach(range => {
    const numeric = $(`#${range.id}-number`);
    paintRange(range);
    range.addEventListener('input', () => { numeric.value = Number(range.value).toFixed(2); paintRange(range); updateInfillConstraint(); queuePredictionPreview(); });
    numeric.addEventListener('input', () => { if (numeric.value === '' || !numeric.checkValidity()) return; range.value = numeric.value; paintRange(range); updateInfillConstraint(); queuePredictionPreview(); });
    numeric.addEventListener('change', () => { numeric.value = Math.max(Number(numeric.min), Math.min(Number(numeric.max), Number(numeric.value || numeric.min))); range.value = numeric.value; paintRange(range); updateInfillConstraint(); queuePredictionPreview(); });
  });
  $$('#prediction-form input[type=radio]').forEach(input => input.addEventListener('change', queuePredictionPreview));
  $('#prediction-form').addEventListener('submit', submitPrediction);
  $('#targeting-form').addEventListener('submit', submitTarget);
  $('#model-selector').addEventListener('click',event=>{const button=event.target.closest('[data-model-n]');if(button)switchModel(Number(button.dataset.modelN));});
  $('#target-results').addEventListener('click', event => {
    const more = event.target.closest('#target-show-more');
    if (more) { targetVisible += SETTINGS.resultsPerPage; renderTargetResults(); return; }
    const button = event.target.closest('[data-target-id]');
    if (!button || !targetResponse) return;
    const item = [...(targetResponse.matches || []), ...(targetResponse.nearest || [])].find(candidate => candidate.sample_id === button.dataset.targetId);
    if (item) { selectPoint(item.point || pointMap.get(item.sample_id), 'TARGET CANDIDATE', item.sample_id); renderTargetResults(); }
  });
  $('#hero-reset').addEventListener('click', () => hero?.resetView());
  $('#hero-motion').addEventListener('click', () => { breathing = !breathing; hero?.setBreathing(breathing); updateMotionButton(); });
  $('#hero-reference').addEventListener('click', () => {
    referenceVisible = !referenceVisible;
    hero?.setReferenceVisible(referenceVisible);
    $('#hero-reference').setAttribute('aria-pressed', String(referenceVisible));
    $('#hero-reference').setAttribute('aria-label', `${referenceVisible ? 'Hide' : 'Show'} ground truth`);
  });
  $('#selection-clear').addEventListener('click', clearSelection);
  $('#history-open').addEventListener('click', openHistory);
  $('#history-close').addEventListener('click', closeHistory);
  $('#drawer-backdrop').addEventListener('click', closeHistory);
  $('#new-session').addEventListener('click', () => changeSession('new'));
  $('#clear-session').addEventListener('click', () => changeSession('reset'));
  $('#history-drawer').addEventListener('change', async event => {
    if (event.target.id !== 'session-select') return;
    try { clearConversationResults(); applyState(await api(`/api/state?session=${encodeURIComponent(event.target.value)}`)); await loadScene(); toast('Saved session opened.'); }
    catch (error) { showError('session-error', error); }
  });
  document.addEventListener('keydown', event => {
    if ($('#history-drawer').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeHistory(); }
    if (event.key === 'Tab') { const elements = $$('button:not(:disabled), a[href], select', $('#history-drawer')); const first = elements[0], last = elements.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  updateInfillConstraint();
  updateMotionButton();
}
function updateMotionButton() {
  $('#hero-motion').setAttribute('aria-pressed', String(breathing));
  $('#hero-motion').title = breathing ? 'Pause breathing animation' : 'Resume breathing animation';
  $('#hero-motion').innerHTML = `<span aria-hidden="true">${breathing ? 'Ⅱ' : '▷'}</span><span class="sr-only">${breathing ? 'Pause' : 'Resume'} breathing animation</span>`;
}

async function boot() {
  bindEvents();
  bindDownloads();
  $('#prediction-submit').disabled = true;
  $('#targeting-submit').disabled = true;
  try {
    const saved = storedSession();
    let initial;
    if (saved) {
      try { initial = await api(`/api/state?session=${encodeURIComponent(saved)}`); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    if (!initial) initial = await api('/api/sessions', {});
    applyState(initial);
    hero = await createHero($('#hero-canvas'), { onSelect: point => { selectPoint(point, point.trained ? 'TRAINING SAMPLE' : 'CANDIDATE PREDICTION', `${point['Sample ID']}${point.trained ? ' · used in current training' : ''}`); } });
    hero.setBreathing(breathing);
    hero.setReferenceVisible(referenceVisible);
    await loadScene();
    // Other models load on demand to keep the first phone visit light.
  } catch (error) {
    $('.site-header').classList.add('status-offline');
    $('#header-status').textContent = 'MODEL COULD NOT LOAD';
    showError('prediction-error', new Error(`${error.message} Check your connection, then reload this page.`));
    $('#hero-loading').innerHTML = `<span>The model could not be opened. ${escapeHTML(error.message)}</span>`;
    $('#history-open').disabled = !state;
  }
}

boot();

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register(new URL('./sw.js',import.meta.url),{updateViaCache:'none'}).catch(()=>{}));
