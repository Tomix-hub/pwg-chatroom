const $ = (id) => document.getElementById(id);
const home = $('home'), chat = $('chat'), nameInput = $('name'), roomNameInput = $('roomNameInput'), codeInput = $('code'), error = $('error');
let socket, myName = '', roomCode = '';
function connect(action) {
  error.textContent = '';
  myName = nameInput.value.trim();
  if (!myName) { error.textContent = 'Bitte gib deinen Namen ein.'; nameInput.focus(); return; }
  const roomName = roomNameInput.value.trim();
  if (action === 'create' && !roomName) { error.textContent = 'Bitte gib einen Raumnamen ein.'; roomNameInput.focus(); return; }
  roomCode = codeInput.value.trim().toUpperCase();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(scheme + '//' + location.host);
  $('connection').classList.remove('offline'); $('connection').innerHTML = '<i></i> verbindet…';
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: action, name: myName, code: roomCode, roomName })));
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'error') { error.textContent = data.message; socket.close(); return; }
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
$('create').addEventListener('click', () => connect('create'));
$('join').addEventListener('click', () => { if (codeInput.value.trim().length !== 6) { error.textContent = 'Ein Raumcode besteht aus 6 Zeichen.'; codeInput.focus(); return; } connect('join'); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); error.textContent = ''; });
nameInput.addEventListener('input', () => error.textContent = '');
roomNameInput.addEventListener('input', () => error.textContent = '');
$('form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('message'); const text = input.value.trim(); if (text && socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'message', text })); input.value = ''; input.focus(); } });
$('imageButton').addEventListener('click', () => $('imageFile').click());
$('imageFile').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { renderNotice('Bitte wähle eine Bilddatei aus.'); event.target.value = ''; return; }
  if (file.size > 15 * 1024 * 1024) { renderNotice('Das Originalbild ist zu groß. Bitte wähle ein kleineres Bild.'); event.target.value = ''; return; }
  const button = $('imageButton'); button.disabled = true;
  try {
    const dataUrl = await compressImage(file);
    if (dataUrl.length > 650000) throw new Error('Das Bild ist zu groß. Bitte wähle ein kleineres Bild.');
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('Die Verbindung zum Raum ist unterbrochen.');
    socket.send(JSON.stringify({ type: 'image', image: dataUrl }));
  } catch (err) { renderNotice(err.message || 'Das Bild konnte nicht geladen werden. Wähle JPG oder PNG.'); }
  finally { button.disabled = false; event.target.value = ''; }
});
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.78, 0.66, 0.54, 0.42]) { const result = canvas.toDataURL('image/jpeg', quality); if (result.length <= 650000) return result; }
    return canvas.toDataURL('image/jpeg', 0.35);
  } finally { URL.revokeObjectURL(url); }
}
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomCode); $('copy').innerHTML = 'Kopiert ✓'; setTimeout(() => $('copy').innerHTML = 'Code teilen <span>↗</span>', 1600); } catch { window.prompt('Teile diesen Raumcode:', roomCode); } });
$('back').addEventListener('click', () => { socket?.close(); chat.classList.add('hidden'); home.classList.remove('hidden'); $('messages').innerHTML = '<div class="empty"><span>✳</span><strong>Hier beginnt euer Gespräch.</strong><small>Schickt die erste Nachricht oder teilt den Raumcode.</small></div>'; });


// Raumdaten im Browser merken, damit ein Neuladen die Sitzung wiederherstellt.
function saveRoomSession() { localStorage.setItem('pwgChatSession', JSON.stringify({ name: myName, code: roomCode })); }
function clearRoomSession() { localStorage.removeItem('pwgChatSession'); }
const savedRoomSession = (() => { try { return JSON.parse(localStorage.getItem('pwgChatSession') || 'null'); } catch { return null; } })();
if (savedRoomSession?.name && savedRoomSession?.code) { nameInput.value = savedRoomSession.name; codeInput.value = savedRoomSession.code; connect('join'); }
$('leaveRoom')?.addEventListener('click', () => { clearRoomSession(); if (socket) socket.close(); chat.classList.add('hidden'); home.classList.remove('hidden'); error.textContent = ''; roomCode = ''; $('messages').innerHTML = ''; });
