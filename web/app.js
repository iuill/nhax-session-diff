const $ = id => document.getElementById(id);
const files = [];
let groups = [], report = null, rows = [], side = 'all', sequence = 0, busy = false, engineReady = false;
const pending = new Map();
const worker = new Worker('worker.js');

worker.onmessage = ({ data }) => {
  if (data.kind === 'ready') {
    engineReady = true;
    $('engine-status').textContent = 'ブラウザ内で解析 · 準備完了';
    $('file-input').disabled = false;
    return;
  }
  if (data.kind === 'startup-error') return fatal(data.error);
  const callback = pending.get(data.id);
  if (!callback) return;
  pending.delete(data.id);
  data.error ? callback.reject(new Error(data.error)) : callback.resolve(data.result);
};
worker.onerror = () => fatal('解析エンジンが停止しました。ページを再読み込みしてください。');

function fatal(message) {
  engineReady = false;
  $('engine-status').textContent = '解析エンジンの起動に失敗';
  $('file-input').disabled = true;
  showErrors([message]);
  for (const callback of pending.values()) callback.reject(new Error(message));
  pending.clear();
}

function request(data) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...data, id });
  });
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function showErrors(messages) {
  $('errors').textContent = messages.join('\n');
  $('errors').hidden = !messages.length;
}

const patientName = patient => {
  const names = [patient.attributes.FirstName, patient.attributes.LastName].filter(Boolean);
  return [...new Set(names)].join(' ') || `ユーザー ${patient.index + 1}`;
};
const sideLabel = value => ({ Left: '左', Right: '右' }[value] || value || '共通');
const kindLabel = value => ({ FittingData: 'フィッティング', SelectionData: '選択情報', ClientProfile: 'プロファイル', InstrumentLoggingData: '使用ログ' }[value] || value);
const kindDescription = value => ({
  FittingData: '調整した設定などのデータ。通常の設定比較はこちら。',
  ClientProfile: '聴力測定・フィッティング方針などのプロフィール情報。',
  InstrumentLoggingData: '機器から取得された使用ログのデータ。',
  SelectionData: '機器や音響構成などの選択情報。画面の選択状態ではありません。',
}[value] || 'このXMLデータ種別の履歴を比較します。');

function setBusy(value) {
  busy = value;
  $('file-input').disabled = value || !engineReady;
  for (const id of ['data-kind', 'before-file', 'before-patient', 'before', 'after-file', 'after-patient', 'after', 'swap', 'compare']) $(id).disabled = value || !groups.length || !engineReady;
  $('clear').disabled = value || !files.length;
}

function invalidateResult() {
  report = null; rows = [];
  $('results').hidden = true;
  $('initial-result').hidden = false;
}

function buildGroups() {
  groups = [];
  for (const file of files) {
    for (const patient of file.parsed.patients) {
      for (const [sessionIndex, session] of patient.sessions.entries()) {
        const grouped = new Map();
        for (const action of session.actions) {
          if (!action.private_xml_root || action.decode_error || action.attributes.Removed === '1' || action.attributes.Hidden === '1') continue;
          const time = action.attributes.ActionGroup || action.attributes.CreateDate || session.attributes.CreateDate || '';
          const key = `${time}\0${action.private_xml_root}`;
          if (!grouped.has(key)) grouped.set(key, { file, patient, sessionIndex, time, root: action.private_xml_root, actions: [] });
          grouped.get(key).actions.push(action);
        }
        for (const group of grouped.values()) {
          group.id = `${file.sha256}:${patient.index}:${sessionIndex}:${group.time}:${group.root}`;
          group.label = `${patientName(patient)} · ${group.time.replace('T', ' ')}`;
          groups.push(group);
        }
      }
    }
  }
  groups.sort((a, b) => a.root === 'FittingData' && b.root !== 'FittingData' ? -1 : b.root === 'FittingData' && a.root !== 'FittingData' ? 1 : a.time.localeCompare(b.time) || a.label.localeCompare(b.label));
  const oldKind = $('data-kind').value;
  const kinds = [...new Set(groups.map(g => g.root))];
  $('data-kind').replaceChildren();
  for (const kind of kinds) {
    const option = node('option', `${kindLabel(kind)} (${groups.filter(g => g.root === kind).length}件)`);
    option.value = kind; $('data-kind').append(option);
  }
  if (!kinds.length) {
    const option = node('option', 'フィッティング'); option.value = 'FittingData'; $('data-kind').append(option);
  }
  $('data-kind').value = kinds.includes(oldKind) ? oldKind : kinds.includes('FittingData') ? 'FittingData' : kinds[0] || 'FittingData';
  renderSelectors();
  setBusy(false);
}

