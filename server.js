const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const rooms = new Map();
const whispers = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
let database = { users: {}, names: {} };
let hadStoredProfiles = false;
try {
  const previous = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  hadStoredProfiles = true;
  for (const [identity, oldUser] of Object.entries(previous.users || {})) {
    if (!oldUser || typeof oldUser !== 'object') continue;
    if (oldUser.name) { database.users[identity] = { identity, name: oldUser.name, ...(typeof oldUser.avatar === 'string' ? { avatar: oldUser.avatar } : {}) }; database.names[normName(oldUser.name)] = identity; }
  }
} catch {}
function saveDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = DATA_FILE + '.tmp'; fs.writeFileSync(temp, JSON.stringify(database)); fs.renameSync(temp, DATA_FILE);
}
if (hadStoredProfiles) saveDatabase();
function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24); }
function normName(value) { return cleanName(value).toLocaleLowerCase('de'); }
function publicUser(user) { return { name: user.name, avatar: user.avatar || null }; }
function getUser(id) { return database.users[String(id || '')]; }
function identityFrom(req, data) { return req.headers['x-pwg-identity'] || data?.identity || ''; }
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', part => { body += part; if (body.length > 180_000) { reject(new Error('too_large')); req.destroy(); } }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid_json')); } }); }); }
function userSummary(user) { return { profile: publicUser(user) }; }
function broadcast(room, payload) { for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify(payload)); }
function addToHistory(room, message) {
  room.history.push(message); room.historyBytes = (room.historyBytes || 0) + JSON.stringify(message).length;
  while (room.history.length > 100 || room.historyBytes > 2 * 1024 * 1024) { const removed = room.history.shift(); room.historyBytes -= JSON.stringify(removed).length; }
}
function whisperKey(code, a, b) { return code + ':' + [a, b].sort().join(':'); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let data = {};
    try { if (req.method !== 'GET') data = await readBody(req); } catch (error) { return send(res, error.message === 'too_large' ? 413 : 400, { error: 'Ungültige Anfrage.' }); }
    const id = identityFrom(req, data); let user = getUser(id);
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const identity = String(data.identity || ''); const name = cleanName(data.name);
      if (!/^[a-f0-9-]{36}$/i.test(identity)) return send(res, 400, { error: 'Die Geräte-ID ist ungültig. Bitte lade die Seite neu.' });
      if (name.length < 2) return send(res, 400, { error: 'Der Name muss mindestens 2 Zeichen lang sein.' });
      if (database.users[identity]) return send(res, 200, userSummary(database.users[identity]));
      if (database.names[normName(name)]) return send(res, 409, { error: 'Dieser Name ist schon vergeben. Bitte wähle einen anderen Namen.' });
      user = { identity, name }; database.users[identity] = user; database.names[normName(name)] = identity; saveDatabase(); return send(res, 201, userSummary(user));
    }
    if (!user) return send(res, 401, { error: 'Profil nicht gefunden. Bitte wähle deinen Namen erneut.' });
    if (req.method === 'GET' && url.pathname === '/api/profile') return send(res, 200, userSummary(user));
    if (req.method === 'POST' && url.pathname === '/api/profile/avatar') {
      const avatar = String(data.avatar || '');
      if (avatar.length > 140_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) return send(res, 400, { error: 'Das Profilbild ist ungültig oder zu groß.' });
      user.avatar = avatar; saveDatabase();
      for (const client of wss.clients) {
        const joined = client.joined;
        if (!joined || joined.identity !== user.identity) continue;
        joined.avatar = avatar;
        const room = rooms.get(joined.code);
        if (!room) continue;
        for (const message of room.history) if (message.identity === user.identity) message.avatar = avatar;
        broadcast(room, { type: 'avatarUpdate', identity: user.identity, name: user.name, avatar });
      }
      return send(res, 200, userSummary(user));
    }
    if (req.method === 'POST' && url.pathname === '/api/profile/name') {
      const name = cleanName(data.name);
      if (name.length < 2) return send(res, 400, { error: 'Der Name muss mindestens 2 Zeichen lang sein.' });
      const normalized = normName(name), owner = database.names[normalized];
      if (owner && owner !== user.identity) return send(res, 409, { error: 'Dieser Name ist schon vergeben. Bitte wähle einen anderen Namen.' });
      if (name !== user.name) {
        delete database.names[normName(user.name)];
        user.name = name;
        database.names[normalized] = user.identity;
        saveDatabase();
        for (const client of wss.clients) {
          const joined = client.joined;
          if (!joined || joined.identity !== user.identity) continue;
          joined.name = name;
          const room = rooms.get(joined.code);
          if (room?.typing.has(user.identity)) {
            room.typing.set(user.identity, name);
            broadcast(room, { type: 'typing', users: [...room.typing].filter(([identity]) => identity !== user.identity).map(([, typingName]) => typingName) });
          }
        }
      }
      return send(res, 200, userSummary(user));
    }
    return send(res, 404, { error: 'Unbekannte Anfrage.' });
  }
  const pathname = decodeURIComponent(url.pathname);
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(__dirname, name);
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, maxPayload: 800 * 1024 });
wss.on('connection', (socket) => {
  let joined = null;
  socket.on('message', (raw) => {
    let data; try { data = JSON.parse(raw.toString()); } catch { return; }
    if (data.type === 'join' || data.type === 'create') {
      const user = getUser(data.identity);
      if (!user) return socket.send(JSON.stringify({ type: 'error', message: 'Profil nicht gefunden. Bitte wähle deinen Namen erneut.' }));
      const name = user.name;
      if (data.type === 'join') {
        const code = String(data.code || '').replace(/[^0-9]/g, '').slice(0, 6);
        if (!/^[0-9]{6}$/.test(code)) return socket.send(JSON.stringify({ type: 'error', message: 'Bitte gib einen gültigen Raumcode ein.' }));
        if (!rooms.has(code)) return socket.send(JSON.stringify({ type: 'error', message: 'Diesen Raum gibt es nicht. Prüfe den Code.' }));
        joined = { code, identity: user.identity, name, avatar: user.avatar || null }; socket.joined = joined;
        const room = rooms.get(code); room.clients.add(socket);
        socket.send(JSON.stringify({ type: 'joined', code, roomName: room.name, history: room.history })); broadcast(room, { type: 'notice', text: name + ' ist dem Raum beigetreten.' });
      } else {
        const roomName = String(data.roomName || '').trim().slice(0, 32);
        if (!roomName) return socket.send(JSON.stringify({ type: 'error', message: 'Bitte gib einen Raumnamen ein.' }));
        let code; do { code = randomInt(0, 1_000_000).toString().padStart(6, '0'); } while (rooms.has(code));
        rooms.set(code, { name: roomName, owner: user.identity, clients: new Set(), history: [], historyBytes: 0, readers: new Map(), typing: new Map() });
        joined = { code, identity: user.identity, name, avatar: user.avatar || null }; socket.joined = joined; const room = rooms.get(code); room.clients.add(socket);
        socket.send(JSON.stringify({ type: 'joined', code, roomName: room.name, history: [] })); broadcast(room, { type: 'notice', text: name + ' hat den Raum erstellt.' });
      }
    } else if (data.type === 'whisperHistory' && joined) {
      const withIdentity = String(data.withIdentity || '');
      if (!/^[a-f0-9-]{36}$/i.test(withIdentity) || withIdentity === joined.identity) return socket.send(JSON.stringify({ type: 'whisperError', message: 'Diesen privaten Chat kannst du nicht öffnen.' }));
      const room = rooms.get(joined.code);
      const partnerOnline = [...room.clients].some(client => client.readyState === 1 && client.joined?.identity === withIdentity);
      if (!partnerOnline) return socket.send(JSON.stringify({ type: 'whisperError', message: 'Die Person muss gerade mit dir im Raum sein.' }));
      socket.send(JSON.stringify({ type: 'whisperHistory', withIdentity, messages: whispers.get(whisperKey(joined.code, joined.identity, withIdentity)) || [] }));
    } else if (data.type === 'whisper' && joined) {
      const toIdentity = String(data.toIdentity || ''), text = String(data.text || '').trim().slice(0, 1000);
      if (!/^[a-f0-9-]{36}$/i.test(toIdentity) || toIdentity === joined.identity || !text) return;
      const room = rooms.get(joined.code);
      const recipients = [...room.clients].filter(client => client.readyState === 1 && client.joined?.identity === toIdentity);
      if (!recipients.length) return socket.send(JSON.stringify({ type: 'whisperError', message: 'Die Person ist nicht mehr in diesem Raum.' }));
      const key = whisperKey(joined.code, joined.identity, toIdentity), history = whispers.get(key) || [];
      const message = { id: randomUUID(), fromIdentity: joined.identity, name: joined.name, text, time: new Date().toISOString() };
      history.push(message); if (history.length > 200) history.splice(0, history.length - 200); whispers.set(key, history);
      for (const client of room.clients) {
        if (client.readyState !== 1) continue;
        const viewer = client.joined?.identity;
        if (viewer === joined.identity || viewer === toIdentity) client.send(JSON.stringify({ type: 'whisper', withIdentity: viewer === joined.identity ? toIdentity : joined.identity, message }));
      }
    } else if (data.type === 'message' && joined) {
      const text = String(data.text || '').trim().slice(0, 1000); if (!text) return;
      const room = rooms.get(joined.code); if (!room) return;
      const message = { type: 'message', id: randomUUID(), identity: joined.identity, name: joined.name, avatar: joined.avatar, text, time: new Date().toISOString() };
      room.history.push(message); room.historyBytes += JSON.stringify(message).length;
      while (room.history.length > 100 || room.historyBytes > 2 * 1024 * 1024) { const removed = room.history.shift(); room.historyBytes -= JSON.stringify(removed).length; }
      broadcast(room, message);
    } else if (data.type === 'image' && joined) {
      const room = rooms.get(joined.code); if (!room) return;
      const image = String(data.image || '');
      if (image.length > 650000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return socket.send(JSON.stringify({ type: 'imageError', message: 'Das Bild ist ungültig oder zu groß.' }));
      const message = { type: 'image', id: randomUUID(), identity: joined.identity, name: joined.name, avatar: joined.avatar, image, time: new Date().toISOString() }; addToHistory(room, message); broadcast(room, message);
    } else if (data.type === 'typing' && joined) {
      const room = rooms.get(joined.code); if (!room) return;
      if (data.active) room.typing.set(joined.identity, joined.name); else room.typing.delete(joined.identity);
      broadcast(room, { type: 'typing', users: [...room.typing].filter(([identity]) => identity !== joined.identity).map(([, name]) => name) });
    } else if (data.type === 'read' && joined) {
      const room = rooms.get(joined.code); if (!room) return;
      const message = room.history.find(item => item.id === data.messageId);
      if (!message || message.name === joined.name) return;
      if (!room.readers.has(message.id)) room.readers.set(message.id, new Set());
      const readers = room.readers.get(message.id);
      if (readers.has(joined.identity)) return;
      readers.add(joined.identity);
      broadcast(room, { type: 'readReceipt', messageId: message.id, count: readers.size });
    }
  });
  socket.on('close', () => { if (joined) { const room = rooms.get(joined.code); if (room) { room.clients.delete(socket); room.typing.delete(joined.identity); broadcast(room, { type: 'typing', users: [...room.typing.values()] }); broadcast(room, { type: 'notice', text: joined.name + ' hat den Raum verlassen.' }); } } });
});
server.listen(PORT, '0.0.0.0', () => console.log('PWG Chatroom läuft auf Port ' + PORT));
