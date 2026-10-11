const $ = (id) => document.getElementById(id);
const home = $('home'), chat = $('chat'), nameInput = $('name'), codeInput = $('code'), error = $('error');
let socket, myName = '', roomCode = '';
function connect(action) {
  error.textContent = '';
  myName = nameInput.value.trim();
  if (!myName) { error.textContent = 'Bitte gib deinen Namen ein.'; nameInput.focus(); return; }
  roomCode = codeInput.value.trim().toUpperCase();
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${scheme}//${location.host}`);
  $('connection').classList.remove('offline'); $('connection').innerHTML = '<i></i> verbindet…';
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: action, name: myName, code: roomCode })));
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'error') { error.textContent = data.message; socket.close(); return; }
    if (data.type === 'joined') { roomCode = data.code; $('roomCode').textContent = roomCode; home.classList.add('hidden'); chat.classList.remove('hidden'); $('messages').innerHTML = ''; data.history.forEach(renderMessage); updateConnection(true); }
    if (data.type === 'message') renderMessage(data);
    if (data.type === 'notice') renderNotice(data.text);
  });
  socket.addEventListener('close', () => updateConnection(false));
  socket.addEventListener('error', () => { error.textContent = 'Verbindung fehlgeschlagen. Läuft der Chatserver?'; updateConnection(false); });
}
function updateConnection(ok) { $('connection').classList.toggle('offline', !ok); $('connection').innerHTML = `<i></i> ${ok ? 'verbunden' : 'Verbindung getrennt'}`; }
function renderNotice(text) { const item = document.createElement('div'); item.className = 'notice'; item.textContent = text; $('messages').append(item); scrollDown(); }
function renderMessage(msg) {
  const empty = $('messages').querySelector('.empty'); if (empty) empty.remove();
  const bubble = document.createElement('article'); bubble.className = `bubble${msg.name === myName ? ' mine' : ''}`;
  const sender = document.createElement('span'); sender.className = 'sender'; sender.textContent = msg.name === myName ? 'Du' : msg.name;
  const text = document.createElement('div'); text.className = 'text'; text.textContent = msg.text;
  const time = document.createElement('time'); time.textContent = new Date(msg.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  bubble.append(sender, text, time); $('messages').append(bubble); scrollDown();
}
function scrollDown() { $('messages').scrollTop = $('messages').scrollHeight; }
$('create').addEventListener('click', () => connect('create'));
$('join').addEventListener('click', () => { if (codeInput.value.trim().length !== 6) { error.textContent = 'Ein Raumcode besteht aus 6 Zeichen.'; codeInput.focus(); return; } connect('join'); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); error.textContent = ''; });
nameInput.addEventListener('input', () => error.textContent = '');
$('form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('message'); const text = input.value.trim(); if (text && socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'message', text })); input.value = ''; input.focus(); } });
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomCode); $('copy').innerHTML = 'Kopiert ✓'; setTimeout(() => $('copy').innerHTML = 'Code teilen <span>↗</span>', 1600); } catch { window.prompt('Teile diesen Raumcode:', roomCode); } });
$('back').addEventListener('click', () => { socket?.close(); chat.classList.add('hidden'); home.classList.remove('hidden'); $('messages').innerHTML = '<div class="empty"><span>✳</span><strong>Hier beginnt euer Gespräch.</strong><small>Schickt die erste Nachricht oder teilt den Raumcode.</small></div>'; });
