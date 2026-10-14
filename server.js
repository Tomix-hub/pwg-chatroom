const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt, randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const webpush = require('web-push');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '');
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5-mini');
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '');
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '');
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@pwg-chatroom.onrender.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const rooms = new Map();
const whispers = new Map();
const assistantUserUsage = new Map();
let assistantDailyUsage = { day: new Date().toISOString().slice(0, 10), count: 0 };
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
let database = { users: {} };
let friendRequests = [];
let roomInvites = [];
let hadStoredProfiles = false;
try {
  const previous = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  hadStoredProfiles = true;
  for (const [key, history] of Object.entries(previous.whispers || {})) {
    if (/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i.test(key) && Array.isArray(history)) whispers.set(key, history.filter(message => message && typeof message.text === 'string' && typeof message.fromIdentity === 'string').slice(-200));
  }
  for (const [identity, oldUser] of Object.entries(previous.users || {})) {
    if (!oldUser || typeof oldUser !== 'object') continue;
    if (oldUser.name) { database.users[identity] = { identity, name: oldUser.name, ...(typeof oldUser.avatar === 'string' ? { avatar: oldUser.avatar } : {}), contacts: Array.isArray(oldUser.contacts) ? oldUser.contacts.filter(contact => /^[a-f0-9-]{36}$/i.test(contact)).slice(-100) : [], friends: Array.isArray(oldUser.friends) ? oldUser.friends.filter(friend => /^[a-f0-9-]{36}$/i.test(friend)).slice(-500) : [], pushSubscriptions: Array.isArray(oldUser.pushSubscriptions) ? oldUser.pushSubscriptions.filter(isValidPushSubscription).slice(-5) : [] }; }
  }
  friendRequests = Array.isArray(previous.friendRequests) ? previous.friendRequests.filter(request => request && /^[a-f0-9-]{36}$/i.test(request.id || '') && /^[a-f0-9-]{36}$/i.test(request.from || '') && /^[a-f0-9-]{36}$/i.test(request.to || '') && request.from !== request.to && database.users[request.from] && database.users[request.to] && typeof request.time === 'string').slice(-5000) : [];
  homework = Array.isArray(previous.homework) ? previous.homework.filter(entry => entry && typeof entry.id === 'string' && homeworkFolderIds.has(entry.folder) && typeof entry.identity === 'string' && typeof entry.name === 'string' && typeof entry.time === 'string' && (typeof entry.text === 'string' || typeof entry.image === 'string') && (!entry.image || (entry.image.length <= 650_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(entry.image)))).map(entry => ({ ...entry, ...(typeof entry.expiresAt === 'string' && Number.isFinite(Date.parse(entry.expiresAt)) ? { expiresAt: entry.expiresAt } : {}) })).filter(entry => !entry.expiresAt || Date.parse(entry.expiresAt) > Date.now()).slice(-3000) : [];
} catch {}
function saveDatabase() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temp = DATA_FILE + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ ...database, whispers: Object.fromEntries(whispers), homework, friendRequests })); fs.renameSync(temp, DATA_FILE);
}
function removeExpiredHomework() {
  const current = Date.now(), remaining = homework.filter(entry => !entry.expiresAt || Date.parse(entry.expiresAt) > current);
  if (remaining.length === homework.length) return false;
  homework = remaining; saveDatabase(); return true;
}
const homeworkExpiryTimer = setInterval(removeExpiredHomework, 60_000); homeworkExpiryTimer.unref?.();
function removeOldRoomInvites() { const cutoff = Date.now() - 24 * 60 * 60 * 1000; roomInvites = roomInvites.filter(invite => Date.parse(invite.time) > cutoff && rooms.has(invite.code)); }
if (hadStoredProfiles) saveDatabase();
function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24); }
function publicUser(user) { return { name: user.name, avatar: user.avatar || null }; }
function getUser(id) { return database.users[String(id || '')]; }
function isValidPushSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048 || typeof subscription.keys?.p256dh !== 'string' || typeof subscription.keys?.auth !== 'string') return false;
  try { const host = new URL(subscription.endpoint).hostname.toLowerCase(); return subscription.endpoint.startsWith('https://') && ['.mozilla.com', '.googleapis.com', '.apple.com', '.windows.com'].some(suffix => host.endsWith(suffix)); }
  catch { return false; }
}
function sendPush(identity, title, body, tag, url = '/') {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const user = getUser(identity); if (!user?.pushSubscriptions?.length) return;
  const payload = JSON.stringify({ title, body, tag, url });
  for (const subscription of [...user.pushSubscriptions]) webpush.sendNotification(subscription, payload).catch(error => {
    if (error.statusCode === 404 || error.statusCode === 410) { user.pushSubscriptions = user.pushSubscriptions.filter(item => item.endpoint !== subscription.endpoint); saveDatabase(); }
  });
}
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
      user = { identity, name, contacts: [], friends: [] }; database.users[identity] = user; saveDatabase(); return send(res, 201, userSummary(user));
    }
    if (req.method === 'GET' && url.pathname === '/api/push/config') return send(res, 200, { enabled: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY), publicKey: VAPID_PUBLIC_KEY || '' });
    if (req.method === 'GET' && url.pathname === '/api/assistant/config') return send(res, 200, { enabled: Boolean(OPENAI_API_KEY) });
    if (!user) return send(res, 401, { error: 'Profil nicht gefunden. Bitte wähle deinen Namen erneut.' });
    if (req.method === 'POST' && url.pathname === '/api/assistant') {
      if (!OPENAI_API_KEY) return send(res, 503, { error: 'Der KI-Chat ist noch nicht eingerichtet. Der Betreiber muss den API-Schlüssel in Render hinterlegen.' });
      const messages = Array.isArray(data.messages) ? data.messages.slice(-8) : [];
      const input = messages.map(message => ({ role: message?.role === 'assistant' ? 'assistant' : 'user', content: String(message?.content || '').trim().slice(0, 1000) })).filter(message => message.content);
      if (!input.length || input.at(-1).role !== 'user') return send(res, 400, { error: 'Schreibe zuerst eine Nachricht.' });
      if (input.reduce((sum, message) => sum + message.content.length, 0) > 9000) return send(res, 413, { error: 'Der Chatverlauf ist zu lang. Starte bitte einen neuen Chat.' });
      const today = new Date().toISOString().slice(0, 10);
      if (assistantDailyUsage.day !== today) assistantDailyUsage = { day: today, count: 0 };
      const now = Date.now(), recent = (assistantUserUsage.get(user.identity) || []).filter(time => now - time < 60_000);
      if (recent.length >= 5) return send(res, 429, { error: 'Du hast gerade viele Fragen gestellt. Warte kurz und versuche es dann erneut.' });
      if (assistantDailyUsage.count >= 80) return send(res, 429, { error: 'Der KI-Chat hat sein Tageslimit erreicht. Bitte versuche es morgen erneut.' });
      recent.push(now); assistantUserUsage.set(user.identity, recent); assistantDailyUsage.count++;
      try {
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST', signal: AbortSignal.timeout(45_000),
          headers: { Authorization: 'Bearer ' + OPENAI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: OPENAI_MODEL, instructions: 'Du bist die hilfreiche KI-Hilfe im PWG Chatroom. Antworte freundlich, klar und knapp auf Deutsch. Erkläre schulische Themen verständlich. Erfinde keine Fakten und sage offen, wenn du etwas nicht weißt.', input, max_output_tokens: 500, store: false })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          console.error('OpenAI API request failed:', response.status, result.error?.code || result.error?.type || 'unknown');
          if (response.status === 429) return send(res, 429, { error: 'Der KI-Dienst ist gerade ausgelastet. Bitte versuche es später erneut.' });
          return send(res, 502, { error: 'Die KI konnte gerade nicht antworten. Prüfe den API-Schlüssel oder versuche es später erneut.' });
        }
        const answer = (result.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('').trim();
        if (!answer) return send(res, 502, { error: 'Die KI hat gerade keine Textantwort geliefert. Bitte versuche es erneut.' });
        return send(res, 200, { answer });
      } catch (error) {
        console.error('OpenAI API request failed:', error.name || 'network_error');
        return send(res, 502, { error: error.name === 'TimeoutError' ? 'Die Antwort dauert zu lange. Bitte versuche es erneut.' : 'Der KI-Dienst ist gerade nicht erreichbar.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
      if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return send(res, 503, { error: 'Push-Mitteilungen sind noch nicht auf dem Server eingerichtet.' });
      if (!isValidPushSubscription(data.subscription)) return send(res, 400, { error: 'Das Gerät konnte nicht für Mitteilungen registriert werden.' });
      user.pushSubscriptions ||= [];
      user.pushSubscriptions = user.pushSubscriptions.filter(item => item.endpoint !== data.subscription.endpoint);
      user.pushSubscriptions.push(data.subscription); if (user.pushSubscriptions.length > 5) user.pushSubscriptions.shift();
      saveDatabase(); return send(res, 201, { subscribed: true });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/push/subscribe') {
      const endpoint = String(data.endpoint || ''); user.pushSubscriptions = (user.pushSubscriptions || []).filter(item => item.endpoint !== endpoint); saveDatabase(); return send(res, 200, { unsubscribed: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/profile') return send(res, 200, userSummary(user));
    if (req.method === 'GET' && url.pathname === '/api/contacts') {
      const contacts = (user.contacts || []).map(contactId => getUser(contactId)).filter(Boolean).map(contact => ({ identity: contact.identity, ...publicUser(contact) }));
      return send(res, 200, { contacts });
    }
    if (req.method === 'GET' && url.pathname === '/api/friends') {
      const friends = (user.friends || []).map(friendId => getUser(friendId)).filter(Boolean).map(friend => ({ identity: friend.identity, ...publicUser(friend) }));
      const incoming = friendRequests.filter(request => request.to === user.identity).map(request => ({ id: request.id, time: request.time, identity: request.from, ...publicUser(getUser(request.from)) }));
      const outgoing = friendRequests.filter(request => request.from === user.identity).map(request => ({ id: request.id, time: request.time, identity: request.to, ...publicUser(getUser(request.to)) }));
      return send(res, 200, { friends, incoming, outgoing });
    }
    if (req.method === 'DELETE' && /^\/api\/friends\/[a-f0-9-]{36}$/i.test(url.pathname)) {
      const targetId = url.pathname.split('/')[3], target = getUser(targetId);
      if (!target || targetId === user.identity) return send(res, 404, { error: 'Dieses Profil wurde nicht gefunden.' });
      user.friends = (user.friends || []).filter(friendId => friendId !== targetId);
      target.friends = (target.friends || []).filter(friendId => friendId !== user.identity);
      friendRequests = friendRequests.filter(request => !((request.from === user.identity && request.to === targetId) || (request.from === targetId && request.to === user.identity)));
      roomInvites = roomInvites.filter(invite => !((invite.from === user.identity && invite.to === targetId) || (invite.from === targetId && invite.to === user.identity)));
      saveDatabase(); return send(res, 200, { removed: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/friend-requests') {
      const targetId = String(data.identity || ''), target = getUser(targetId);
      if (!target || !/^[a-f0-9-]{36}$/i.test(targetId) || targetId === user.identity) return send(res, 400, { error: 'Dieses Profil ist nicht verfügbar.' });
      if ((user.friends || []).includes(targetId)) return send(res, 409, { error: 'Ihr seid schon befreundet.' });
      const existing = friendRequests.find(request => (request.from === user.identity && request.to === targetId) || (request.from === targetId && request.to === user.identity));
      if (existing) return send(res, 409, { error: existing.to === user.identity ? 'Diese Person hat dir schon eine Anfrage geschickt. Öffne dein Profil, um sie anzunehmen.' : 'Die Freundschaftsanfrage wurde schon gesendet.' });
      const request = { id: randomUUID(), from: user.identity, to: targetId, time: new Date().toISOString() };
      friendRequests.push(request); saveDatabase(); sendPush(targetId, 'Neue Freundschaftsanfrage', user.name + ' möchte mit dir befreundet sein.', 'friend-' + request.id, '/?open=profile'); return send(res, 201, { sent: true });
    }
    if (req.method === 'POST' && /^\/api\/friend-requests\/[a-f0-9-]{36}\/accept$/i.test(url.pathname)) {
      const requestId = url.pathname.split('/')[3], requestIndex = friendRequests.findIndex(request => request.id === requestId && request.to === user.identity);
      if (requestIndex < 0) return send(res, 404, { error: 'Diese Anfrage ist nicht mehr verfügbar.' });
      const request = friendRequests[requestIndex], sender = getUser(request.from);
      user.friends ||= []; sender.friends ||= [];
      if (!user.friends.includes(sender.identity)) user.friends.push(sender.identity);
      if (!sender.friends.includes(user.identity)) sender.friends.push(user.identity);
      friendRequests = friendRequests.filter(item => !((item.from === request.from && item.to === request.to) || (item.from === request.to && item.to === request.from)));
      saveDatabase(); return send(res, 200, { accepted: true });
    }
    if (req.method === 'DELETE' && /^\/api\/friend-requests\/[a-f0-9-]{36}$/i.test(url.pathname)) {
      const requestId = url.pathname.split('/')[3], requestIndex = friendRequests.findIndex(request => request.id === requestId && request.to === user.identity);
      if (requestIndex < 0) return send(res, 404, { error: 'Diese Anfrage ist nicht mehr verfügbar.' });
      friendRequests.splice(requestIndex, 1); saveDatabase(); return send(res, 200, { declined: true });
    }
    if (url.pathname === '/api/room-invites' && req.method === 'GET') {
      removeOldRoomInvites();
      const invites = roomInvites.filter(invite => invite.to === user.identity).map(invite => ({ id: invite.id, roomCode: invite.code, roomName: invite.roomName, time: invite.time, fromName: getUser(invite.from)?.name || 'Ein Freund' }));
      return send(res, 200, { invites });
    }
    if (url.pathname === '/api/room-invites' && req.method === 'POST') {
      removeOldRoomInvites();
      const targetId = String(data.identity || ''), code = String(data.roomCode || '').replace(/[^0-9]/g, '').slice(0, 6), room = rooms.get(code);
      if (!getUser(targetId) || !/^[a-f0-9-]{36}$/i.test(targetId) || targetId === user.identity) return send(res, 400, { error: 'Dieses Profil ist nicht verfügbar.' });
      if (!room || !/^[0-9]{6}$/.test(code)) return send(res, 400, { error: 'Dieser Raum ist nicht mehr verfügbar.' });
      if (!(user.friends || []).includes(targetId)) return send(res, 403, { error: 'Du kannst nur angenommene Freunde einladen.' });
      if (!Array.from(room.clients).some(client => client.joined?.identity === user.identity)) return send(res, 403, { error: 'Du musst selbst im Raum sein, um Freunde einzuladen.' });
      if (roomInvites.some(invite => invite.to === targetId && invite.code === code)) return send(res, 409, { error: 'Diese Person wurde schon in den Raum eingeladen.' });
      const invite = { id: randomUUID(), from: user.identity, to: targetId, code, roomName: room.name, time: new Date().toISOString() };
      roomInvites.push(invite); sendPush(targetId, 'Einladung in einen Chatraum', user.name + ' lädt dich in „' + room.name + '“ ein.', 'room-' + invite.id, '/?invite=' + invite.id); return send(res, 201, { sent: true });
    }
    if (req.method === 'POST' && /^\/api\/room-invites\/[a-f0-9-]{36}\/accept$/i.test(url.pathname)) {
      removeOldRoomInvites();
      const inviteId = url.pathname.split('/')[3], inviteIndex = roomInvites.findIndex(invite => invite.id === inviteId && invite.to === user.identity);
      if (inviteIndex < 0) return send(res, 404, { error: 'Diese Raumeinladung ist nicht mehr verfügbar.' });
      const invite = roomInvites[inviteIndex]; if (!rooms.has(invite.code)) { roomInvites.splice(inviteIndex, 1); return send(res, 410, { error: 'Der Raum ist nicht mehr verfügbar.' }); }
      roomInvites.splice(inviteIndex, 1); return send(res, 200, { roomCode: invite.code });
    }
    if (req.method === 'DELETE' && /^\/api\/room-invites\/[a-f0-9-]{36}$/i.test(url.pathname)) {
      const inviteId = url.pathname.split('/')[3], inviteIndex = roomInvites.findIndex(invite => invite.id === inviteId && invite.to === user.identity);
      if (inviteIndex < 0) return send(res, 404, { error: 'Diese Raumeinladung ist nicht mehr verfügbar.' });
      roomInvites.splice(inviteIndex, 1); return send(res, 200, { declined: true });
    }
    if (url.pathname === '/api/homework') {
      if (req.method === 'GET') {
        const folder = String(url.searchParams.get('folder') || '');
        if (!homeworkFolderIds.has(folder)) return send(res, 400, { error: 'Dieses Fach gibt es nicht.' });
        removeExpiredHomework();
        const after = String(url.searchParams.get('after') || '');
        const folderEntries = homework.filter(entry => entry.folder === folder);
        return send(res, 200, { activeIds: folderEntries.map(entry => entry.id), entries: folderEntries.filter(entry => !after || entry.time > after).map(({ identity, ...entry }) => ({ ...entry, isMine: identity === user.identity })) });
      }
      if (req.method === 'POST') {
        const folder = String(data.folder || ''), text = String(data.text || '').trim().slice(0, 2000), image = String(data.image || '');
        if (!homeworkFolderIds.has(folder)) return send(res, 400, { error: 'Dieses Fach gibt es nicht.' });
        if (text.length < 1 && !image) return send(res, 400, { error: 'Schreib eine Nachricht oder wähle ein Bild aus.' });
        if (image && (image.length > 650_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) return send(res, 400, { error: 'Das Bild ist ungültig oder zu groß. Bitte wähle ein anderes Bild.' });
        if (homework.filter(entry => entry.folder === folder).length >= 300) return send(res, 413, { error: 'In diesem Fach sind schon sehr viele Beiträge gespeichert.' });
        const storedImageChars = homework.reduce((total, entry) => total + (entry.image?.length || 0), 0);
        if (image && storedImageChars + image.length > 25_000_000) return send(res, 413, { error: 'Der gemeinsame Bildspeicher ist voll. Bitte speichere ältere Bilder auf deinem Gerät.' });
        const expiresAtInput = String(data.expiresAt || ''), expiresAtTime = expiresAtInput ? Date.parse(expiresAtInput) : NaN;
        if (expiresAtInput && (!Number.isFinite(expiresAtTime) || expiresAtTime <= Date.now())) return send(res, 400, { error: 'Das Löschdatum muss in der Zukunft liegen.' });
        const entry = { id: randomUUID(), folder, identity: user.identity, name: user.name, text, ...(image ? { image } : {}), ...(expiresAtInput ? { expiresAt: new Date(expiresAtTime).toISOString() } : {}), time: new Date().toISOString() };
        homework.push(entry); if (homework.length > 3000) homework.splice(0, homework.length - 3000);
        saveDatabase();
        const subject = homeworkFolders.find(([folderId]) => folderId === folder)?.[1] || 'Hausaufgaben';
        for (const recipientId of Object.keys(database.users)) if (recipientId !== user.identity) sendPush(recipientId, 'Neue Hausaufgabe: ' + subject, user.name + ' hat etwas im Fach ' + subject + ' geteilt.', 'homework-' + entry.id, '/?open=homework&folder=' + encodeURIComponent(folder));
        const { identity, ...publicEntry } = entry; return send(res, 201, { entry: { ...publicEntry, isMine: true } });
      }
    }
    if (req.method === 'DELETE' && /^\/api\/homework\/[a-f0-9-]{36}$/i.test(url.pathname)) {
      const entryId = url.pathname.slice('/api/homework/'.length), index = homework.findIndex(entry => entry.id === entryId);
      if (index < 0) return send(res, 404, { error: 'Dieser Beitrag wurde schon gelöscht.' });
      if (homework[index].identity !== user.identity) return send(res, 403, { error: 'Du kannst nur deine eigenen Beiträge löschen.' });
      homework.splice(index, 1); saveDatabase(); return send(res, 200, { deleted: true, id: entryId });
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
      if (name !== user.name) {
        user.name = name;
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
  socket.videoPeerId = randomUUID();
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
        const room = rooms.get(code); rememberRoomParticipants(room, user.identity);
        const peers = [...room.clients].filter(client => client.joined).map(client => ({ peerId: client.videoPeerId, identity: client.joined.identity, name: client.joined.name, videoActive: Boolean(client.videoActive) }));
        room.clients.add(socket);
        socket.send(JSON.stringify({ type: 'joined', code, roomName: room.name, history: room.history, videoPeerId: socket.videoPeerId, videoPeers: peers }));
        for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify({ type: 'roomPeerJoined', peerId: socket.videoPeerId, identity: joined.identity, name: joined.name, videoActive: false }));
        broadcast(room, { type: 'notice', text: name + ' ist dem Raum beigetreten.' });
      } else {
        const roomName = String(data.roomName || '').trim().slice(0, 32);
        if (!roomName) return socket.send(JSON.stringify({ type: 'error', message: 'Bitte gib einen Raumnamen ein.' }));
        let code; do { code = randomInt(0, 1_000_000).toString().padStart(6, '0'); } while (rooms.has(code));
        rooms.set(code, { name: roomName, owner: user.identity, clients: new Set(), participants: new Set([user.identity]), history: [], historyBytes: 0, readers: new Map(), typing: new Map(), drawBoards: new Map() });
        joined = { code, identity: user.identity, name, avatar: user.avatar || null }; socket.joined = joined; const room = rooms.get(code);
        const peers = [...room.clients].filter(client => client.joined).map(client => ({ peerId: client.videoPeerId, identity: client.joined.identity, name: client.joined.name, videoActive: Boolean(client.videoActive) }));
        room.clients.add(socket);
        socket.send(JSON.stringify({ type: 'joined', code, roomName: room.name, history: [], videoPeerId: socket.videoPeerId, videoPeers: peers }));
        for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify({ type: 'roomPeerJoined', peerId: socket.videoPeerId, identity: joined.identity, name: joined.name, videoActive: false }));
        broadcast(room, { type: 'notice', text: name + ' hat den Raum erstellt.' });
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
    } else if (data.type === 'drawOpen' && joined) {
      const room = rooms.get(joined.code), targetIdentity = String(data.targetIdentity || '');
      if (!room || !/^[a-f0-9-]{36}$/i.test(targetIdentity) || targetIdentity === joined.identity) return;
      const target = [...room.clients].find(client => client.joined?.identity === targetIdentity && client.readyState === 1);
      if (!target) return socket.send(JSON.stringify({ type: 'drawError', message: 'Diese Person ist gerade nicht mehr im Raum.' }));
      room.drawBoards ||= new Map();
      while (room.drawBoards.size >= 30) room.drawBoards.delete(room.drawBoards.keys().next().value);
      const boardId = randomUUID(), board = { id: boardId, identities: new Set([joined.identity, targetIdentity]), strokes: [] };
      room.drawBoards.set(boardId, board);
      for (const client of room.clients) {
        if (client.readyState !== 1 || !board.identities.has(client.joined?.identity)) continue;
        const partner = getUser(client.joined.identity === joined.identity ? targetIdentity : joined.identity);
        client.send(JSON.stringify({ type: 'drawOpen', boardId, withIdentity: partner?.identity, withName: partner?.name || 'Mitglied' }));
      }
    } else if ((data.type === 'drawStroke' || data.type === 'drawClear') && joined) {
      const room = rooms.get(joined.code), boardId = String(data.boardId || ''), board = room?.drawBoards?.get(boardId);
      if (!board || !board.identities.has(joined.identity)) return;
      if (data.type === 'drawClear') {
        board.strokes.length = 0;
        for (const client of room.clients) if (client.readyState === 1 && board.identities.has(client.joined?.identity)) client.send(JSON.stringify({ type: 'drawClear', boardId }));
      } else {
        const stroke = data.stroke, color = String(stroke?.color || ''), size = Number(stroke?.size), tool = String(stroke?.tool || 'pencil'), points = stroke?.points;
        if (!/^#[0-9a-f]{6}$/i.test(color) || !Number.isFinite(size) || size < 1 || size > 32 || !['pencil', 'marker', 'highlighter', 'eraser'].includes(tool) || !Array.isArray(points) || points.length < 1 || points.length > 20) return;
        const safePoints = [];
        for (const point of points) {
          const x = Number(point?.x), y = Number(point?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          safePoints.push({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
        }
        const safeStroke = { color, size, tool, points: safePoints, fromIdentity: joined.identity };
        board.strokes.push(safeStroke); if (board.strokes.length > 5000) board.strokes.shift();
        for (const client of room.clients) if (client.readyState === 1 && board.identities.has(client.joined?.identity)) client.send(JSON.stringify({ type: 'drawStroke', boardId, stroke: safeStroke }));
      }
    } else if (data.type === 'videoState' && joined) {
      const room = rooms.get(joined.code); if (!room) return;
      const active = Boolean(data.active); if (active === Boolean(socket.videoActive)) return;
      socket.videoActive = active;
      for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify({ type: active ? 'videoPeerUp' : 'videoPeerDown', peerId: socket.videoPeerId, identity: joined.identity, name: joined.name }));
    } else if (data.type === 'videoSignal' && joined) {
      const room = rooms.get(joined.code), targetPeerId = String(data.toPeerId || ''), signal = data.signal;
      if (!room || !/^[a-f0-9-]{36}$/i.test(targetPeerId) || !signal || !['description', 'candidate'].includes(signal.kind)) return;
      let signalSize; try { signalSize = JSON.stringify(signal).length; } catch { return; }
      if (signalSize > 50_000) return;
      const target = [...room.clients].find(client => client.videoPeerId === targetPeerId && client.joined && client !== socket);
      if (target?.readyState === 1) target.send(JSON.stringify({ type: 'videoSignal', fromPeerId: socket.videoPeerId, identity: joined.identity, name: joined.name, signal }));
    } else if (data.type === 'message' && joined) {
      const text = String(data.text || '').trim().slice(0, 1000); if (!text) return;
      const room = rooms.get(joined.code); if (!room) return;
      const original = room.history.find(item => item.id === String(data.replyTo || ''));
      const replyTo = original ? { id: original.id, name: original.name, text: original.type === 'image' ? '📷 Bild' : String(original.text || '').slice(0, 180) } : null;
      const message = { type: 'message', id: randomUUID(), identity: joined.identity, name: joined.name, avatar: joined.avatar, text, ...(replyTo ? { replyTo } : {}), time: new Date().toISOString() };
      room.history.push(message); room.historyBytes += JSON.stringify(message).length;
      while (room.history.length > 100 || room.historyBytes > 2 * 1024 * 1024) { const removed = room.history.shift(); room.historyBytes -= JSON.stringify(removed).length; }
      broadcast(room, message);
      for (const participantId of room.participants || []) {
        if (participantId === joined.identity) continue;
        const alreadyInRoom = Array.from(room.clients).some(client => client.joined?.identity === participantId);
        if (!alreadyInRoom) sendPush(participantId, 'Neue Nachricht in ' + room.name, joined.name + ': ' + text.slice(0, 140), 'message-' + joined.code, '/?room=' + joined.code);
      }
    } else if (data.type === 'image' && joined) {
      const room = rooms.get(joined.code); if (!room) return;
      const image = String(data.image || '');
      if (image.length > 650000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return socket.send(JSON.stringify({ type: 'imageError', message: 'Das Bild ist ungültig oder zu groß.' }));
      const original = room.history.find(item => item.id === String(data.replyTo || ''));
      const replyTo = original ? { id: original.id, name: original.name, text: original.type === 'image' ? '📷 Bild' : String(original.text || '').slice(0, 180) } : null;
      const message = { type: 'image', id: randomUUID(), identity: joined.identity, name: joined.name, avatar: joined.avatar, image, ...(replyTo ? { replyTo } : {}), time: new Date().toISOString() }; addToHistory(room, message); broadcast(room, message);
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
  socket.on('close', () => { if (joined) { const room = rooms.get(joined.code); if (room) { if (socket.videoActive) for (const client of room.clients) if (client !== socket && client.readyState === 1) client.send(JSON.stringify({ type: 'videoPeerDown', peerId: socket.videoPeerId, identity: joined.identity, name: joined.name })); room.clients.delete(socket); room.typing.delete(joined.identity); for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify({ type: 'roomPeerLeft', peerId: socket.videoPeerId })); broadcast(room, { type: 'typing', users: [...room.typing.values()] }); broadcast(room, { type: 'notice', text: joined.name + ' hat den Raum verlassen.' }); } } });
});
server.listen(PORT, '0.0.0.0', () => console.log('PWG Chatroom läuft auf Port ' + PORT));
