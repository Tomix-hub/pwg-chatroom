const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const name = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(__dirname, name);
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
function broadcast(room, payload) { for (const client of room.clients) if (client.readyState === 1) client.send(JSON.stringify(payload)); }
wss.on('connection', (socket) => {
  let joined = null;
  socket.on('message', (raw) => {
    let data; try { data = JSON.parse(raw.toString()); } catch { return; }
    if (data.type === 'join') {
      const code = String(data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const name = String(data.name || '').trim().slice(0, 24);
      if (!/^[A-Z0-9]{6}$/.test(code) || !name) return socket.send(JSON.stringify({ type: 'error', message: 'Bitte gib einen gültigen Raumcode und Namen ein.' }));
      if (!rooms.has(code)) return socket.send(JSON.stringify({ type: 'error', message: 'Diesen Raum gibt es nicht. Prüfe den Code.' }));
      joined = { code, name };
      const room = rooms.get(code); room.clients.add(socket);
      socket.send(JSON.stringify({ type: 'joined', code, history: room.history }));
      broadcast(room, { type: 'notice', text: `${name} ist dem Raum beigetreten.` });
    } else if (data.type === 'create') {
      const name = String(data.name || '').trim().slice(0, 24);
      if (!name) return socket.send(JSON.stringify({ type: 'error', message: 'Bitte gib zuerst deinen Namen ein.' }));
      let code; do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(code));
      rooms.set(code, { clients: new Set(), history: [] });
      joined = { code, name }; const room = rooms.get(code); room.clients.add(socket);
      socket.send(JSON.stringify({ type: 'joined', code, history: [] }));
      broadcast(room, { type: 'notice', text: `${name} hat den Raum erstellt.` });
    } else if (data.type === 'message' && joined) {
      const text = String(data.text || '').trim().slice(0, 1000); if (!text) return;
      const room = rooms.get(joined.code); if (!room) return;
      const message = { type: 'message', name: joined.name, text, time: new Date().toISOString() };
      room.history.push(message); if (room.history.length > 100) room.history.shift(); broadcast(room, message);
    }
  });
  socket.on('close', () => { if (joined) { const room = rooms.get(joined.code); if (room) { room.clients.delete(socket); broadcast(room, { type: 'notice', text: `${joined.name} hat den Raum verlassen.` }); } } });
});
server.listen(PORT, '0.0.0.0', () => console.log(`PWG Chatroom läuft auf Port ${PORT}`));
