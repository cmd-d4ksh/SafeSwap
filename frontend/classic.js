// Frontend only renders what the Java API returns. No search/safety logic lives here.
const API = new URLSearchParams(location.search).get('api')
  || (location.port === '5173' || location.protocol === 'file:' ? 'http://localhost:8085' : ''); // same origin when the Java server hosts the site
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options) {
  let res;
  try {
    res = await fetch(API + path, options);
  } catch (e) {
    throw new Error(`Cannot reach the API at ${API}. Is the backend running (cd backend && mvn spring-boot:run)?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `HTTP ${res.status}`);
    err.hints = body.hints || [];
    err.code = body.code;
    throw err;
  }
  return body;
}

function showError(target, err) {
  target.hidden = false;
  const hints = err.hints && err.hints.length
    ? `<div class="small">Suggestions: ${err.hints.map((h) => `<span class="chip">${esc(h)}</span>`).join(' ')}</div>` : '';
  target.innerHTML = `<strong>${esc(err.code || 'Error')}</strong>: ${esc(err.message)}${hints}`;
}

const methodBadge = (m) => {
  const cls = m === 'BLOOM_NEGATIVE' ? 'm-neg' : m === 'BLOOM_POSITIVE_RULE_CLEARED' ? 'm-fp' : 'm-bad';
  return `<span class="method ${cls}">${esc(m)}</span>`;
};

// ---------- autocomplete (Trie) ----------
let acTimer;
let acItems = [];
let acActive = -1;
$('exercise').addEventListener('input', () => {
  clearTimeout(acTimer);
  const q = $('exercise').value;
  if (!q.trim()) { $('acList').hidden = true; $('acMeta').textContent = ''; return; }
  acTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/exercises/autocomplete?mode=name&limit=10&prefix=${encodeURIComponent(q)}`);
      acItems = r.exercises;
      acActive = -1;
      $('acMeta').textContent = `${r.method}: ${r.keysMatched} key(s), ${r.nodesVisited} of ${r.trieNodes.toLocaleString()} trie nodes visited, ${r.elapsedMicros} µs (server)`;
      renderAc();
    } catch (e) {
      $('acMeta').textContent = e.message;
      $('acList').hidden = true;
    }
  }, 120);
});

function renderAc() {
  const ul = $('acList');
  if (!acItems.length) { ul.innerHTML = '<li class="muted">No matching exercise</li>'; ul.hidden = false; return; }
  ul.innerHTML = acItems.map((x, i) =>
    `<li data-i="${i}" class="${i === acActive ? 'active' : ''}">${esc(x.name)}<small>${esc(x.id)} · matched "${esc(x.matchedKey)}"</small></li>`).join('');
  ul.hidden = false;
}

