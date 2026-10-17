import { desktop } from './engine.js';

export function setupJournal(snapshotRefs) {
  if (!desktop) return;
  const panel = document.createElement('section');
  panel.className = 'panel journal-panel';
  panel.setAttribute('aria-labelledby', 'journal-title');
  panel.innerHTML = `
    <div class="section-heading"><h2 id="journal-title">記録</h2><button id="journal-folder" class="secondary-button">保存先フォルダーを選択</button></div>
    <p id="journal-location" class="coverage"></p>
    <p>設定時の意図や、使ってからの気づきを残せます。記録は選択したフォルダーの journal/ に保存します。</p>
    <form id="journal-form">
      <label for="journal-kind">記録の種類</label>
      <select id="journal-kind"><option value="observation">使ってからの気づき</option><option value="intent">設定・変更の意図</option></select>
      <label for="journal-text">内容</label>
      <textarea id="journal-text" rows="4" required maxlength="30000" placeholder="例：静かな部屋では快適。駅のアナウンスが少し聞き取りづらかった。"></textarea>
      <label><input type="checkbox" id="journal-attach" checked> 選択中の比較元・比較先を添付</label>
      <p id="journal-context" class="coverage"></p>
      <button id="journal-save" class="primary-button" type="submit" disabled>記録を保存</button>
    </form>
    <p id="journal-status" role="status"></p>
    <div id="journal-list"></div>`;
  document.querySelector('footer').before(panel);
  const shortcut = document.createElement('button');
  shortcut.className = 'secondary-button'; shortcut.textContent = '記録する';
  shortcut.addEventListener('click', () => { panel.scrollIntoView({ behavior: 'smooth' }); document.getElementById('journal-text').focus({ preventScroll: true }); });
  document.querySelector('.topbar').append(shortcut);
  const $ = id => document.getElementById(id);
  let folder = '', saving = false;
  const label = kind => kind === 'intent' ? '設定・変更の意図' : '使ってからの気づき';
  function status(error) { $('journal-status').textContent = String(error); }
  function render(journal) {
    folder = journal.folder;
    $('journal-location').textContent = folder || '履歴リポジトリなど、非公開で管理するフォルダーを選んでください。';
    $('journal-save').disabled = !folder || saving;
    $('journal-list').replaceChildren();
    for (const entry of journal.entries) {
      const item = document.createElement('article'); item.className = 'journal-entry';
      const heading = document.createElement('h3'); heading.textContent = `${label(entry.kind)} · ${new Date(entry.created_at).toLocaleString()}`;
      const text = document.createElement('p'); text.className = 'journal-text'; text.textContent = entry.text;
      item.append(heading, text);
      for (const ref of entry.snapshots || []) {
        const context = document.createElement('p'); context.className = 'coverage';
        context.textContent = `${ref.patient} · ${ref.time} · ${ref.file}`;
        item.append(context);
      }
      $('journal-list').append(item);
    }
  }
  function updateContext() {
    const refs = snapshotRefs();
    $('journal-context').textContent = refs.length ? refs.map(ref => `${ref.patient} · ${ref.time}`).join(' → ') : '履歴が未選択のため、添付なしで記録します。';
  }
  document.addEventListener('change', updateContext);
  document.addEventListener('nhax-selection-change', updateContext);
  document.addEventListener('click', () => queueMicrotask(updateContext));
  updateContext();
  $('journal-folder').addEventListener('click', async () => {
    try { render(await desktop.ChooseHistoryFolder()); status(''); }
    catch (error) { status(error); }
  });
  $('journal-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !folder) return;
    saving = true; $('journal-save').disabled = true; $('journal-folder').disabled = true;
    try {
      await desktop.SaveEntry({ kind: $('journal-kind').value, text: $('journal-text').value,
        snapshots: $('journal-attach').checked ? snapshotRefs() : [] });
      // Clear only after the file is saved. A refresh failure must not cause duplicate submissions.
      $('journal-text').value = ''; status('保存しました。Gitへのコミットは別途行ってください。');
      render(await desktop.GetJournal());
    } catch (error) { status(error); }
    finally { saving = false; $('journal-save').disabled = !folder; $('journal-folder').disabled = false; }
  });
  desktop.GetJournal().then(render).catch(status);
}
