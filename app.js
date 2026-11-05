/* ClearTalk local application layer.
 * This single-browser edition persists its demo data in localStorage.
 * Replace this storage adapter with an API before using real accounts or moderation data.
 */
(() => {
  'use strict';
  const KEY = 'cleartalk.v1';
  let recordsStorageKey = null;
  const defaults = {records: [], words};
  function addBuiltInWords(existing) {
    const merged = Array.isArray(existing) ? [...existing] : [];
    const seen = new Set(merged.filter(w => Array.isArray(w) && w[0]).map(w => String(w[0]).trim().toLocaleLowerCase('th')));
    for (const word of defaults.words) {
      const key = String(word[0]).trim().toLocaleLowerCase('th');
      if (!seen.has(key)) { merged.push(word); seen.add(key); }
    }
    return merged;
  }
  function restoreUserRecords(user) {
    recordsStorageKey = user?.user_id ? `${KEY}.user.${user.user_id}.records` : null;
    if (!recordsStorageKey) return [];
    try {
      const saved = JSON.parse(localStorage.getItem(recordsStorageKey) || '[]');
      return Array.isArray(saved) ? saved.filter(row => Array.isArray(row) && row.length >= 5) : [];
    } catch { return []; }
  }

  let data;
  window.clearTalkIsAdmin = false;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { data = null; }
  data = data && Array.isArray(data.records) && Array.isArray(data.words) ? data : defaults;
  records.splice(0, records.length, ...data.records);
  words.splice(0, words.length, ...addBuiltInWords(data.words));
  try { localStorage.setItem(KEY, JSON.stringify({records: [], words})); } catch {}
  function save() {
    const settings = (() => { try { return JSON.parse(localStorage.getItem('cleartalk.settings.v1') || '{}'); } catch { return {}; } })();
    const state = {records, words, settings};
    try {
      localStorage.setItem(KEY, JSON.stringify({records: window.clearTalkIsAdmin ? records : [], words}));
      if (recordsStorageKey) localStorage.setItem(recordsStorageKey, JSON.stringify(records));
    }
    catch { showToast('บันทึกข้อมูลไม่สำเร็จ พื้นที่จัดเก็บอาจเต็ม'); }
    clearTimeout(window._dbSaveTimer);
    window._dbSaveTimer = setTimeout(() => {
      if (!window.clearTalkDatabaseOnline) return;
      if (!window.clearTalkIsAdmin) return;
      fetch('/api/state', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(state)})
        .catch(() => { window.clearTalkDatabaseOnline = false; showToast('เชื่อมต่อฐานข้อมูลไม่ได้ บันทึกไว้ในเบราว์เซอร์แทน'); });
    }, 250);
  }
  window.clearTalkSave = save;
  window.logout = async function () {
    try { await fetch('/api/logout', {method:'POST'}); } catch {}
    location.href = '/login.html';
  };

  // Load the shared SQLite-backed state when the site is served by server.py.
  window.clearTalkDatabaseOnline = false;
  fetch('/api/state').then(response => {
    if (!response.ok) throw new Error('API unavailable');
    return response.json();
  }).then(state => {
    window.clearTalkDatabaseOnline = true;
    window.clearTalkIsAdmin = state.user?.role === 'admin';
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = window.clearTalkIsAdmin ? '' : 'none'; });
    if (!window.clearTalkIsAdmin && ['manage','settings'].includes(page)) {
      page = 'dashboard';
      history.replaceState(null, '', '/index.html');
    }
    if (state.user) {
      const displayName = state.user.display_name || state.user.email || '\u0e1c\u0e39\u0e49\u0e43\u0e0a\u0e49';
      const initial = [...displayName.trim()][0] || '\u0e1c';
      const name = document.getElementById('sideUserName');
      const topName = document.getElementById('topUserName');
      const greetingName = document.getElementById('greetingName');
      if (name) name.textContent = displayName;
      if (topName) topName.textContent = displayName;
      if (greetingName) greetingName.textContent = displayName;
      for (const id of ['sideUserAvatar', 'topUserAvatar']) {
        const avatar = document.getElementById(id);
        if (avatar) avatar.textContent = initial;
      }
      const role = document.querySelector('.profile small');
      if (role) role.textContent = window.clearTalkIsAdmin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้';
    }
    if (state.user?.role === 'admin') {
      records.splice(0, records.length, ...state.records);
    } else {
      records.splice(0, records.length, ...restoreUserRecords(state.user));
    }
    if (state.words.length) words.splice(0, words.length, ...addBuiltInWords(state.words));
    save();
    if (state.settings && Object.keys(state.settings).length) {
      localStorage.setItem('cleartalk.settings.v1', JSON.stringify(state.settings));
    }
    render();
  }).catch(() => { /* Direct file/Live Server mode continues with localStorage. */ });

  // Reuse the existing screen layouts while making their actions persistent.
  const baseAnalyze = analyze;
  analyze = function () { baseAnalyze(); save(); };
  const baseSetInputMode = setInputMode;
  setInputMode = function (button, mode) {
    baseSetInputMode(button, mode);
    const field = document.getElementById('message');
    if (field) field.placeholder = mode === 'url'
      ? 'วางลิงก์วิดีโอ YouTube ที่เปิดคอมเมนต์ไว้ เช่น https://youtu.be/VIDEO_ID'
      : 'พิมพ์หรือวางข้อความที่ต้องการตรวจสอบ...';
  };
  const baseAddWord = addWord;
  addWord = function () { baseAddWord(); save(); };
  const baseToggleWord = toggleWord;
  toggleWord = function (i) { baseToggleWord(i); save(); };

  // Reflect saved preferences when the checker page is opened.
  const baseCheckPage = checkPage;
  checkPage = function () {
    const preferences = JSON.parse(localStorage.getItem('cleartalk.settings.v1') || '{}');
    const keys = ['profanity', 'insult', 'violence', 'spam', 'tone'];
    const defaults = {profanity: true, insult: true, violence: true, spam: false, tone: false};
    let index = 0;
    let markup = baseCheckPage().replace(/<input type="checkbox"(?: checked)?>([^<]*)/g, (match, label) => {
      const key = keys[index];
      const enabled = preferences[key] === undefined ? defaults[key] : preferences[key] !== false;
      index++;
      return `<input type="checkbox" data-category="${key}"${enabled ? ' checked' : ''}>${label}`;
    });
    const sensitiveEnabled = preferences.sensitive === true;
    const sensitiveChip = `<label class="check-chip"><input type="checkbox" data-category="sensitive"${sensitiveEnabled ? ' checked' : ''}> เนื้อหาล่อแหลม</label>`;
    return markup.replace('</div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">', `${sensitiveChip}</div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px">`);
  };

  const baseSettingsPage = settingsPage;
  settingsPage = function () {
    const preferences = JSON.parse(localStorage.getItem('cleartalk.settings.v1') || '{}');
    const sensitiveControl = `<label style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid var(--line);border-radius:10px"><span><b style="font-size:11px">เนื้อหาล่อแหลม</b><small style="display:block;color:var(--muted);font-size:9px;margin-top:4px">ตรวจหาวลีชวนคิดทางเพศ ภาพโป๊ หรือการคุกคามทางเพศ</small></span><input type="checkbox" class="setting-check" data-setting="sensitive" ${preferences.sensitive === true ? 'checked' : ''} style="accent-color:var(--purple);width:16px;height:16px"></label>`;
    return baseSettingsPage().replace('</div><button class="button primary" onclick="saveSettings()">', `${sensitiveControl}</div><button class="button primary" onclick="saveSettings()">`);
  };

  // Use the administrator's editable word list in the text checker.
  const normalizeForMatch = value => String(value).normalize('NFC').toLocaleLowerCase('th')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  // These common words and pronouns need an insulting phrase around them;
  // matching them anywhere causes obvious false positives (e.g. "กูรู", "สัตว์ป่า").
  const contextOnlyWords = new Set([
    'กู','มึง','ไอ้','อี','กี','ตาย','บ้า','ควาย','หมา','สัตว์','ขี้','ห่า','เวร','สาด',
    'แดก','แรด','เจี๊ยว','เยี่ยว','ตีน','ฆ่า','ฆาตกรรม','ปืน','ปล้น','มัน','วะ','ว่ะ',
    'หวะ','ข้า','เอ็ง','น้ำเดิน','น้ำแตก','รูทวาร'
  ].map(normalizeForMatch));
  function findMatchedWords(text) {
    const normalizedText = normalizeForMatch(text);
    const selectedCategories = new Set([...document.querySelectorAll('.checks input[data-category]:checked')].map(input => input.dataset.category));
    const categorySetting = category => {
      const name = String(category || '');
      if (name.includes('เหยียด') || name.includes('ดูหมิ่น')) return 'insult';
      if (name.includes('ความรุนแรง') || name.includes('ข่มขู่')) return 'violence';
      if (name.includes('ล่อแหลม') || name.includes('ทางเพศ')) return 'sensitive';
      if (name.includes('สแปม')) return 'spam';
      return 'profanity';
    };
    return [...new Set(words.filter(w => w[3] === 'ใช้งาน' && w[0])
      .filter(item => {
        const normalizedWord = normalizeForMatch(item[0]);
        if (normalizedWord === 'อี') return false;
        return normalizedWord && selectedCategories.has(categorySetting(item?.[1]))
          && !contextOnlyWords.has(normalizedWord) && normalizedText.includes(normalizedWord);
      }).map(item => item[0]))];
  }

  analyze = function () {
    const field = document.getElementById('message');
    const urlMode = [...document.querySelectorAll('.tab')].some(button => button.classList.contains('active') && button.textContent.includes('URL'));
    if (field && urlMode) { analyzeYoutubeUrl(field.value.trim()); return; }
    if (!field || !field.value.trim()) { baseAnalyze(); return; }
    const text = field.value.trim();
    const found = findMatchedWords(text);
    const box = document.getElementById('result');
    const label = found.length ? 'พบคำไม่เหมาะสม' : 'เรียบร้อย';
    const tags = found.length ? found.map(w => `<span class="tag">${escapeHTML(w)}</span>`).join('') : '<span class="tag">ความเสี่ยงต่ำ</span>';
    box.innerHTML = `<div class="result-head"><strong>ผลการวิเคราะห์</strong>${status(label)}</div><div class="result-text">${found.length ? `พบคำที่อยู่ในรายการตรวจสอบ: ${found.map(w=>`<span class="highlight">${escapeHTML(w)}</span>`).join('、')}<br>โปรดพิจารณาบริบทและปรับแก้ข้อความตามความเหมาะสม` : 'ไม่พบคำในรายการตรวจสอบเบื้องต้น โปรดพิจารณาบริบทของข้อความประกอบด้วย'}</div><div class="result-tags">${tags}<span class="tag">ตรวจสอบด้วยรายการคำในระบบ</span></div>`;
    box.classList.add('show');
    records.unshift([`CT-${Date.now().toString().slice(-8)}`, 'เมื่อสักครู่', text, found.length ? 'คำที่ควรพิจารณา' : 'ทั่วไป', label]);
    save();
    showToast('ตรวจสอบข้อความเสร็จแล้ว');
  };

  async function analyzeYoutubeUrl(url) {
    const box = document.getElementById('result');
    if (!url) { showToast('กรุณาวางลิงก์วิดีโอ YouTube'); return; }
    box.innerHTML = '<div class="result-text">กำลังดึงคอมเมนต์จาก YouTube…</div>';
    box.classList.add('show');
    try {
      const response = await fetch('/api/youtube/comments', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ดึงคอมเมนต์ไม่สำเร็จ');
      const checked = data.comments.map(text => ({text, found: findMatchedWords(text)}));
      const flagged = checked.filter(item => item.found.length);
      const preview = flagged.slice(0, 50).map(item => `<li style="margin:9px 0"><div>${escapeHTML(item.text)}</div><small>พบ: ${item.found.map(escapeHTML).join(', ')}</small></li>`).join('');
      box.innerHTML = `<div class="result-head"><strong>ผลตรวจคอมเมนต์ YouTube</strong>${status(flagged.length ? 'พบคำไม่เหมาะสม' : 'เรียบร้อย')}</div><div class="result-text">ตรวจ ${checked.length} คอมเมนต์ พบ ${flagged.length} คอมเมนต์ที่มีคำตรงกับรายการตรวจสอบ${flagged.length > 50 ? ' (แสดง 50 รายการแรก)' : ''}.</div>${preview ? `<ol style="padding-left:20px;max-height:360px;overflow:auto">${preview}</ol>` : ''}`;
      records.unshift([`CT-${Date.now().toString().slice(-8)}`, 'เมื่อสักครู่', `${url} — ตรวจ ${checked.length} คอมเมนต์ พบ ${flagged.length} รายการ`, 'YouTube', flagged.length ? 'พบคำไม่เหมาะสม' : 'เรียบร้อย']);
      save();
      showToast('ตรวจคอมเมนต์ YouTube เสร็จแล้ว');
    } catch (error) {
      box.innerHTML = `<div class="result-head"><strong>ดึงคอมเมนต์ไม่สำเร็จ</strong></div><div class="result-text">${escapeHTML(error.message || 'เกิดข้อผิดพลาด')}</div>`;
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  // Escape user-entered text before placing it in HTML templates.
  window.showRecordDetail = function (index) {
    const record = records[index];
    if (!record) return;
    const overlay = document.createElement('div');
    overlay.className = 'record-detail-overlay';
    Object.assign(overlay.style, {position:'fixed', inset:'0', zIndex:'10000', display:'grid', placeItems:'center', padding:'20px', background:'rgba(20, 24, 40, .55)'});
    overlay.innerHTML = `<div class="record-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="recordDetailTitle"><div class="record-detail-head"><h2 id="recordDetailTitle">รายละเอียดการตรวจสอบ</h2><button type="button" class="record-detail-close" aria-label="ปิด">×</button></div><dl><dt>รหัสรายการ</dt><dd>${escapeHTML(record[0])}</dd><dt>วันที่ / เวลา</dt><dd>${escapeHTML(record[1])}</dd><dt>ข้อความ</dt><dd class="record-detail-message">${escapeHTML(record[2])}</dd><dt>หมวดหมู่</dt><dd>${escapeHTML(record[3])}</dd><dt>ผลการตรวจ</dt><dd>${status(escapeHTML(record[4]))}</dd></dl></div>`;
    const dialog = overlay.querySelector('.record-detail-dialog');
    Object.assign(dialog.style, {width:'min(560px, 100%)', maxHeight:'min(80vh, 680px)', overflowY:'auto', padding:'24px', borderRadius:'16px', background:'#fff', color:'#25283a', boxShadow:'0 20px 60px rgba(0,0,0,.25)', fontFamily:'inherit'});
    const heading = overlay.querySelector('.record-detail-head');
    Object.assign(heading.style, {display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px', marginBottom:'20px'});
    const title = overlay.querySelector('h2');
    Object.assign(title.style, {margin:'0', fontSize:'20px'});
    const closeButton = overlay.querySelector('.record-detail-close');
    Object.assign(closeButton.style, {border:'0', background:'transparent', fontSize:'28px', cursor:'pointer', color:'#74788a'});
    const details = overlay.querySelector('dl');
    Object.assign(details.style, {display:'grid', gridTemplateColumns:'110px minmax(0, 1fr)', gap:'12px 16px', margin:'0', fontSize:'14px'});
    overlay.querySelectorAll('dt').forEach(item => Object.assign(item.style, {color:'#777b8d', fontWeight:'600'}));
    overlay.querySelectorAll('dd').forEach(item => Object.assign(item.style, {margin:'0', overflowWrap:'anywhere'}));
    overlay.querySelector('.record-detail-message').style.whiteSpace = 'pre-wrap';
    const close = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.record-detail-close').addEventListener('click', close);
    const onEscape = event => { if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onEscape); } };
    document.addEventListener('keydown', onEscape);
    document.body.appendChild(overlay);
  };
  tableRows = function (rows) {
    return rows.map(r => {
      const index = records.indexOf(r);
      return `<tr><td style="color:#8b91a4">${escapeHTML(r[0])}</td><td>${escapeHTML(r[1])}</td><td class="text-cell" title="${escapeHTML(r[2])}">${escapeHTML(r[2])}</td><td>${escapeHTML(r[3])}</td><td>${status(escapeHTML(r[4]))}</td><td><button class="button secondary" style="padding:6px 9px;font-size:9px" onclick="showRecordDetail(${index})">ดู</button></td></tr>`;
    }).join('');
  };
  wordTableFiltered = function (list) {
    if (!list.length) return '<div class="empty">ไม่พบคำที่ค้นหา</div>';
    return `<table class="table"><thead><tr><th>คำ / วลี</th><th>หมวดหมู่</th><th>ระดับความรุนแรง</th><th>สถานะ</th><th>เพิ่มเมื่อ</th><th></th></tr></thead><tbody>${list.map(w => {
      const i = words.indexOf(w), severity = escapeHTML(w[2]), active = w[3] === 'ใช้งาน';
      const badge = severity === 'สูง' ? 'flag' : severity === 'ต่ำ' ? 'clean' : 'review';
      return `<tr><td><b>${escapeHTML(w[0])}</b></td><td>${escapeHTML(w[1])}</td><td><span class="status ${badge}">${severity}</span></td><td><span class="status ${active?'clean':'review'}">${active?'ใช้งาน':'ปิดใช้งาน'}</span></td><td>เพิ่มในเครื่องนี้</td><td><button class="button secondary" style="padding:6px 9px;font-size:9px" onclick="toggleWord(${i})">${active?'ปิดใช้':'เปิดใช้'}</button></td></tr>`;
    }).join('')}</tbody></table>`;
  };
  wordTable = function () { return wordTableFiltered(words); };
  // Save edits made from the existing history and management screens.
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && (button.textContent.includes('ล้างข้อความ') || button.textContent.includes('ส่งออก'))) save();
  });

  // Add a keyboard shortcut for the primary checker action.
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && page === 'check') analyze();
  });
  window.addEventListener('beforeunload', save);
})();
