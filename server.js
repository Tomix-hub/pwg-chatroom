const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const rooms = new Map();
const whispers = new Map();
const homeworkFolders = [
  ['englisch-sude', 'Englisch', 'Frau Sude'], ['mathe-funk', 'Mathe', 'Frau Funk'], ['kunst-wenzler', 'Kunst', 'Frau Wenzler'], ['sport-debus', 'Sport', 'Herr Debus'],
  ['englisch-adler', 'Englisch', 'Frau Adler'], ['mathe-schindler', 'Mathe', 'Herr Schindler'], ['kunst-sapcanovic', 'Kunst', 'Frau Sapcanovic'], ['sport-halve', 'Sport', 'Herr Halve'],
  ['sowi-debus', 'SoWi', 'Herr Debus'], ['vertiefung-deutsch-graw', 'Vertiefung Deutsch', 'Frau Graw'], ['vertiefung-mathe-stenner', 'Vertiefung Mathe', 'Herr Stenner'],
  ['vertiefung-englisch-koerner', 'Vertiefung Englisch', 'Frau Körner'], ['vertiefung-mathe-tasdemir', 'Vertiefung Mathe', 'Frau Tasdemir'],
  ['biologie-halve', 'Biologie', 'Herr Halve'], ['biologie-neutsch', 'Biologie', 'Frau Neutsch'], ['paedagogik-tasdemir', 'Pädagogik', 'Frau Tasdemir'],
  ['deutsch-pfeiffer', 'Deutsch', 'Frau Pfeiffer'], ['chemie-ernst', 'Chemie', 'Frau Ernst'], ['spanisch-ewering', 'Spanisch', 'Herr Ewering'], ['spanisch-jackenkroll', 'Spanisch', 'Frau Jackenkroll'],
  ['geschichte-erben', 'Geschichte', 'Herr Erben'], ['geschichte-kues', 'Geschichte', 'Frau Kues'], ['franzoesisch-kues', 'Französisch', 'Frau Kues'],
  ['chemie-misselwitz', 'Chemie', 'Herr Misselwitz'], ['philosophie-wenzler', 'Philosophie', 'Frau Wenzler'], ['sowi-hillebrand', 'SoWi', 'Herr Hillebrand']
];
const homeworkFolderIds = new Set(homeworkFolders.map(([id]) => id));
let homework = [];
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
let database = { users: {}, names: {} };
let hadStoredProfiles = false;
try {
  const previous = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  hadStoredProfiles = true;
  for (const [key, history] of Object.entries(previous.whispers || {})) {
    if (/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i.test(key) && Array.isArray(history)) whispers.set(key, history.filter(message => message && typeof message.text === 'string' && typeof message.fromIdentity === 'string').slice(-200));
  }
  for (const [identity, oldUser] of Object.entries(previous.users || {})) {
    if (!oldUser || typeof oldUser !== 'object') continue;
    if (oldUser.name) { database.users[identity] = { identity, name: oldUser.name, ...(typeof oldUser.avatar === 'string' ? { avatar: oldUser.avatar } : {}), contacts: Array.isArray(oldUser.contacts) ? oldUser.contacts.filter(contact => /^[a-f0-9-]{36}$/i.test(contact)).slice(-100) : [] }; database.names[normName(oldUser.name)] = identity; }
  }
  homework = Array.isArray(previous.homework) ? previous.homework.filter(entry => entry && typeof entry.id === 'string' && homeworkFolderIds.has(entry.folder) && typeof entry.identity === 'string' && typeof entry.name === 'string' && typeof entry.time === 'string' && (typeof entry.text === 'string' || typeof entry.image === 'string') && (!entry.image || (entry.image.length <= 650_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.image)))).slice(-3000) : [];
} catch {}
function saveDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = DATA_FILE + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ ...database, whispers: Object.fromEntries(whispers), homework })); fs.renameSync(temp, DATA_FILE);
}
if (hadStoredProfiles) saveDatabase();
function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24); }
function normName(value) { return cleanName(value).toLocaleLowerCase('de'); }
function publicUser(user) { return { name: user.name, avatar: user.avatar || null }; }
function getUser(id) { return database.users[String(id || '')]; }
function identityFrom(req, data) { return req.headers['x-pwg-identity'] || data?.identity || ''; }
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req, maxLength = 180_000) { return new Promise((resolve, reject) => { let body = ''; req.on('data', part => { body += part; if (body.length > maxLength) { reject(new Error('too_large')); req.destroy(); } }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid_json')); } }); }); }
function userSummary(user) { return { profile: publicUser(user) }; }
function broadcast(room, payload) { for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify(payload)); }
function addToHistory(room, message) {
  room.history.push(message); room.historyBytes = (room.historyBytes || 0) + JSON.stringify(message).length;
  while (room.history.length > 100 || room.historyBytes > 2 * 1024 * 1024) { const removed = room.history.shift(); room.historyBytes -= JSON.stringify(removed).length; }
}
function whisperKey(a, b) { return [a, b].sort().join(':'); }
function rememberContact(identity, contactIdentity) {
  if (identity === contactIdentity) return false;
  const user = getUser(identity); if (!user) return false;
  user.contacts ||= [];
  const existing = user.contacts.indexOf(contactIdentity);
  if (existing >= 0) user.contacts.splice(existing, 1);
  user.contacts.push(contactIdentity); if (user.contacts.length > 100) user.contacts.shift();
  return true;
}
function rememberRoomParticipants(room, identity) {
  room.participants ||= new Set([...room.clients].map(client => client.joined?.identity).filter(Boolean));
  let changed = false;
  for (const previousIdentity of room.participants) {
    if (previousIdentity === identity) continue;
    changed = rememberContact(identity, previousIdentity) || changed;
    changed = rememberContact(previousIdentity, identity) || changed;
  }
  room.participants.add(identity);
  if (changed) saveDatabase();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let data = {};
    try { if (req.method !== 'GET') data = await readBody(req, url.pathname === '/api/homework' ? 850_000 : 180_000); } catch (error) { return send(res, error.message === 'too_large' ? 413 : 400, { error: 'Ungültige Anfrage.' }); }
    const id = identityFrom(req, data); let user = getUser(id);
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const identity = String(data.identity || ''); const name = cleanName(data.name);
      if (!/^[a-f0-9-]{36}$/i.test(identity)) return send(res, 400, { error: 'Die Geräte-ID ist ungültig. Bitte lade die Seite neu.' });
      if (name.length < 2) return send(res, 400, { error: 'Der Name muss mindestens 2 Zeichen lang sein.' });
      if (database.users[identity]) return send(res, 200, userSummary(database.users[identity]));
      if (database.names[normName(name)]) return send(res, 409, { error: 'Dieser Name ist schon vergeben. Bitte wähle einen anderen Namen.' });
      user = { identity, name, contacts: [] }; database.users[identity] = user; database.names[normName(name)] = identity; saveDatabase(); return send(res, 201, userSummary(user));
    }
    if (!user) return send(res, 401, { error: 'Profil nicht gefunden. Bitte wähle deinen Namen erneut.' });
    if (req.method === 'GET' && url.pathname === '/api/profile') return send(res, 200, userSummary(user));
    if (req.method === 'GET' && url.pathname === '/api/contacts') {
      const contacts = (user.contacts || []).map(contactId => getUser(contactId)).filter(Boolean).map(contact => ({ identity: contact.identity, ...publicUser(contact) }));
      return send(res, 200, { contacts });
    }
    if (url.pathname === '/api/homework') {
      if (req.method === 'GET') {
        const folder = String(url.searchParams.get('folder') || '');
        if (!homeworkFolderIds.has(folder)) return send(res, 400, { error: 'Dieses Fach gibt es nicht.' });
        const after = String(url.searchParams.get('after') || '');
        return send(res, 200, { entries: homework.filter(entry => entry.folder === folder && (!after || entry.time > after)).map(({ identity, ...entry }) => entry) });
      }
      if (req.method === 'POST') {
        const folder = String(data.folder || ''), text = String(data.text || '').trim().slice(0, 2000), image = String(data.image || '');
        if (!homeworkFolderIds.has(folder)) return send(res, 400, { error: 'Dieses Fach gibt es nicht.' });
        if (text.length < 1 && !image) return send(res, 400, { error: 'Schreib eine Nachricht oder wähle ein Bild aus.' });
        if (image && (image.length > 650_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) return send(res, 400, { error: 'Das Bild ist ungültig oder zu groß. Bitte wähle ein anderes Bild.' });
        if (homework.filter(entry => entry.folder === folder).length >= 300) return send(res, 413, { error: 'In diesem Fach sind schon sehr viele Beiträge gespeichert.' });
        const storedImageChars = homework.reduce((total, entry) => total + (entry.image?.length || 0), 0);
        if (image && storedImageChars + image.length > 25_000_000) return send(res, 413, { error: 'Der gemeinsame Bildspeicher ist voll. Bitte speichere ältere Bilder auf deinem Gerät.' });
        const entry = { id: randomUUID(), folder, identity: user.identity, name: user.name, text, ...(image ? { image } : {}), time: new Date().toISOString() };
        homework.push(entry); if (homework.length > 3000) homework.splice(0, homework.length - 3000);
        saveDatabase(); const { identity, ...publicEntry } = entry; return send(res, 201, { entry: publicEntry });
      }
    }
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
        const room = rooms.get(code); rememberRoomParticipants(room, user.identity); room.clients.add(socket);
        socket.send(JSON.stringify({ type: 'joined', code, roomName: room.name, history: room.history })); broadcast(room, { type: 'notice', text: name + ' ist dem Raum beigetreten.' });
      } else {
        const roomName = String(data.roomName || '').trim().slice(0, 32);
        if (!roomName) return socket.send(JSON.stringify({ type: 'error', message: 'Bitte gib einen Raumnamen ein.' }));
        let code; do { code = randomInt(0, 1_000_000).toString().padStart(6, '0'); } while (rooms.has(code));
        rooms.set(code, { name: roomName, owner: user.identity, clients: new Set(), participants: new Set([user.identity]), history: [], historyBytes: 0, readers: new Map(), typing: new Map() });
        joined = { code, identity: user.identity, name, avatar: user.avatar || null }; socket.joined = joined; const room = rooms.get(code); room.clients.add(socket);
        socket.send(JSON.stringify({ type: 'joined', code, roomName: room.name, history: [] })); broadcast(room, { type: 'notice', text: name + ' hat den Raum erstellt.' });
      }
    } else if (data.type === 'dmInbox' && !joined) {
      const user = getUser(data.identity);
      if (!user) return socket.send(JSON.stringify({ type: 'whisperError', message: 'Profil nicht gefunden. Bitte wähle deinen Namen erneut.' }));
      socket.inboxIdentity = user.identity;
      socket.send(JSON.stringify({ type: 'inboxReady' }));
    } else if (data.type === 'dmConnect' && !joined) {
      const user = getUser(data.identity), withIdentity = String(data.withIdentity || '');
      if (!user || !/^[a-f0-9-]{36}$/i.test(withIdentity) || !(user.contacts || []).includes(withIdentity)) return socket.send(JSON.stringify({ type: 'whisperError', message: 'Dieser Flüsterkontakt ist nicht verfügbar.' }));
      socket.directIdentity = user.identity; socket.dmWith = withIdentity;
      socket.send(JSON.stringify({ type: 'whisperHistory', withIdentity, messages: whispers.get(whisperKey(user.identity, withIdentity)) || [] }));
    } else if (data.type === 'whisperHistory' && (joined || socket.directIdentity || socket.inboxIdentity)) {
      const withIdentity = String(data.withIdentity || '');
      const requester = joined?.identity || socket.directIdentity || socket.inboxIdentity;
      if (!/^[a-f0-9-]{36}$/i.test(withIdentity) || withIdentity === requester || !(getUser(requester)?.contacts || []).includes(withIdentity) || (socket.directIdentity && socket.dmWith !== withIdentity)) return socket.send(JSON.stringify({ type: 'whisperError', message: 'Diesen privaten Chat kannst du nicht öffnen.' }));
      socket.send(JSON.stringify({ type: 'whisperHistory', withIdentity, messages: whispers.get(whisperKey(requester, withIdentity)) || [] }));
    } else if (data.type === 'whisper' && (joined || socket.directIdentity || socket.inboxIdentity)) {
      const toIdentity = String(data.toIdentity || ''), text = String(data.text || '').trim().slice(0, 1000);
      const fromIdentity = joined?.identity || socket.directIdentity || socket.inboxIdentity, fromUser = getUser(fromIdentity);
      if (!/^[a-f0-9-]{36}$/i.test(toIdentity) || toIdentity === fromIdentity || !text || !(fromUser?.contacts || []).includes(toIdentity) || (socket.directIdentity && socket.dmWith !== toIdentity)) return socket.send(JSON.stringify({ type: 'whisperError', message: 'An diese Person kannst du nicht flüstern.' }));
      const key = whisperKey(fromIdentity, toIdentity), history = whispers.get(key) || [];
      const message = { id: randomUUID(), fromIdentity, name: fromUser.name, text, time: new Date().toISOString() };
      history.push(message); if (history.length > 200) history.splice(0, history.length - 200); whispers.set(key, history); saveDatabase();
      for (const client of wss.clients) {
        if (client.readyState !== 1) continue;
        const viewer = client.joined?.identity || client.directIdentity || client.inboxIdentity;
        if (viewer === fromIdentity || viewer === toIdentity) client.send(JSON.stringify({ type: 'whisper', withIdentity: viewer === fromIdentity ? toIdentity : fromIdentity, message }));
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
