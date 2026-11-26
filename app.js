const STORAGE_KEY = 'jungdami-demo-v1';
const sampleMeta = {
  countryside: { name: '고향의 풍경', image: 'assets/sample-photos/countryside.svg', description: '초록 들판과 오솔길' },
  seaside: { name: '바닷가 나들이', image: 'assets/sample-photos/seaside.svg', description: '파도가 머무는 해변' },
  garden: { name: '햇살 가득 정원', image: 'assets/sample-photos/garden.svg', description: '꽃이 핀 작은 뜰' }
};
const fallbackQuestions = [
  '이 사진을 보시니 어떤 기억이 떠오르시나요?',
  '그때의 풍경이나 소리 중에 기억나는 것이 있으신가요?',
  '그 순간의 기분을 한 단어로 표현한다면 어떤 느낌일까요?'
];
let db = readDb();
let selected = { type: 'sample', id: 'countryside', name: sampleMeta.countryside.name, image: sampleMeta.countryside.image };
let activePhotoUrl = null;
let draft = null;
let turn = 0;
let sending = false;
let toastTimer;

function readDb() {
  try { return Object.assign({ consent: false, records: [] }, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
  catch { return { consent: false, records: [] }; }
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); return true; }
  catch { showToast('저장 공간이 부족해요. 기존 기록을 삭제한 뒤 다시 시도해 주세요.'); return false; }
}
function $(selector, root = document) { return root.querySelector(selector); }
function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
function localDate(date = new Date()) { return new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' }).format(date); }
function shortDate(value) { return new Intl.DateTimeFormat('ko-KR', { month:'long', day:'numeric' }).format(new Date(value)); }
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
function setView(name) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'records') renderRecords();
  if (name === 'settings') renderConsent();
}
function renderConsent() {
  $('#consentStatus').innerHTML = db.consent
    ? '<span class="status-dot"></span><span>활동 저장에 동의했어요</span>'
    : '<span class="status-dot" style="background:#d8b27e"></span><span>아직 동의하지 않았어요</span>';
}
function renderHome() {
  const root = $('#recentRecords');
  const records = [...db.records].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,2);
  root.innerHTML = records.length ? records.map(record => `<article class="record-mini"><img src="${escapeHtml(record.photoImage || sampleMeta[record.photoId]?.image || sampleMeta.countryside.image)}" alt=""/><div><h3>${escapeHtml(record.photoName)}</h3><p>${escapeHtml(record.description)}</p></div><span class="record-date">${shortDate(record.createdAt)}</span></article>`).join('') : '<div class="empty-inline">아직 활동 기록이 없어요. 오늘 첫 이야기를 남겨 보세요.</div>';
}
function renderRecords() {
  const sorted = [...db.records].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  $('#recordsCount').textContent = `기록 ${sorted.length}개`;
  $('#allRecords').innerHTML = sorted.map(record => `<article class="record-card"><img src="${escapeHtml(record.photoImage || sampleMeta[record.photoId]?.image || sampleMeta.countryside.image)}" alt=""/><div><h3>${escapeHtml(record.photoName)}</h3><p>${escapeHtml(record.description)}</p><div class="record-keywords">${(record.keywords || []).map(word => `<span>${escapeHtml(word)}</span>`).join('')}</div></div><time>${shortDate(record.createdAt)}</time></article>`).join('');
  $('#emptyRecords').style.display = sorted.length ? 'none' : 'block';
  $('#allRecords').style.display = sorted.length ? 'grid' : 'none';
}
function selectSample(id) {
  if (!sampleMeta[id]) return;
  if (activePhotoUrl) { URL.revokeObjectURL(activePhotoUrl); activePhotoUrl = null; }
  selected = { type:'sample', id, name:sampleMeta[id].name, image:sampleMeta[id].image };
  $$('.sample-card').forEach(card => card.classList.toggle('selected', card.dataset.sample === id));
  $('#uploadFeedback').textContent = '';
  $('#photoUpload').value = '';
}
function consentAndStart() {
  if (!$('#consentCheckbox').checked) { showToast('활동 기록 저장에 동의해 주세요.'); $('#consentCheckbox').focus(); return; }
  db.consent = true;
  if (!persist()) return;
  draft = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, photoId: selected.id, photoName: selected.name, photoImage: selected.type === 'upload' ? activePhotoUrl : selected.image, messages: [], checkin: null, createdAt: new Date().toISOString() };
  turn = 0;
  $('#chatPhoto').src = selected.type === 'upload' ? activePhotoUrl : selected.image;
  $('#conversation').innerHTML = '';
  addMessage('assistant', fallbackQuestions[0]);
  setView('chat');
  $('#answerInput').value = '';
  setTimeout(() => $('#answerInput').focus(), 250);
}
function addMessage(role, content) {
  const box = document.createElement('div');
  box.className = `message ${role}`;
  const time = new Intl.DateTimeFormat('ko-KR', { hour:'2-digit', minute:'2-digit' }).format(new Date());
  box.innerHTML = `${escapeHtml(content)}<time>${time}</time>`;
  $('#conversation').append(box);
  $('#conversation').scrollTop = $('#conversation').scrollHeight;
  if (draft) draft.messages.push({ role, content });
}
function extractKeywords(text) {
  const candidates = ['가족','친구','고향','바다','바닷가','여행','학교','집','꽃','정원','음식','노래','아이','부모님','산책','시장','기차','봄','여름','웃음','사랑','바람','파도','햇살','들판','마을'];
  const found = candidates.filter(word => text.includes(word)).slice(0,5);
  return found.length ? found : ['소중한 기억','따뜻한 이야기'];
}
function answerTurn() {
  if (sending || !draft) return;
  const input = $('#answerInput');
  const answer = input.value.trim();
  if (!answer) { showToast('떠오르는 이야기를 한 줄 적어 주세요.'); input.focus(); return; }
  if (answer.length > 4000) { showToast('답변은 4,000자 이내로 적어 주세요.'); return; }
  sending = true; $('#sendAnswerBtn').disabled = true;
  addMessage('user', answer); input.value = '';
  turn += 1;
  $('#turnCounter').textContent = `${turn} / 3`;
  if (turn < 3) {
    $('#chatProgressText').textContent = turn === 1 ? '두 번째 이야기예요' : '마지막 이야기예요';
    window.setTimeout(() => {
      addMessage('assistant', fallbackQuestions[turn]);
      sending = false; $('#sendAnswerBtn').disabled = false; input.focus();
    }, 420);
  } else {
    $('#chatProgressText').textContent = '이야기를 잘 나눠 주셨어요';
    window.setTimeout(() => { sending = false; $('#sendAnswerBtn').disabled = false; showCheckin(); }, 420);
  }
}
function showCheckin() {
  setView('checkin');
  $$('.choice-row').forEach(row => {
    const defaultButton = row.querySelector('[data-value="not_recorded"]');
    $$('.choice-button', row).forEach(button => button.classList.toggle('selected', button === defaultButton));
  });
  $('#conditionNote').value = '';
}
function selectedValue(choice) { return $(`[data-choice="${choice}"] .choice-button.selected`)?.dataset.value || 'not_recorded'; }
function summarize(checkin) {
  const answers = draft.messages.filter(message => message.role === 'user').map(message => message.content);
  const allText = answers.join(' ');
  const keywords = extractKeywords(allText);
  const short = answers.map(text => text.length > 80 ? `${text.slice(0,80)}…` : text).join(' ');
  const summary = {
    id: draft.id, photoId: draft.photoId, photoName: draft.photoName,
    photoImage: draft.photoId === 'upload' ? null : draft.photoImage,
    description: `오늘 ${keywords.slice(0,2).join(' · ')}에 관한 이야기를 나누며 ${answers.length}번의 회상 활동에 참여했어요. ${short}`,
    keywords, messages: draft.messages, checkin, createdAt: draft.createdAt, source: 'fallback'
  };
  db.records.push(summary);
  if (!persist()) { db.records.pop(); return; }
  showSummary(summary);
}
function medicationLabel(value) { return ({taken:'챙겨 먹었어요',not_taken:'아직 못 먹었어요',not_recorded:'기록하지 않았어요'})[value] || '기록하지 않았어요'; }
function conditionLabel(value) { return ({good:'좋아요',okay:'보통이에요',unwell:'조금 불편해요',not_recorded:'기록하지 않았어요'})[value] || '기록하지 않았어요'; }
function saveCheckin() {
  if (!draft) return;
  summarize({ medication: selectedValue('medication'), condition: selectedValue('condition'), note: $('#conditionNote').value.trim() });
}
function showSummary(record) {
  $('#summaryDate').textContent = localDate(new Date(record.createdAt));
  $('#summaryPhoto').src = record.photoImage || sampleMeta[record.photoId]?.image || sampleMeta.countryside.image;
  $('#summaryPhotoName').textContent = record.photoName;
  $('#summaryDescription').textContent = record.description;
  $('#keywordList').innerHTML = record.keywords.map(word => `<span># ${escapeHtml(word)}</span>`).join('') + '<span># 회상 활동 3회</span>';
  $('#conversationReview').innerHTML = record.messages.map((message, index) => message.role === 'user' ? `<div class="review-item"><b>나의 이야기</b><span>${escapeHtml(message.content)}</span></div>` : '').join('');
  const checkin = record.checkin || {};
  $('#checkinSummaryContent').innerHTML = `<div class="checkin-line"><span>오늘 복약</span><b>${medicationLabel(checkin.medication)}</b></div><div class="checkin-line"><span>오늘 컨디션</span><b>${conditionLabel(checkin.condition)}</b></div>${checkin.note ? `<div class="checkin-line"><span>추가 메모</span><b>${escapeHtml(checkin.note)}</b></div>` : ''}`;
  renderHome();
  setView('summary');
}
function resetChat() { if (confirm('대화를 끝내고 사진 선택으로 돌아갈까요? 지금까지의 답변은 기록되지 않아요.')) { draft = null; setView('photo'); } }
function deleteAllRecords() {
  if (!db.records.length) { showToast('삭제할 기록이 없어요.'); return; }
  if (!confirm('저장된 활동 기록을 모두 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.')) return;
  db.records = []; persist(); renderRecords(); renderHome(); showToast('모든 활동 기록을 삭제했어요.');
}
function revokeConsent() {
  if (!confirm('동의를 철회하고 이 브라우저에 저장된 모든 활동 기록을 삭제할까요?')) return;
  db = { consent:false, records:[] }; persist(); renderConsent(); renderRecords(); renderHome(); showToast('동의를 철회하고 기록을 삭제했어요.');
}
function handleUpload(file) {
  if (!file) return;
  const feedback = $('#uploadFeedback');
  const allowed = ['image/jpeg','image/png','image/webp'];
  if (!allowed.includes(file.type)) { feedback.textContent = 'JPEG, PNG, WebP 사진만 선택할 수 있어요.'; feedback.style.color='#a75b4b'; $('#photoUpload').value=''; return; }
  if (file.size > 5 * 1024 * 1024) { feedback.textContent = '사진은 5MB 이하로 선택해 주세요.'; feedback.style.color='#a75b4b'; $('#photoUpload').value=''; return; }
  if (activePhotoUrl) URL.revokeObjectURL(activePhotoUrl);
  activePhotoUrl = URL.createObjectURL(file);
  selected = { type:'upload', id:'upload', name:file.name.replace(/\.[^.]+$/, '') || '내 사진', image:activePhotoUrl };
  $$('.sample-card').forEach(card => card.classList.remove('selected'));
  feedback.textContent = `선택한 사진: ${file.name} · 이 기기에서만 미리보기됩니다.`;
  feedback.style.color='#62826c';
}

