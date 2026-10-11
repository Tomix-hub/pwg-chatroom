const $ = (id) => document.getElementById(id);
const home = $('home'), chat = $('chat'), nameInput = $('name'), roomNameInput = $('roomNameInput'), codeInput = $('code'), error = $('error');
let socket, myName = '', roomCode = '';
const savedDisplayName = localStorage.getItem('pwgChatName') || '';
const savedRoomSession = (() => { try { return JSON.parse(localStorage.getItem('pwgChatSession') || 'null'); } catch { return null; } })();
const inviteCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const hasInviteCode = /^[A-Z0-9]{6}$/.test(inviteCode);
nameInput.value = savedDisplayName;
if (hasInviteCode) codeInput.value = inviteCode;
function connect(action) {
  error.textContent = '';
  myName = nameInput.value.trim();
  if (!myName) { error.textContent = 'Bitte gib deinen Namen ein.'; nameInput.focus(); return; }
  localStorage.setItem('pwgChatName', myName);
  const roomName = roomNameInput.value.trim();
  if (action === 'create' && !roomName) { error.textContent = 'Bitte gib einen Raumnamen ein.'; roomNameInput.focus(); return; }
  roomCode = codeInput.value.trim().toUpperCase();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(scheme + '//' + location.host);
  $('connection').classList.remove('offline'); $('connection').innerHTML = '<i></i> verbindet…';
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: action, name: myName, code: roomCode, roomName })));
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'error') { error.textContent = data.message; if (savedRoomSession?.code === roomCode) clearRoomSession(); socket.close(); return; }
    if (data.type === 'imageError') { renderNotice(data.message); return; }
    if (data.type === 'joined') { roomCode = data.code; $('roomCode').textContent = roomCode; $('roomTitle').textContent = data.roomName || 'Euer Raum'; home.classList.add('hidden'); chat.classList.remove('hidden'); $('messages').innerHTML = ''; data.history.forEach(renderMessage); saveRoomSession(); updateConnection(true); }
    if (data.type === 'message' || data.type === 'image') renderMessage(data);
    if (data.type === 'notice') renderNotice(data.text);
  });
  socket.addEventListener('close', () => updateConnection(false));
  socket.addEventListener('error', () => { error.textContent = 'Verbindung fehlgeschlagen. Läuft der Chatserver?'; updateConnection(false); });
}
function updateConnection(ok) { $('connection').classList.toggle('offline', !ok); $('connection').innerHTML = '<i></i> ' + (ok ? 'verbunden' : 'Verbindung getrennt'); }
function renderNotice(text) { const item = document.createElement('div'); item.className = 'notice'; item.textContent = text; $('messages').append(item); scrollDown(); }
function renderMessage(msg) {
  const empty = $('messages').querySelector('.empty'); if (empty) empty.remove();
  const bubble = document.createElement('article'); bubble.className = 'bubble' + (msg.name === myName ? ' mine' : '');
  const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = msg.name === myName ? 'Du' : msg.name;
  bubble.append(sender);
  if (msg.type === 'image') { const image = document.createElement('img'); image.className = 'message-image'; image.src = msg.image; image.alt = 'Bild von ' + msg.name; image.loading = 'lazy'; bubble.append(image); }
  else { const text = document.createElement('div'); text.className = 'text'; text.textContent = msg.text; bubble.append(text); }
  const time = document.createElement('time'); time.textContent = new Date(msg.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  bubble.append(time); $('messages').append(bubble); scrollDown();
}
function scrollDown() { $('messages').scrollTop = $('messages').scrollHeight; }
function saveRoomSession() { localStorage.setItem('pwgChatSession', JSON.stringify({ name: myName, code: roomCode })); }
function clearRoomSession() { localStorage.removeItem('pwgChatSession'); }
function leaveRoom() { clearRoomSession(); if (socket) socket.close(); chat.classList.add('hidden'); home.classList.remove('hidden'); error.textContent = ''; roomCode = ''; $('messages').innerHTML = '<div class="empty"><span>✳</span><strong>Hier beginnt euer Gespräch.</strong><small>Schickt die erste Nachricht oder teilt den Raumcode.</small></div>'; }
$('create').addEventListener('click', () => connect('create'));
$('join').addEventListener('click', () => { if (codeInput.value.trim().length !== 6) { error.textContent = 'Ein Raumcode besteht aus 6 Zeichen.'; codeInput.focus(); return; } connect('join'); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); error.textContent = ''; });
nameInput.addEventListener('input', () => { error.textContent = ''; const value = nameInput.value.trim(); if (value) localStorage.setItem('pwgChatName', value); });
roomNameInput.addEventListener('input', () => error.textContent = '');
$('form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('message'); const text = input.value.trim(); if (text && socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'message', text })); input.value = ''; input.focus(); } });
$('imageButton').addEventListener('click', () => $('imageFile').click());
$('imageFile').addEventListener('change', async (event) => {
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
  const invite = { title: 'PWG Chatroom', text: 'Komm in meinen Chatraum. Öffne den Link und tritt mit deinem gespeicherten Namen bei:', url: url.toString() };
  if (navigator.share) { try { await navigator.share(invite); } catch (err) { if (err.name !== 'AbortError') renderNotice('Der Einladungslink konnte nicht geteilt werden.'); } return; }
  try { await navigator.clipboard.writeText(url.toString()); $('copy').innerHTML = 'Einladungslink kopiert ✓'; setTimeout(() => $('copy').innerHTML = 'Freunde einladen <span>↗</span>', 1800); }
  catch { window.prompt('Teile diesen Einladungslink:', url.toString()); }
});
$('back').addEventListener('click', leaveRoom);
$('leaveRoom').addEventListener('click', leaveRoom);
function getFriends() { try { const friends = JSON.parse(localStorage.getItem('pwgChatFriends') || '[]'); return Array.isArray(friends) ? friends.filter(name => typeof name === 'string') : []; } catch { return []; } }
function renderFriends() {
  const list = $('friendList'); list.replaceChildren();
  const friends = getFriends();
  if (!friends.length) { const empty = document.createElement('small'); empty.className = 'privacy'; empty.textContent = 'Noch keine Freunde hinzugefügt.'; list.append(empty); return; }
  friends.forEach((name, index) => { const row = document.createElement('div'); row.className = 'friend-row'; const label = document.createElement('span'); label.textContent = name; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'join-button friend-remove'; remove.textContent = 'Entfernen'; remove.setAttribute('aria-label', name + ' entfernen'); remove.addEventListener('click', () => { const updated = getFriends(); updated.splice(index, 1); localStorage.setItem('pwgChatFriends', JSON.stringify(updated)); renderFriends(); }); row.append(label, remove); list.append(row); });
}
function addFriend() {
  const name = $('friendName').value.trim().slice(0, 24); if (!name) return;
  if (name.toLocaleLowerCase() === savedDisplayName.trim().toLocaleLowerCase()) { error.textContent = 'Das bist schon du.'; return; }
  const friends = getFriends(); if (friends.some(friend => friend.toLocaleLowerCase() === name.toLocaleLowerCase())) { error.textContent = 'Dieser Name steht schon in deiner Freundesliste.'; return; }
  if (friends.length >= 50) { error.textContent = 'Die Freundesliste ist voll.'; return; }
  friends.push(name); localStorage.setItem('pwgChatFriends', JSON.stringify(friends)); $('friendName').value = ''; error.textContent = ''; renderFriends();
}
$('addFriend').addEventListener('click', addFriend);
$('friendName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addFriend(); } });
renderFriends();
if (hasInviteCode) { if (savedDisplayName) connect('join'); }
else if (savedRoomSession?.name && savedRoomSession?.code) { nameInput.value = savedRoomSession.name; codeInput.value = savedRoomSession.code; connect('join'); }
else if (savedDisplayName) nameInput.value = savedDisplayName;