function replaceOptions(id, options, chosen) {
  $(id).replaceChildren();
  for (const [value, label] of options) {
    const option = node('option', label); option.value = String(value); $(id).append(option);
  }
  if (!options.length) $(id).append(node('option', files.length ? '比較可能なデータがありません' : 'NHAXを読み込んでください'));
  if (chosen !== undefined) $(id).value = String(chosen);
}

function renderSide(id, hint = {}) {
  const visible = groups.filter(g => g.root === $('data-kind').value);
  const edge = list => id === 'before' ? list[0] : list.at(-1);
  const requested = visible.find(g => g.id === hint.groupId);
  const availableFiles = files.filter(file => visible.some(g => g.file === file));
  const file = requested?.file || availableFiles.find(f => f.sha256 === hint.fileId) || edge(visible)?.file;
  replaceOptions(id + '-file', availableFiles.map(f => [f.sha256, f.name]), file?.sha256);
  $(id + '-file-field').hidden = files.length === 1;
  const inFile = visible.filter(g => g.file === file);
  const patients = [...new Map(inFile.map(g => [g.patient.index, g.patient])).values()];
  const patient = requested?.patient || patients.find(p => String(p.index) === String(hint.patientIndex)) || edge(inFile)?.patient;
  replaceOptions(id + '-patient', patients.map(p => {
    const duplicateName = patients.filter(other => patientName(other) === patientName(p)).length > 1;
    return [p.index, `${patientName(p)}${duplicateName ? `（ユーザー ${p.index + 1}）` : ''} · ${inFile.filter(g => g.patient === p).length}件`];
  }), patient?.index);
  const histories = inFile.filter(g => g.patient === patient);
  const chosen = requested || edge(histories);
  replaceOptions(id, [...histories].reverse().map(g => {
    const duplicateTime = histories.filter(other => other.time === g.time).length > 1;
    return [g.id, `${g.time.replace('T', ' ') || '日時不明'}${duplicateTime ? ` · セッション ${g.sessionIndex + 1}` : ''}`];
  }), chosen?.id);
}

function renderSelectors() {
  for (const id of ['before', 'after']) renderSide(id, {
    groupId: $(id).value, fileId: $(id + '-file').value, patientIndex: $(id + '-patient').value,
  });
  $('kind-description').textContent = kindDescription($('data-kind').value);
  updateDetails();
}

function selected(id) { return groups.find(g => g.id === $(id).value); }
function updateDetails() {
  for (const id of ['before', 'after']) {
    const group = selected(id);
    $(id + '-detail').textContent = group ? `${group.actions.length}アクション · ${[...new Set(group.actions.map(a => sideLabel(a.side)))].join(' / ')}` : '';
  }
  const before = selected('before'), after = selected('after');
  $('selection-status').textContent = before && after
    ? before.id === after.id ? '同じ履歴を選択しています。' : `${patientName(before.patient)} → ${patientName(after.patient)}`
    : 'ファイルを読み込んで、比較する履歴を選択してください。';
}