$('acList').addEventListener('mousedown', (e) => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  $('exercise').value = acItems[+li.dataset.i].name;
  $('acList').hidden = true;
});
$('exercise').addEventListener('keydown', (e) => {
  if ($('acList').hidden || !acItems.length) return;
  if (e.key === 'ArrowDown') { acActive = (acActive + 1) % acItems.length; renderAc(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { acActive = (acActive - 1 + acItems.length) % acItems.length; renderAc(); e.preventDefault(); }
  if (e.key === 'Enter' && acActive >= 0) { $('exercise').value = acItems[acActive].name; $('acList').hidden = true; e.preventDefault(); }
  if (e.key === 'Escape') $('acList').hidden = true;
});
$('exercise').addEventListener('blur', () => setTimeout(() => { $('acList').hidden = true; }, 150));

// ---------- injuries ----------
let injuries = [];
async function loadInjuries() {
  try {
    injuries = await api('/api/injuries');
    $('injury').innerHTML = '<option value="">Select…</option>' +
      injuries.map((i) => `<option value="${esc(i.tag)}">${esc(i.name)} (${esc(i.tag)})</option>`).join('');
  } catch (e) {
    $('injury').innerHTML = '<option value="">Unavailable</option>';
  }
}
$('injury').addEventListener('change', () => {
  const i = injuries.find((x) => x.tag === $('injury').value);
  $('injuryInfo').textContent = i ? `${i.guidance} (${i.contraindicatedExercises} catalog exercises contraindicated)` : '';
});

// ---------- substitution ----------
$('subForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error').hidden = true;
  $('go').disabled = true;
  const body = {
    exercise: $('exercise').value,
    injuryTag: $('injury').value,
    maxResults: Number($('maxResults').value),
    keyword: $('keyword').value || null,
    requireKeyword: $('requireKeyword').checked,
    sameEquipmentOnly: $('sameEquipmentOnly').checked,
  };
  try {
    const r = await api('/api/substitutions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    renderResult(r);
  } catch (err) {
    $('resultSection').hidden = true;
    showError($('error'), err);
  } finally {
    $('go').disabled = false;
  }
});

function renderResult(r) {
  $('resultSection').hidden = false;
  const ok = r.status === 'OK';
  $('statusBanner').innerHTML = `<div class="banner ${ok ? 'ok' : 'warn'}">${esc(r.status)} — ${esc(r.message)}</div>`;
  const t = r.target;
  $('targetInfo').innerHTML = `<p><strong>Target:</strong> ${esc(t.name)} <span class="muted">(${esc(t.id)}, resolved by ${esc(t.resolvedBy)})</span>
    · ${t.primaryMuscles.map((m) => `<span class="chip">${esc(m)}</span>`).join('')} · ${esc(t.movementPattern)}<br>
    ${t.unsafeForInjury
      ? `<span class="method m-bad">TARGET UNSAFE</span> ${t.unsafeReasons.map(esc).join('; ')}`
      : '<span class="method m-neg">TARGET NOT CONTRAINDICATED</span> by the rule set (substitutes shown anyway)'}
    <br><span class="muted">${esc(r.injury.name)}: ${esc(r.injury.guidance)}</span></p>`;

  const p = r.pipeline;
  $('pipeline').innerHTML = [
    ['Target lookup', p.targetLookup],
    ['Candidate generation', p.candidateGeneration],
    ['Safety check', p.safetyCheck],
    ['Keyword matching', p.keywordMatching + (p.kmpComparisons ? ` · ${p.kmpComparisons.toLocaleString()} char comparisons` : '')],
    ['Bloom results', `${p.bloomNegatives} definite negatives · ${p.bloomPositives} possible positives`],
    ['Exact rule confirmation', `${p.ruleEvaluations} rule checks run → ${p.confirmedUnsafe} confirmed unsafe, ${p.falsePositivesCleared} false positive(s) cleared`],
    ['Work avoided', `${p.ruleEvaluationsAvoided} rule checks skipped by Bloom negatives · ${p.filteredOut} removed by your filters`],
    ['Server time', `${p.elapsedMicros.toLocaleString()} µs`],
  ].map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('');

  const tbody = $('resultsTable').querySelector('tbody');
  tbody.innerHTML = r.results.length ? r.results.map((c) => `
    <tr>
      <td>${c.rank}</td>
      <td><strong>${esc(c.name)}</strong><br><span class="muted small">${esc(c.id)} · ${esc(c.movementPattern)} · ${c.equipment.map(esc).join(', ')}</span>
        ${c.keywordSnippet ? `<div class="snippet">${esc(c.keywordSnippet).replace(/\[(.*?)\]/, '<mark>$1</mark>')}</div>` : ''}</td>
      <td><strong>${c.score.toFixed(3)}</strong><div class="small muted">
        prim ${c.breakdown.primaryOverlap} · sec ${c.breakdown.secondaryOverlap}<br>
        pattern ${c.breakdown.movementPattern} · equip ${c.breakdown.equipment} · kw ${c.breakdown.keyword}</div></td>
      <td class="small">${c.acceptedBecause.map((b) => `• ${esc(b)}`).join('<br>')}</td>
      <td>${methodBadge(c.safetyMethod)}<div class="small muted">${esc(c.safetyExplanation)}</div></td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">No safe substitute to show — see the status message above and the rejected list below.</td></tr>';

  $('rejectedSummary').textContent = `Rejected candidates (${r.rejected.length})`;
  $('rejectedTable').querySelector('tbody').innerHTML = r.rejected.map((x) => `
    <tr><td>${esc(x.name)}<br><span class="muted small">${esc(x.id)}</span></td><td>${esc(x.stage)}</td>
    <td>${methodBadge(x.safetyMethod)}</td><td class="small">${x.reasons.map(esc).join('<br>')}</td></tr>`).join('');
}

// ---------- explore: tag trie + KMP text search ----------
let tagTimer;
$('tagPrefix').addEventListener('input', () => {
  clearTimeout(tagTimer);
  const q = $('tagPrefix').value;
  if (!q.trim()) return;
  tagTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/exercises/autocomplete?mode=tag&limit=15&prefix=${encodeURIComponent(q)}`);
      $('exploreOut').innerHTML = `<p class="muted small">${esc(r.method)} · ${r.nodesVisited} nodes visited · ${r.elapsedMicros} µs</p>` +
        (r.tags.length ? `<table><thead><tr><th>Tag</th><th>Exercises</th><th>Examples</th></tr></thead><tbody>${
          r.tags.map((t) => `<tr><td><span class="chip">${esc(t.tag)}</span></td><td>${t.exerciseCount}</td><td class="small">${t.sampleExercises.map(esc).join(', ')}</td></tr>`).join('')
        }</tbody></table>` : '<p class="muted">No tag starts with that prefix.</p>');
    } catch (e) { showError($('exploreOut'), e); }
  }, 150);
});
$('tagForm').addEventListener('submit', (e) => e.preventDefault());
$('textForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`/api/exercises/text-search?limit=25&q=${encodeURIComponent($('phrase').value)}`);
    $('exploreOut').innerHTML = `<p class="muted small">${esc(r.method)} · ${r.matches} of ${r.textsScanned} instruction texts match ·
      KMP ${r.kmpComparisons.toLocaleString()} vs naive ${r.naiveComparisons.toLocaleString()} char comparisons · ${r.elapsedMicros} µs</p>` +
      (r.results.length ? `<table><thead><tr><th>Exercise</th><th>Positions</th><th>Snippet</th></tr></thead><tbody>${
        r.results.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.positions.join(', ')}</td><td class="snippet">${esc(m.snippet).replace(/\[(.*?)\]/, '<mark>$1</mark>')}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted">No instruction text contains that phrase.</p>');
  } catch (err) { showError($('exploreOut'), err); }
});

// ---------- stats + health ----------
async function loadStats() {
  try {
    const h = await api('/api/health');
    $('health').textContent = `API ${h.status} at ${API} · ${h.exercises} exercises · ${h.injuryTags} injury tags`;
    const s = await api('/api/catalog/stats');
    const b = s.bloomFilter;
    $('stats').innerHTML = `
      <p>Active dataset: <strong>${esc(s.source || 'sample data')}</strong>.</p>
      <p>${s.exercises} exercises loaded (${s.loadReport.rowsRead} rows read, ${s.loadReport.duplicates.length} duplicate(s) and ${s.loadReport.invalid.length} invalid row(s) rejected).
      Name trie: ${s.nameTrie.keys.toLocaleString()} keys / ${s.nameTrie.nodes.toLocaleString()} nodes. Tag trie: ${s.tagTrie.keys} keys / ${s.tagTrie.nodes} nodes.</p>
      <p>Bloom filter over ${b.insertedPairs_n} contraindicated (exercise, injury) pairs: m = ${b.bits_m.toLocaleString()} bits (${b.memoryBytes} bytes), k = ${b.hashFunctions_k},
      fill ${(b.fillRatio * 100).toFixed(1)}%, target FPP ${b.targetFpp}, theoretical ${b.theoreticalFpp.toFixed(4)}, <strong>measured ${b.measuredFpp.toFixed(4)}</strong>.</p>
      ${s.loadReport.duplicates.length ? `<details><summary>Duplicate rows rejected at load</summary><ul>${s.loadReport.duplicates.map((d) => `<li class="small">${esc(d)}</li>`).join('')}</ul></details>` : ''}`;
  } catch (e) {
    $('health').textContent = e.message;
    $('stats').textContent = 'Stats unavailable.';
  }
}

// ---------- upload your own dataset (validated + indexed by the Java backend) ----------
$('uploadBtn').addEventListener('click', async () => {
  const out = $('uploadResult');
  const f = $('dataFile').files[0];
  if (!f) { out.innerHTML = '<span class="bad">Choose a .json file first.</span>'; return; }
  let rows;
  try { rows = JSON.parse(await f.text()); } catch (e) { out.innerHTML = `<span class="bad">That file is not valid JSON: ${esc(e.message)}</span>`; return; }
  out.textContent = 'Uploading and indexing…';
  try {
    const s = await api(`/api/catalog?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) });
    const r = s.loadReport;
    out.innerHTML = `<span class="ok">Now using <strong>${esc(f.name)}</strong>: ${s.exercises} exercises accepted out of ${r.rowsRead} rows; Bloom filter rebuilt (m = ${s.bloomFilter.bits_m}, k = ${s.bloomFilter.hashFunctions_k}).</span>
      ${r.duplicates.length || r.invalid.length ? `<ul>${[...r.duplicates, ...r.invalid].slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    loadStats();
  } catch (e) {
    out.innerHTML = `<span class="bad">${esc(e.message)}</span>${e.hints && e.hints.length ? `<ul>${e.hints.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }
});
$('resetBtn').addEventListener('click', async () => {
  try { await api('/api/catalog/reset', { method: 'POST' }); $('uploadResult').innerHTML = '<span class="ok">Sample data restored.</span>'; loadStats(); }
  catch (e) { $('uploadResult').innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
});

loadInjuries();
loadStats();
