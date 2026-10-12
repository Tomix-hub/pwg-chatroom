const $ = (id) => document.getElementById(id);
const home = $('home'), chat = $('chat'), chatWorkspace = $('chatWorkspace'), nameInput = $('name'), roomNameInput = $('roomNameInput'), codeInput = $('code'), error = $('error');let socket, myName = '', roomCode = '', myProfile = null, typingActive = false, typingTimer;
const ownReceipts = new Map();
const readObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
    const message = entry.target._chatMessage;
    if (message && message.name !== myName && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'read', messageId: message.id }));
    readObserver.unobserve(entry.target);
  }
}, { root: $('messages'), threshold: 0.65 }) : null;
let identity = localStorage.getItem('pwgChatIdentity');
if (!identity) { identity = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); localStorage.setItem('pwgChatIdentity', identity); }
const savedRoomSession = (() => { try { return JSON.parse(localStorage.getItem('pwgChatSession') || 'null'); } catch { return null; } })();
const inviteCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const hasInviteCode = /^[A-Z0-9]{6}$/.test(inviteCode);
nameInput.readOnly = true; nameInput.placeholder = 'Wird mit deinem Profil gespeichert';
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-PWG-Identity': identity, ...(options.headers || {}) } });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Die Anfrage ist fehlgeschlagen.'); return result;
}
function fillProfile(profile) {
  myProfile = profile; myName = profile.name; nameInput.value = myName; localStorage.setItem('pwgChatName', myName);
  $('profileName').textContent = profile.name; $('profileAvatar').textContent = profile.name.trim().charAt(0).toLocaleUpperCase();
  $('renameName').value = profile.name;
}
async function loadProfile() {
  try { const data = await api('/api/profile'); fillProfile(data.profile); }
  catch (profileError) {
    const savedName = localStorage.getItem('pwgChatName') || '';
    if (profileError.message.startsWith('Profil nicht gefunden') && savedName) {
      try {
        const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ identity, name: savedName }) });
        fillProfile(data.profile);
        if (hasInviteCode) { codeInput.value = inviteCode; connect('join'); }
        else if (savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); }
        return;
      } catch (recoveryError) {
        $('setupName').value = savedName;
        $('setupError').textContent = recoveryError.message;
        $('setupOverlay').classList.remove('hidden');
        $('setupName').focus();
        return;
      }
    }
    $('setupOverlay').classList.remove('hidden');
    $('setupName').value = savedName;
    if (savedName) $('setupError').textContent = profileError.message;
    $('setupName').focus();
  }
}
$('setupForm').addEventListener('submit', async event => {
  event.preventDefault(); const input = $('setupName'), output = $('setupError'); output.textContent = '';
  try { const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ identity, name: input.value.trim() }) }); fillProfile(data.profile); $('setupOverlay').classList.add('hidden');
    if (hasInviteCode) { codeInput.value = inviteCode; connect('join'); }
    else if (savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); }
  } catch (err) { output.textContent = err.message; input.focus(); }
});
$('profileButton').addEventListener('click', () => $('profileOverlay').classList.remove('hidden'));
$('closeProfile').addEventListener('click', () => $('profileOverlay').classList.add('hidden'));
$('profileOverlay').addEventListener('click', event => { if (event.target === $('profileOverlay')) $('profileOverlay').classList.add('hidden'); });
$('renameForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('renameName'), status = $('renameStatus'), newName = input.value.trim();
  status.textContent = '';
  try {
    const data = await api('/api/profile/name', { method: 'POST', body: JSON.stringify({ name: newName }) });
    fillProfile(data.profile);
    status.textContent = 'Dein Name wurde gespeichert.';
  } catch (err) {
    status.textContent = err.message;
    input.focus();
  }
});
$('designButton').addEventListener('click', () => $('designOverlay').classList.remove('hidden'));
$('closeDesign').addEventListener('click', () => $('designOverlay').classList.add('hidden'));
$('designOverlay').addEventListener('click', event => { if (event.target === $('designOverlay')) $('designOverlay').classList.add('hidden'); });
const timetableStorageKey = 'pwgPersonalTimetableUrl:' + identity;
let timetableObjectUrl = null;
function openTimetableDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pwg-chatroom-private', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('timetables', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Der Gerätespeicher ist nicht verfügbar.'));
  });
}
async function saveTimetableFile(file) {
  const db = await openTimetableDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('timetables', 'readwrite').objectStore('timetables').put({ key: identity, name: file.name, type: file.type, blob: file });
    request.onsuccess = () => { db.close(); resolve(); };
    request.onerror = () => { db.close(); reject(request.error || new Error('Die Datei konnte nicht gespeichert werden.')); };
  });
}
async function getTimetableFile() {
  const db = await openTimetableDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('timetables', 'readonly').objectStore('timetables').get(identity);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error('Die gespeicherte Datei konnte nicht geladen werden.')); };
  });
}
async function deleteTimetableFile() {
  const db = await openTimetableDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('timetables', 'readwrite').objectStore('timetables').delete(identity);
    request.onsuccess = () => { db.close(); resolve(); };
    request.onerror = () => { db.close(); reject(request.error || new Error('Die Datei konnte nicht entfernt werden.')); };
  });
}
function showTimetable(url, type = 'application/pdf') {
  if (timetableObjectUrl && timetableObjectUrl !== url) URL.revokeObjectURL(timetableObjectUrl);
  timetableObjectUrl = url.startsWith('blob:') ? url : null;
  $('timetableImage').hidden = true;
  $('timetableFrame').hidden = true;
  if (type.startsWith('image/')) {
    $('timetableImage').src = url;
    $('timetableImage').hidden = false;
  } else {
    $('timetableFrame').src = url;
    $('timetableFrame').hidden = false;
  }
  $('timetableOpen').href = url;
  $('timetableEmpty').classList.add('hidden');
  $('timetableView').classList.remove('hidden');
  renderRoomTimetable();
}
let roomTimetableObjectUrl = null;
async function renderRoomTimetable() {
  if (roomTimetableObjectUrl) { URL.revokeObjectURL(roomTimetableObjectUrl); roomTimetableObjectUrl = null; }
  $('roomTimetableImage').hidden = true;
  $('roomTimetableFrame').hidden = true;
  $('roomTimetableContent').classList.add('hidden');
  $('roomTimetableEmpty').classList.remove('hidden');
  try {
    const file = await getTimetableFile();
    if (file) {
      roomTimetableObjectUrl = URL.createObjectURL(file.blob);
      if (file.type.startsWith('image/')) { $('roomTimetableImage').src = roomTimetableObjectUrl; $('roomTimetableImage').hidden = false; }
      else { $('roomTimetableFrame').src = roomTimetableObjectUrl; $('roomTimetableFrame').hidden = false; }
      $('roomTimetableEmpty').classList.add('hidden');
      $('roomTimetableContent').classList.remove('hidden');
      return;
    }
    const savedUrl = localStorage.getItem(timetableStorageKey);
    if (savedUrl) {
      $('roomTimetableFrame').src = savedUrl;
      $('roomTimetableFrame').hidden = false;
      $('roomTimetableEmpty').classList.add('hidden');
      $('roomTimetableContent').classList.remove('hidden');
    }
  } catch {}
}
async function loadSavedTimetable() {
  $('timetableEmpty').classList.remove('hidden');
  $('timetableView').classList.add('hidden');
  try {
    const file = await getTimetableFile();
    if (file) {
      timetableObjectUrl = URL.createObjectURL(file.blob);
      showTimetable(timetableObjectUrl, file.type);
      $('timetableUploadStatus').textContent = 'Gespeichert: ' + file.name;
      return;
    }
    const savedUrl = localStorage.getItem(timetableStorageKey);
    if (savedUrl) { $('timetableUrl').value = savedUrl; showTimetable(savedUrl); }
  } catch (err) { $('timetableUploadStatus').textContent = err.message; }
}
$('timetableButton').addEventListener('click', () => {
  $('timetableOverlay').classList.remove('hidden');
  loadSavedTimetable();
});
$('editRoomTimetable').addEventListener('click', () => $('timetableButton').click());
$('addRoomTimetable').addEventListener('click', () => $('timetableButton').click());
$('closeTimetable').addEventListener('click', () => $('timetableOverlay').classList.add('hidden'));
$('timetableOverlay').addEventListener('click', event => { if (event.target === $('timetableOverlay')) $('timetableOverlay').classList.add('hidden'); });
$('timetableUploadForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('timetableFile'), file = input.files[0], status = $('timetableUploadStatus');
  status.textContent = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) { status.textContent = 'Bitte wähle ein Bild (PNG, JPG, WebP) oder eine PDF-Datei aus.'; return; }
  if (file.size > 20 * 1024 * 1024) { status.textContent = 'Die Datei ist größer als 20 MB. Bitte wähle eine kleinere Datei.'; return; }
  try {
    await saveTimetableFile(file);
    localStorage.removeItem(timetableStorageKey);
    timetableObjectUrl = URL.createObjectURL(file);
    $('timetableUrl').value = '';
    showTimetable(timetableObjectUrl, file.type);
    status.textContent = 'Gespeichert auf diesem Gerät: ' + file.name;
  } catch (err) { status.textContent = err.message || 'Die Datei konnte nicht gespeichert werden.'; }
});
$('timetableForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('timetableUrl'), status = $('timetableStatus');
  status.textContent = '';
  try {
    const url = new URL(input.value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'pwg.webuntis.com' || !/^\/WebUntis\/?$/i.test(url.pathname) || !url.hash.startsWith('#/basic/timetablePublic/')) throw new Error('Bitte füge den öffentlichen Stundenplan-Link deiner PWG-WebUntis-Seite ein.');
    const savedUrl = url.toString();
    await deleteTimetableFile().catch(() => {});
    localStorage.setItem(timetableStorageKey, savedUrl);
    showTimetable(savedUrl);
    status.textContent = 'Gespeichert – nur auf diesem Gerät.';
  } catch (err) { status.textContent = err instanceof TypeError ? 'Bitte gib einen gültigen Link ein.' : err.message; }
});
$('removeTimetable').addEventListener('click', () => {
  Promise.all([deleteTimetableFile().catch(() => {}), Promise.resolve(localStorage.removeItem(timetableStorageKey))]).then(() => {
    if (timetableObjectUrl) { URL.revokeObjectURL(timetableObjectUrl); timetableObjectUrl = null; }
    $('timetableFrame').src = 'about:blank'; $('timetableImage').removeAttribute('src');
    $('timetableView').classList.add('hidden'); $('timetableEmpty').classList.remove('hidden');
    $('timetableUrl').value = ''; $('timetableFile').value = '';
    $('timetableStatus').textContent = ''; $('timetableUploadStatus').textContent = 'Der Stundenplan wurde von diesem Gerät entfernt.';
    renderRoomTimetable();
  });
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('profileOverlay').classList.add('hidden'); $('designOverlay').classList.add('hidden'); $('timetableOverlay').classList.add('hidden'); } });
function connect(action) {
  if (!myProfile) { $('setupOverlay').classList.remove('hidden'); return; }
  error.textContent = ''; myName = myProfile.name;
  const roomName = roomNameInput.value.trim();
  if (action === 'create' && !roomName) { error.textContent = 'Bitte gib einen Raumnamen ein.'; roomNameInput.focus(); return; }
  roomCode = codeInput.value.trim().toUpperCase();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(scheme + '//' + location.host);
  $('connection').classList.remove('offline'); $('connection').innerHTML = '<i></i> verbindet…';
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: action, identity, code: roomCode, roomName })));
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.type === 'error') { error.textContent = data.message; if (savedRoomSession?.code === roomCode) clearRoomSession(); socket.close(); return; }
    if (data.type === 'imageError') { renderNotice(data.message); return; }
    if (data.type === 'joined') { roomCode = data.code; $('roomCode').textContent = roomCode; $('roomTitle').textContent = data.roomName || 'Euer Raum'; home.classList.add('hidden'); chatWorkspace.classList.remove('hidden'); $('messages').innerHTML = ''; data.history.forEach(renderMessage); saveRoomSession(); renderRoomTimetable(); updateConnection(true); }
    if (data.type === 'message' || data.type === 'image') renderMessage(data);    if (data.type === 'notice') renderNotice(data.text);
    if (data.type === 'typing') renderTyping(data.users);
    if (data.type === 'readReceipt') updateReadReceipt(data.messageId, data.count);
  });
  socket.addEventListener('close', () => updateConnection(false));
  socket.addEventListener('error', () => { error.textContent = 'Verbindung fehlgeschlagen. Läuft der Chatserver?'; updateConnection(false); });
}
function updateConnection(ok) { $('connection').classList.toggle('offline', !ok); $('connection').innerHTML = '<i></i> ' + (ok ? 'verbunden' : 'Verbindung getrennt'); }
function renderNotice(text) { const item = document.createElement('div'); item.className = 'notice'; item.textContent = text; $('messages').append(item); scrollDown(); }
function renderMessage(msg) {
  const empty = $('messages').querySelector('.empty'); if (empty) empty.remove();  const bubble = document.createElement('article'); bubble.className = 'bubble' + (msg.name === myName ? ' mine' : '');
  if (msg.id) bubble.dataset.messageId = msg.id; bubble._chatMessage = msg;
  const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = msg.name === myName ? 'Du' : msg.name; bubble.append(sender);
  if (msg.type === 'image') { const image = document.createElement('img'); image.className = 'message-image'; image.src = msg.image; image.alt = 'Bild von ' + msg.name; image.loading = 'lazy'; bubble.append(image); }
  else { const text = document.createElement('div'); text.className = 'text'; text.textContent = msg.text; bubble.append(text); }  const time = document.createElement('time'); time.textContent = new Date(msg.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); bubble.append(time);
  if (msg.name === myName && msg.id) { const receipt = document.createElement('span'); receipt.className = 'read-receipt'; receipt.textContent = '✓ Gesendet'; bubble.append(receipt); ownReceipts.set(msg.id, receipt); }
  $('messages').append(bubble); if (readObserver && msg.id && msg.name !== myName) readObserver.observe(bubble); else if (!readObserver && msg.id && msg.name !== myName && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'read', messageId: msg.id })); scrollDown();
}function updateReadReceipt(messageId, count) { const receipt = ownReceipts.get(messageId); if (receipt) receipt.textContent = '✓✓ Gelesen' + (count > 1 ? ' (' + count + ')' : ''); }
function renderTyping(users) { const names = (users || []).filter(name => name !== myName); const indicator = $('typingIndicator'); indicator.textContent = names.length === 0 ? '' : names.length === 1 ? names[0] + ' tippt gerade…' : names.join(', ') + ' tippen gerade…'; }
function updateTyping() { if (!socket || socket.readyState !== WebSocket.OPEN) return; if (!typingActive) { socket.send(JSON.stringify({ type: 'typing', active: true })); typingActive = true; } clearTimeout(typingTimer); typingTimer = setTimeout(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'typing', active: false })); typingActive = false; }, 1400); }
function stopTyping() { clearTimeout(typingTimer); if (typingActive && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'typing', active: false })); typingActive = false; }
function scrollDown() { $('messages').scrollTop = $('messages').scrollHeight; }
function saveRoomSession() { localStorage.setItem('pwgChatSession', JSON.stringify({ identity, code: roomCode })); }
function clearRoomSession() { localStorage.removeItem('pwgChatSession'); }
function leaveRoom() { clearRoomSession(); if (socket) socket.close(); chatWorkspace.classList.add('hidden'); home.classList.remove('hidden'); error.textContent = ''; roomCode = ''; $('messages').innerHTML = '<div class="empty"><span>✳</span><strong>Hier beginnt euer Gespräch.</strong><small>Schickt die erste Nachricht oder teilt den Raumcode.</small></div>'; }
$('create').addEventListener('click', () => connect('create'));
$('join').addEventListener('click', () => { if (codeInput.value.trim().length !== 6) { error.textContent = 'Ein Raumcode besteht aus 6 Zeichen.'; codeInput.focus(); return; } connect('join'); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); error.textContent = ''; });
roomNameInput.addEventListener('input', () => error.textContent = '');$('message').addEventListener('input', () => { if ($('message').value.trim()) updateTyping(); else stopTyping(); });
$('message').addEventListener('blur', stopTyping);
$('form').addEventListener('submit', event => { event.preventDefault(); const input = $('message'), text = input.value.trim(); if (text && socket?.readyState === WebSocket.OPEN) { stopTyping(); socket.send(JSON.stringify({ type: 'message', text })); input.value = ''; input.focus(); } });
$('imageButton').addEventListener('click', () => $('imageFile').click());
$('imageFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { renderNotice('Bitte wähle eine Bilddatei aus.'); event.target.value = ''; return; }
  if (file.size > 15 * 1024 * 1024) { renderNotice('Das Originalbild ist zu groß. Bitte wähle ein kleineres Bild.'); event.target.value = ''; return; }
  const button = $('imageButton'); button.disabled = true;
  try { const dataUrl = await compressImage(file); if (dataUrl.length > 650000) throw new Error('Das Bild ist zu groß. Bitte wähle ein kleineres Bild.'); if (socket?.readyState !== WebSocket.OPEN) throw new Error('Die Verbindung zum Raum ist unterbrochen.'); socket.send(JSON.stringify({ type: 'image', image: dataUrl })); }
  catch (err) { renderNotice(err.message || 'Das Bild konnte nicht geladen werden. Wähle JPG oder PNG.'); }
  finally { button.disabled = false; event.target.value = ''; }
});
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try { const image = new Image(); image.src = url; await image.decode(); const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); for (const quality of [0.78, 0.66, 0.54, 0.42]) { const result = canvas.toDataURL('image/jpeg', quality); if (result.length <= 650000) return result; } return canvas.toDataURL('image/jpeg', 0.35); }
  finally { URL.revokeObjectURL(url); }
}
$('copy').addEventListener('click', async () => {
  const url = new URL(location.href); url.search = ''; url.searchParams.set('room', roomCode); url.hash = '';
  const invite = { title: 'PWG Chatroom', text: 'Komm in meinen Chatraum. Öffne den Link und tritt mit deinem Profil bei:', url: url.toString() };
  if (navigator.share) { try { await navigator.share(invite); } catch (err) { if (err.name !== 'AbortError') renderNotice('Der Einladungslink konnte nicht geteilt werden.'); } return; }
  try { await navigator.clipboard.writeText(url.toString()); $('copy').innerHTML = 'Link kopiert ✓'; setTimeout(() => $('copy').innerHTML = 'Link teilen <span>↗</span>', 1800); }
  catch { window.prompt('Teile diesen Einladungslink:', url.toString()); }
});
$('back').addEventListener('click', leaveRoom); $('leaveRoom').addEventListener('click', leaveRoom);
if (hasInviteCode) codeInput.value = inviteCode;
loadProfile().then(() => { if (myProfile && hasInviteCode) connect('join'); else if (myProfile && savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); } });


function setTheme(theme) {
  const selected = ['gold', 'light', 'stone'].includes(theme) ? theme : 'gold';
  document.body.dataset.theme = selected;
  localStorage.setItem('pwgChatTheme', selected);
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === selected));
  });
  const status = $('themeStatus');
  if (status) status.textContent = 'Aktives Design: ' + ({ gold: 'Schwarz & Gold', light: 'Weiß & Schwarz', stone: 'Sandstein' }[selected]);
}
setTheme(localStorage.getItem('pwgChatTheme') || 'gold');
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