async function importFiles(incoming) {
  if (busy || $('file-input').disabled) return;
  setBusy(true); invalidateResult(); showErrors([]);
  const errors = [];
  let duplicates = 0;
  for (const file of incoming) {
    try {
      $('import-status').textContent = `${file.name} を解析中…`;
      if (!file.name.toLowerCase().endsWith('.nhax')) throw new Error('NHAXファイルを選択してください。');
      if (file.size > 32 * 1024 * 1024) throw new Error('ファイルサイズが32 MiBを超えています。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (files.some(f => f.sha256 === sha256)) { duplicates++; continue; }
      const parsed = await request({ kind: 'parse', bytes });
      files.push({ name: file.name, size: file.size, sha256, bytes, parsed });
      const unparsed = parsed.patients.flatMap(p => p.sessions.flatMap(s => s.actions)).filter(a => a.decode_error);
      if (unparsed.length) errors.push(`${file.name}: ${unparsed.length}件のアクションは未解読のため比較できません。`);
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  $('file-input').value = '';
  renderFiles(); buildGroups(); showErrors(errors);
  $('import-status').textContent = `${files.length}ファイル · ${files.reduce((n, f) => n + f.parsed.patients.length, 0)}ユーザー · ${groups.length}件の比較可能な履歴${duplicates ? ` · 同一ファイル${duplicates}件をスキップ` : ''}`;
}

function renderFiles() {
  $('file-list').replaceChildren();
  for (const file of files) {
    const chip = node('div', undefined, 'file-chip');
    chip.append(node('strong', file.name), node('span', `${(file.size / 1024).toFixed(1)} KiB · ${file.parsed.patients.length}ユーザー`));
    $('file-list').append(chip);
  }
}

const metadata = path => /(?:FittingId|SessionId|UniqueId|CreateDate|Timestamp)(?:\b|["\\/])/.test(path);
function prettyPath(path) {
  const keys = [...path.matchAll(/\[("(?:\\.|[^"\\])*")\]/g)].map(match => {
    const key = JSON.parse(match[1]);
    return key.includes('SystemPart=') ? key.split('\\').filter(Boolean).filter(part => /^(Unit|Name)=/.test(part)).map(part => part.split('=').slice(1).join('=')).join(' / ') : key;
  }).filter(key => !['value', 'scope', 'EndUserSettings'].includes(key));
  const unique = keys.filter((key, i) => i === 0 || key !== keys[i - 1]);
  return unique.length ? unique.join(' › ') : path.replace(/\/#text$/, '').split('/').slice(-2).join(' / ');
}

async function compare() {
  const before = selected('before'), after = selected('after');
  if (!before || !after || busy) return;
  if (before.root !== after.root) return showErrors(['同じデータ種別の履歴を選択してください。']);
  setBusy(true); showErrors([]); invalidateResult();
  $('compare').textContent = '比較中…';
  const comparisons = [], skipped = [], used = new Set();
  try {
    for (const left of before.actions) {
      const matches = after.actions.filter(right => right.private_xml_root === left.private_xml_root && (right.side || '') === (left.side || ''));
      const leftMatches = before.actions.filter(action => (action.side || '') === (left.side || ''));
      if (matches.length !== 1 || leftMatches.length !== 1) { skipped.push(`${sideLabel(left.side)}: 対応するアクションを一意に選べません。`); continue; }
      const right = matches[0]; used.add(right.selector);
      const differences = await request({ kind: 'compare', beforeBytes: before.file.bytes, beforeSelector: left.selector, afterBytes: after.file.bytes, afterSelector: right.selector });
      comparisons.push({ side: left.side || '', before: left.selector, after: right.selector, differences });
    }
    for (const right of after.actions) if (!used.has(right.selector)) skipped.push(`${sideLabel(right.side)}: 比較先のアクションは未比較です。`);
    if (!comparisons.length) throw new Error('対応するアクションがなく比較できません。');
    report = {
      comparison: 'raw XML fields; UI meanings and units unverified',
      before: { file: before.file.name, sha256: before.file.sha256, patient_index: before.patient.index, session_index: before.sessionIndex, action_group: before.time },
      after: { file: after.file.name, sha256: after.file.sha256, patient_index: after.patient.index, session_index: after.sessionIndex, action_group: after.time },
      comparisons, unpaired: skipped
    };
    rows = comparisons.flatMap(c => c.differences.map(d => ({ ...d, side: c.side, metadata: metadata(d.path) })));
    $('result-context').textContent = `${before.label} → ${after.label}`;
    $('coverage').textContent = `${comparisons.length}組のアクションを比較。${skipped.length ? ' 未比較: ' + [...new Set(skipped)].join(' ') : ' 選択した履歴の全アクションを比較しました。'}`;
    $('stats').replaceChildren();
    const ordinary = rows.filter(r => !r.metadata).length;
    for (const [count, label, highlight] of [[ordinary, '項目の差分', true], [rows.length - ordinary, '識別子・日時の差分', false], [comparisons.length, '比較したアクション', false]]) {
      const stat = node('div', undefined, 'stat' + (highlight ? ' highlight' : '')); stat.append(node('strong', String(count)), node('span', label)); $('stats').append(stat);
    }
    $('results').hidden = false; $('initial-result').hidden = true;
    renderRows();
  } catch (error) { showErrors([error.message]); }
  finally { $('compare').replaceChildren(document.createTextNode('差分を比較 →')); setBusy(false); }
}

function renderRows() {
  const query = $('search').value.trim().toLowerCase();
  const visible = rows.filter(row => ($('metadata').checked || !row.metadata) && (side === 'all' || row.side === side) && (!query || `${row.path} ${row.before ?? ''} ${row.after ?? ''}`.toLowerCase().includes(query)));
  $('diff-body').replaceChildren();
  for (const row of visible) {
    const tr = node('tr');
    const sideCell = node('td'); sideCell.append(node('span', sideLabel(row.side), 'side-badge' + (row.side === 'Right' ? ' right' : '')));
    const field = node('td'); field.append(node('div', prettyPath(row.path), 'field-title'));
    const path = node('details', undefined, 'field-path'); path.append(node('summary', 'XMLパスを表示'), node('div', row.path)); field.append(path);
    tr.append(sideCell, field, node('td', row.before ?? '—', 'value old-value'), node('td', row.after ?? '—', 'value new-value'), node('td', { added: '追加', removed: '削除', changed: '変更' }[row.change], 'change-label'));
    $('diff-body').append(tr);
  }
  $('visible-count').textContent = `${visible.length}件を表示 / 全${rows.length}件の差分`;
  $('empty-result').hidden = !!visible.length;
  $('empty-result').textContent = rows.length ? '現在の絞り込み条件に一致する差分はありません。' : '選択したXMLデータに差分はありません。';
}

$('file-input').addEventListener('change', event => importFiles(event.target.files));
$('data-kind').addEventListener('change', () => { renderSelectors(); invalidateResult(); showErrors([]); });
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => importFiles(event.dataTransfer.files));
$('clear').addEventListener('click', () => { files.length = 0; renderFiles(); buildGroups(); invalidateResult(); showErrors([]); $('import-status').textContent = '読み込みをクリアしました。'; });
for (const id of ['before', 'after']) $(id).addEventListener('change', () => { updateDetails(); invalidateResult(); });
for (const id of ['before', 'after']) {
  $(id + '-file').addEventListener('change', () => { renderSide(id, { fileId: $(id + '-file').value }); updateDetails(); invalidateResult(); });
  $(id + '-patient').addEventListener('change', () => { renderSide(id, { fileId: $(id + '-file').value, patientIndex: $(id + '-patient').value }); updateDetails(); invalidateResult(); });
}
$('swap').addEventListener('click', () => {
  const before = $('before').value, after = $('after').value;
  renderSide('before', { groupId: after }); renderSide('after', { groupId: before });
  updateDetails(); invalidateResult();
});
$('compare').addEventListener('click', compare);
$('search').addEventListener('input', renderRows);
$('metadata').addEventListener('change', renderRows);
for (const button of document.querySelectorAll('[data-side]')) button.addEventListener('click', () => { side = button.dataset.side; for (const other of document.querySelectorAll('[data-side]')) other.setAttribute('aria-pressed', String(other === button)); renderRows(); });
$('download').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'nhax-comparison.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
