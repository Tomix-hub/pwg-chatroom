const $ = (id) => document.getElementById(id);
const home = $('home'), chat = $('chat'), chatWorkspace = $('chatWorkspace'), nameInput = $('name'), roomNameInput = $('roomNameInput'), codeInput = $('code'), error = $('error');let socket, whisperSocket, myName = '', roomCode = '', myProfile = null, typingActive = false, typingTimer, activeWhisper = null;
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
const inviteCode = (new URLSearchParams(location.search).get('room') || '').replace(/[^0-9]/g, '').slice(0, 6);
const hasInviteCode = /^[0-9]{6}$/.test(inviteCode);
nameInput.readOnly = true; nameInput.placeholder = 'Wird mit deinem Profil gespeichert';
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-PWG-Identity': identity, ...(options.headers || {}) } });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Die Anfrage ist fehlgeschlagen.'); return result;
}
async function loadRoomContacts() {
  if (!myProfile) return;
  try {
    const data = await api('/api/contacts'); const list = $('contactList'); list.replaceChildren();
    if (!data.contacts.length) { const empty = document.createElement('p'); empty.className = 'contact-empty'; empty.textContent = 'Hier erscheinen Personen aus gemeinsamen Räumen.'; list.append(empty); return; }
    data.contacts.forEach(contact => {
      const button = document.createElement('button'); button.className = 'contact-item'; button.type = 'button';
      const avatar = document.createElement('span'); avatar.className = 'contact-avatar'; updateAvatarElement(avatar, contact.avatar, contact.name);
      const label = document.createElement('span'); label.className = 'contact-name'; label.textContent = contact.name;
      const action = document.createElement('span'); action.className = 'contact-whisper'; action.textContent = 'Flüstern ↗';
      button.append(avatar, label, action); button.addEventListener('click', () => openWhisper(contact.identity, contact.name)); list.append(button);
    });
  } catch {}
}
function fillProfile(profile) {
  myProfile = profile; myName = profile.name; nameInput.value = myName; localStorage.setItem('pwgChatName', myName);
  $('profileName').textContent = profile.name; updateAvatarElement($('profileAvatar'), profile.avatar, profile.name);
  $('renameName').value = profile.name;
  loadRoomContacts();
  connectWhisperInbox();
}
function updateAvatarElement(element, avatar, name) {
  element.replaceChildren();
  if (avatar) { const image = document.createElement('img'); image.className = 'avatar-photo'; image.src = avatar; image.alt = ''; element.append(image); }
  else element.textContent = (name || '?').trim().charAt(0).toLocaleUpperCase();
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
$('changeAvatar').addEventListener('click', () => $('avatarFile').click());
$('avatarFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const status = $('avatarStatus'); status.textContent = '';
  if (!file.type.startsWith('image/')) { status.textContent = 'Bitte wähle eine Bilddatei aus.'; event.target.value = ''; return; }
  if (file.size > 12 * 1024 * 1024) { status.textContent = 'Das Bild ist zu groß. Wähle ein kleineres Bild.'; event.target.value = ''; return; }
  try {
    const avatar = await compressAvatar(file);
    const data = await api('/api/profile/avatar', { method: 'POST', body: JSON.stringify({ avatar }) });
    fillProfile(data.profile); status.textContent = 'Profilbild gespeichert.';
  } catch (err) { status.textContent = err.message || 'Das Profilbild konnte nicht gespeichert werden.'; }
  event.target.value = '';
});
async function compressAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.46, 0.34]) { const result = canvas.toDataURL('image/jpeg', quality); if (result.length <= 140000) return result; }
    throw new Error('Das Profilbild ist zu groß. Bitte wähle ein einfacheres Bild.');
  } finally { URL.revokeObjectURL(url); }
}
$('designButton').addEventListener('click', () => $('designOverlay').classList.remove('hidden'));
$('closeDesign').addEventListener('click', () => $('designOverlay').classList.add('hidden'));
$('designOverlay').addEventListener('click', event => { if (event.target === $('designOverlay')) $('designOverlay').classList.add('hidden'); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('profileOverlay').classList.add('hidden'); $('designOverlay').classList.add('hidden'); } });
function connect(action) {
  if (!myProfile) { $('setupOverlay').classList.remove('hidden'); return; }
  error.textContent = ''; myName = myProfile.name;
  const roomName = roomNameInput.value.trim();
  if (action === 'create' && !roomName) { error.textContent = 'Bitte gib einen Raumnamen ein.'; roomNameInput.focus(); return; }
  roomCode = codeInput.value.trim().replace(/\D/g, '').slice(0, 6);
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(scheme + '//' + location.host);
  $('connection').classList.remove('offline'); $('connection').innerHTML = '<i></i> verbindet…';
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: action, identity, code: roomCode, roomName })));
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.type === 'error') { error.textContent = data.message; if (savedRoomSession?.code === roomCode) clearRoomSession(); socket.close(); return; }
    if (data.type === 'imageError') { renderNotice(data.message); return; }
    if (data.type === 'joined') { closeWhisperInbox(); if (activeWhisper) { activeWhisper = null; chatWorkspace.classList.remove('whisper-only', 'has-whisper'); $('privateChat').classList.add('hidden'); } roomCode = data.code; $('roomCode').textContent = roomCode; $('roomTitle').textContent = data.roomName || 'Euer Raum'; home.classList.add('hidden'); chat.classList.remove('hidden'); chatWorkspace.classList.remove('hidden'); $('messages').innerHTML = ''; data.history.forEach(renderMessage); saveRoomSession(); updateConnection(true); loadRoomContacts(); }
    if (data.type === 'message' || data.type === 'image') renderMessage(data);
    if (data.type === 'avatarUpdate') document.querySelectorAll('.bubble[data-identity="' + CSS.escape(data.identity) + '"] .sender-avatar').forEach(element => updateAvatarElement(element, data.avatar, data.name));
    handleWhisperData(data);
    if (data.type === 'notice') { renderNotice(data.text); loadRoomContacts(); }
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
  if (msg.id) bubble.dataset.messageId = msg.id; if (msg.identity) bubble.dataset.identity = msg.identity; bubble._chatMessage = msg;
  const sender = document.createElement('span'); sender.className = 'sender'; const avatar = document.createElement('span'); avatar.className = 'sender-avatar'; updateAvatarElement(avatar, msg.avatar, msg.name); sender.append(avatar);
  if (msg.identity && msg.identity !== identity) { const name = document.createElement('button'); name.className = 'sender-name'; name.type = 'button'; name.textContent = msg.name; name.title = 'Privat mit ' + msg.name + ' flüstern'; name.addEventListener('click', () => openWhisper(msg.identity, msg.name)); sender.append(name); }
  else sender.append(document.createTextNode(msg.name === myName ? 'Du' : msg.name));
  bubble.append(sender);
  if (msg.type === 'image') { const image = document.createElement('img'); image.className = 'message-image'; image.src = msg.image; image.alt = 'Bild von ' + msg.name; image.loading = 'lazy'; bubble.append(image); }
  else { const text = document.createElement('div'); text.className = 'text'; text.textContent = msg.text; bubble.append(text); }  const time = document.createElement('time'); time.textContent = new Date(msg.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); bubble.append(time);
  if (msg.name === myName && msg.id) { const receipt = document.createElement('span'); receipt.className = 'read-receipt'; receipt.textContent = '✓ Gesendet'; bubble.append(receipt); ownReceipts.set(msg.id, receipt); }
  $('messages').append(bubble); if (readObserver && msg.id && msg.name !== myName) readObserver.observe(bubble); else if (!readObserver && msg.id && msg.name !== myName && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'read', messageId: msg.id })); scrollDown();
}
function openWhisper(targetIdentity, targetName) {
  const inRoom = Boolean(roomCode && socket?.readyState === WebSocket.OPEN);
  if (!targetIdentity || targetIdentity === identity || (!inRoom && !myProfile)) return;
  activeWhisper = { identity: targetIdentity, name: targetName };
  if (inRoom) chatWorkspace.classList.add('has-whisper');
  else { home.classList.add('hidden'); chatWorkspace.classList.remove('hidden'); chatWorkspace.classList.add('whisper-only'); chat.classList.add('hidden'); }
  $('privateChat').classList.remove('hidden'); $('privateTitle').textContent = 'Flüstern mit ' + targetName;
  $('privateMessages').replaceChildren();
  if (inRoom) socket.send(JSON.stringify({ type: 'whisperHistory', withIdentity: targetIdentity })); else connectWhisperSocket(targetIdentity);
  $('whisperMessage').focus();
}
function closeWhisper() {
  activeWhisper = null; chatWorkspace.classList.remove('has-whisper'); $('privateChat').classList.add('hidden'); $('privateMessages').replaceChildren();
  if (!roomCode) { chatWorkspace.classList.remove('whisper-only'); chat.classList.remove('hidden'); chatWorkspace.classList.add('hidden'); home.classList.remove('hidden'); if (whisperSocket && !whisperSocket.isInbox) { whisperSocket.close(); whisperSocket = null; } connectWhisperInbox(); }
}
function renderWhisperEmpty() { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<span>✉</span><strong>Flüstern beginnt hier.</strong><small>Diese Unterhaltung ist nur für euch beide sichtbar.</small>'; $('privateMessages').append(empty); }
function renderWhisperNotice(message) { const notice = document.createElement('div'); notice.className = 'notice'; notice.textContent = message; $('privateMessages').append(notice); }
function renderWhisperMessage(msg) {
  if (msg.id && $('privateMessages').querySelector('[data-whisper-id="' + CSS.escape(msg.id) + '"]')) return;
  const empty = $('privateMessages').querySelector('.empty'); if (empty) empty.remove();
  const bubble = document.createElement('article'); bubble.className = 'bubble' + (msg.fromIdentity === identity ? ' mine' : '');
  if (msg.id) bubble.dataset.whisperId = msg.id;
  const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = msg.fromIdentity === identity ? 'Du' : msg.name;
  const text = document.createElement('div'); text.className = 'text'; text.textContent = msg.text;
  const time = document.createElement('time'); time.textContent = new Date(msg.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  bubble.append(sender, text, time); $('privateMessages').append(bubble); $('privateMessages').scrollTop = $('privateMessages').scrollHeight;
}
function handleWhisperData(data) {
  if (data.type === 'whisperHistory' && activeWhisper?.identity === data.withIdentity) {
    $('privateMessages').replaceChildren();
    if (!data.messages.length) renderWhisperEmpty(); else data.messages.forEach(renderWhisperMessage);
  } else if (data.type === 'whisper') {
    if (activeWhisper?.identity === data.withIdentity) renderWhisperMessage(data.message);
    else if (data.message.fromIdentity !== identity) openWhisper(data.withIdentity, data.message.name);
  } else if (data.type === 'whisperError') {
    if (activeWhisper) renderWhisperNotice(data.message); else error.textContent = data.message;
  }
}
function connectWhisperSocket(targetIdentity) {
  if (whisperSocket?.readyState === WebSocket.OPEN && (whisperSocket.isInbox || whisperSocket.dmWith === targetIdentity)) {
    whisperSocket.send(JSON.stringify({ type: 'whisperHistory', withIdentity: targetIdentity })); return;
  }
  if (whisperSocket?.isInbox && whisperSocket.readyState === WebSocket.CONNECTING) {
    const current = whisperSocket; current.addEventListener('open', () => { if (whisperSocket === current && activeWhisper?.identity === targetIdentity) current.send(JSON.stringify({ type: 'whisperHistory', withIdentity: targetIdentity })); }, { once: true }); return;
  }
  if (whisperSocket) whisperSocket.close();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(scheme + '//' + location.host); current.dmWith = targetIdentity; whisperSocket = current;
  current.addEventListener('open', () => current.send(JSON.stringify({ type: 'dmConnect', identity, withIdentity: targetIdentity })));
  current.addEventListener('message', event => handleWhisperData(JSON.parse(event.data)));
  current.addEventListener('close', () => { if (whisperSocket === current) whisperSocket = null; });
}
function connectWhisperInbox() {
  if (!myProfile || roomCode || (whisperSocket && whisperSocket.readyState < WebSocket.CLOSING)) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(scheme + '//' + location.host); current.isInbox = true; whisperSocket = current;
  current.addEventListener('open', () => current.send(JSON.stringify({ type: 'dmInbox', identity })));
  current.addEventListener('message', event => handleWhisperData(JSON.parse(event.data)));
  current.addEventListener('close', () => { if (whisperSocket === current) whisperSocket = null; });
}
function closeWhisperInbox() { if (whisperSocket?.isInbox) { const current = whisperSocket; whisperSocket = null; current.close(); } }
function sendWhisper(text) {
  const channel = roomCode ? socket : whisperSocket;
  if (activeWhisper && channel?.readyState === WebSocket.OPEN) channel.send(JSON.stringify({ type: 'whisper', toIdentity: activeWhisper.identity, text }));
}
$('privateBack').addEventListener('click', closeWhisper);
function updateReadReceipt(messageId, count) { const receipt = ownReceipts.get(messageId); if (receipt) receipt.textContent = '✓✓ Gelesen' + (count > 1 ? ' (' + count + ')' : ''); }
function renderTyping(users) { const names = (users || []).filter(name => name !== myName); const indicator = $('typingIndicator'); indicator.textContent = names.length === 0 ? '' : names.length === 1 ? names[0] + ' tippt gerade…' : names.join(', ') + ' tippen gerade…'; }
function updateTyping() { if (!socket || socket.readyState !== WebSocket.OPEN) return; if (!typingActive) { socket.send(JSON.stringify({ type: 'typing', active: true })); typingActive = true; } clearTimeout(typingTimer); typingTimer = setTimeout(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'typing', active: false })); typingActive = false; }, 1400); }
function stopTyping() { clearTimeout(typingTimer); if (typingActive && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'typing', active: false })); typingActive = false; }
function scrollDown() { $('messages').scrollTop = $('messages').scrollHeight; }
function saveRoomSession() { localStorage.setItem('pwgChatSession', JSON.stringify({ identity, code: roomCode })); }
function clearRoomSession() { localStorage.removeItem('pwgChatSession'); }
function leaveRoom() { if (activeWhisper) closeWhisper(); clearRoomSession(); if (socket) socket.close(); chatWorkspace.classList.add('hidden'); home.classList.remove('hidden'); error.textContent = ''; roomCode = ''; $('messages').innerHTML = '<div class="empty"><span>✳</span><strong>Hier beginnt euer Gespräch.</strong><small>Schickt die erste Nachricht oder teilt den Raumcode.</small></div>'; loadRoomContacts(); connectWhisperInbox(); }
$('create').addEventListener('click', () => connect('create'));
$('join').addEventListener('click', () => { if (codeInput.value.trim().length !== 6) { error.textContent = 'Ein Raumcode besteht aus 6 Ziffern.'; codeInput.focus(); return; } connect('join'); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); error.textContent = ''; });
roomNameInput.addEventListener('input', () => error.textContent = '');$('message').addEventListener('input', () => { if ($('message').value.trim()) updateTyping(); else stopTyping(); });
$('message').addEventListener('blur', stopTyping);
$('form').addEventListener('submit', event => { event.preventDefault(); const input = $('message'), text = input.value.trim(); if (text && socket?.readyState === WebSocket.OPEN) { stopTyping(); socket.send(JSON.stringify({ type: 'message', text })); input.value = ''; input.focus(); } });
$('whisperForm').addEventListener('submit', event => { event.preventDefault(); const input = $('whisperMessage'), text = input.value.trim(), channel = roomCode ? socket : whisperSocket; if (text && activeWhisper && channel?.readyState === WebSocket.OPEN) { sendWhisper(text); input.value = ''; input.focus(); } });
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
  try { await navigator.clipboard.writeText(url.toString()); $('copy').innerHTML = 'Link kopiert ✓'; setTimeout(() => $('copy').innerHTML = 'Airdroppen <span>↗</span>', 1800); }
  catch { window.prompt('Teile diesen Einladungslink:', url.toString()); }
});
$('back').addEventListener('click', leaveRoom); $('leaveRoom').addEventListener('click', leaveRoom);
if (hasInviteCode) codeInput.value = inviteCode;
loadProfile().then(() => { if (myProfile && hasInviteCode) connect('join'); else if (myProfile && savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); } });


function setTheme(theme) {
  const selected = ['gold', 'light', 'stone', 'zoe', 'sky', 'mint', 'lilac'].includes(theme) ? theme : 'gold';
  document.body.dataset.theme = selected;
  localStorage.setItem('pwgChatTheme', selected);
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === selected));
  });
  const status = $('themeStatus');
  if (status) status.textContent = 'Aktives Design: ' + ({ gold: 'Schwarz & Gold', light: 'Weiß & Schwarz', stone: 'Sandstein', zoe: 'Zoe', sky: 'Himmel', mint: 'Minze', lilac: 'Flieder' }[selected]);
}
setTheme(localStorage.getItem('pwgChatTheme') || 'gold');
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