$('#todayDate').textContent = localDate().replace(/\s/g,' ').replace(/요일/, '');
$$('[data-view]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); setView(button.dataset.view); }));
$('#beginBtn').addEventListener('click', () => { $('#consentCheckbox').checked = db.consent; selectSample('countryside'); setView('photo'); });
$$('.sample-card').forEach(card => card.addEventListener('click', () => selectSample(card.dataset.sample)));
$('#photoUpload').addEventListener('change', event => handleUpload(event.target.files[0]));
$('#startConversationBtn').addEventListener('click', consentAndStart);
$('#sendAnswerBtn').addEventListener('click', answerTurn);
$('#answerInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); answerTurn(); } });
$('#chatBackBtn').addEventListener('click', resetChat);
$$('.choice-row').forEach(row => row.addEventListener('click', event => { const button = event.target.closest('.choice-button'); if (!button) return; $$('.choice-button', row).forEach(item => item.classList.toggle('selected', item === button)); }));
$('#saveCheckinBtn').addEventListener('click', saveCheckin);
$('#skipCheckinBtn').addEventListener('click', () => { if (!draft) return; summarize({ medication:'not_recorded', condition:'not_recorded', note:'' }); });
$('#quickCheckin').addEventListener('click', () => { if (!db.records.length) { showToast('먼저 회상 활동을 마치면 안부를 기록할 수 있어요.'); return; } showToast('활동 기록에서 오늘의 안부를 확인할 수 있어요.'); setView('records'); });
$('#quickCheckin2').addEventListener('click', () => $('#quickCheckin').click());
$('#deleteAllBtn').addEventListener('click', deleteAllRecords);
$('#revokeConsentBtn').addEventListener('click', revokeConsent);
$('#helpBtn').addEventListener('click', () => $('#helpDialog').showModal());
$('#closeHelp').addEventListener('click', () => $('#helpDialog').close());
$('#gotItBtn').addEventListener('click', () => $('#helpDialog').close());
$('#helpDialog').addEventListener('click', event => { if (event.target === $('#helpDialog')) $('#helpDialog').close(); });
renderHome(); renderRecords(); renderConsent();
