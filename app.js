const $ = (id) => document.getElementById(id);
const home = $('home'), chat = $('chat'), chatWorkspace = $('chatWorkspace'), nameInput = $('name'), roomNameInput = $('roomNameInput'), codeInput = $('code'), error = $('error');let socket, whisperSocket, myName = '', roomCode = '', myProfile = null, typingActive = false, typingTimer, activeWhisper = null, pendingReply = null, selfVideoPeerId = '', localCameraStream = null, localCameraTile = null;const videoPeers = new Map();
const homeworkCatalog = [
  ['englisch-sude', 'Englisch', 'Frau Sude'], ['mathe-funk', 'Mathe', 'Frau Funk'], ['kunst-wenzler', 'Kunst', 'Frau Wenzler'], ['sport-debus', 'Sport', 'Herr Debus'],
  ['englisch-adler', 'Englisch', 'Frau Adler'], ['mathe-schindler', 'Mathe', 'Herr Schindler'], ['kunst-sapcanovic', 'Kunst', 'Frau Sapcanovic'], ['sport-halve', 'Sport', 'Herr Halve'],
  ['sowi-debus', 'SoWi', 'Herr Debus'], ['vertiefung-deutsch-graw', 'Vertiefung Deutsch', 'Frau Graw'], ['vertiefung-mathe-stenner', 'Vertiefung Mathe', 'Herr Stenner'],
  ['vertiefung-englisch-koerner', 'Vertiefung Englisch', 'Frau Körner'], ['vertiefung-mathe-tasdemir', 'Vertiefung Mathe', 'Frau Tasdemir'],
  ['biologie-halve', 'Biologie', 'Herr Halve'], ['biologie-neutsch', 'Biologie', 'Frau Neutsch'], ['paedagogik-tasdemir', 'Pädagogik', 'Frau Tasdemir'],
  ['deutsch-pfeiffer', 'Deutsch', 'Frau Pfeiffer'], ['chemie-ernst', 'Chemie', 'Frau Ernst'], ['spanisch-ewering', 'Spanisch', 'Herr Ewering'], ['spanisch-jackenkroll', 'Spanisch', 'Frau Jackenkroll'],
  ['geschichte-erben', 'Geschichte', 'Herr Erben'], ['geschichte-kues', 'Geschichte', 'Frau Kues'], ['franzoesisch-kues', 'Französisch', 'Frau Kues'],
  ['chemie-misselwitz', 'Chemie', 'Herr Misselwitz'], ['philosophie-wenzler', 'Philosophie', 'Frau Wenzler'], ['sowi-hillebrand', 'SoWi', 'Herr Hillebrand']
].map(([id, subject, teacher]) => ({ id, subject, teacher }));
let activeHomeworkFolder = null, homeworkReturnTo = 'home', homeworkRefreshTimer = null, homeworkLatestTime = '', homeworkImageData = '', friendRefreshTimer = null, activeOtherProfile = null, activeDrawing = null;
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
const notificationInviteId = (new URLSearchParams(location.search).get('invite') || '').toLowerCase();
nameInput.readOnly = true; nameInput.placeholder = 'Wird mit deinem Profil gespeichert';
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-PWG-Identity': identity, ...(options.headers || {}) } });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Die Anfrage ist fehlgeschlagen.'); return result;
}
function decodePushKey(value) { const padded = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(padded), char => char.charCodeAt(0)); }
async function updateNotificationControls() {
  const button = $('notificationsButton'), status = $('notificationStatus');
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { status.textContent = 'Dieser Browser unterstützt keine Push-Mitteilungen. Auf dem iPad PWG Chatroom zum Home-Bildschirm hinzufügen.'; button.disabled = true; return; }
  try {
    const config = await api('/api/push/config');
    if (!config.enabled) { status.textContent = 'Push-Mitteilungen werden gerade für den Server eingerichtet.'; button.disabled = true; return; }
    const registration = await navigator.serviceWorker.ready, subscription = await registration.pushManager.getSubscription();
    if (Notification.permission === 'denied') { status.textContent = 'Mitteilungen sind in den Browser-Einstellungen blockiert.'; button.textContent = 'Browser-Einstellungen öffnen'; button.disabled = true; }
    else if (subscription) { status.textContent = 'Mitteilungen sind auf diesem Gerät eingeschaltet.'; button.textContent = 'Mitteilungen ausschalten'; button.disabled = false; }
    else { status.textContent = 'Du wirst über Nachrichten, Freundschaftsanfragen, Raumeinladungen und neue Hausaufgaben informiert.'; button.textContent = 'Benachrichtigungen einschalten'; button.disabled = false; }
  } catch { status.textContent = 'Mitteilungseinstellungen konnten nicht geladen werden.'; button.disabled = true; }
}
async function toggleNotifications() {
  const button = $('notificationsButton'), status = $('notificationStatus'); button.disabled = true;
  try {
    const config = await api('/api/push/config'); if (!config.enabled) throw new Error('Push-Mitteilungen sind noch nicht auf dem Server eingerichtet.');
    const registration = await navigator.serviceWorker.ready; let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe(); status.textContent = 'Mitteilungen wurden ausgeschaltet.';
    } else {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') throw new Error('Bitte erlaube Mitteilungen in den Browser-Einstellungen.');
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushKey(config.publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
      status.textContent = 'Mitteilungen sind auf diesem Gerät eingeschaltet.';
    }
  } catch (err) { status.textContent = err.message || 'Mitteilungen konnten nicht geändert werden.'; }
  await updateNotificationControls();
}
async function enableNotifications() {
  const permissionPromise = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  const [config, permission] = await Promise.all([api('/api/push/config'), permissionPromise]);
  if (!config.enabled) throw new Error('Push-Mitteilungen sind noch nicht auf dem Server eingerichtet.');
  const registration = await navigator.serviceWorker.ready; let subscription = await registration.pushManager.getSubscription();
  if (permission !== 'granted') throw new Error('Mitteilungen wurden im Browser nicht erlaubt. Du kannst sie später im Profil aktivieren.');
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushKey(config.publicKey) });
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
}
async function askForNotificationsOnce() {
  if (!myProfile || localStorage.getItem('pwgNotificationChoice')) return;
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const config = await api('/api/push/config');
    if (!config.enabled) return;
    const registration = await navigator.serviceWorker.ready;
    if (await registration.pushManager.getSubscription()) { localStorage.setItem('pwgNotificationChoice', 'yes'); return; }
    $('notificationPrompt').classList.remove('hidden');
  } catch {}
}
$('notificationPromptNo').addEventListener('click', () => {
  localStorage.setItem('pwgNotificationChoice', 'no'); $('notificationPrompt').classList.add('hidden');
});
$('notificationPromptYes').addEventListener('click', async () => {
  const button = $('notificationPromptYes'), status = $('notificationPromptStatus'); button.disabled = true; status.textContent = 'Mitteilungen werden eingerichtet …';
  try {
    await enableNotifications(); localStorage.setItem('pwgNotificationChoice', 'yes');
    $('notificationPrompt').classList.add('hidden'); await updateNotificationControls();
  } catch (err) {
    status.textContent = err.message || 'Mitteilungen konnten nicht eingerichtet werden.';
    if (window.Notification?.permission === 'denied') { localStorage.setItem('pwgNotificationChoice', 'no'); $('notificationPrompt').classList.add('hidden'); }
  } finally { button.disabled = false; }
});
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
function renderFriendRows(listId, entries, emptyText, actions = false, removable = false) {
  const list = $(listId); list.replaceChildren();
  if (!entries.length) { const empty = document.createElement('p'); empty.className = 'social-empty'; empty.textContent = emptyText; list.append(empty); return; }
  entries.forEach(entry => {
    const row = document.createElement('div'); row.className = 'social-row';
    const name = document.createElement('strong'); name.textContent = entry.name; row.append(name);
    if (actions || removable) {
      const buttons = document.createElement('div'); buttons.className = 'social-actions';
      if (actions) {
        const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'social-action'; accept.textContent = 'Annehmen';
        accept.addEventListener('click', async () => { accept.disabled = true; try { await api('/api/friend-requests/' + encodeURIComponent(entry.id) + '/accept', { method: 'POST', body: JSON.stringify({}) }); $('friendStatus').textContent = 'Freundschaftsanfrage angenommen.'; await refreshFriendData(); } catch (err) { $('friendStatus').textContent = err.message; accept.disabled = false; } });
        const decline = document.createElement('button'); decline.type = 'button'; decline.className = 'social-action'; decline.textContent = 'Ablehnen';
        decline.addEventListener('click', async () => { decline.disabled = true; try { await api('/api/friend-requests/' + encodeURIComponent(entry.id), { method: 'DELETE' }); $('friendStatus').textContent = 'Anfrage abgelehnt.'; await refreshFriendData(); } catch (err) { $('friendStatus').textContent = err.message; decline.disabled = false; } });
        buttons.append(accept, decline);
      }
      if (removable) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'social-action'; remove.textContent = 'Entfernen';
        remove.addEventListener('click', async () => { remove.disabled = true; try { await api('/api/friends/' + encodeURIComponent(entry.identity), { method: 'DELETE', body: JSON.stringify({}) }); $('friendStatus').textContent = entry.name + ' wurde aus deiner Freundesliste entfernt.'; await refreshFriendData(); } catch (err) { $('friendStatus').textContent = err.message; remove.disabled = false; } });
        buttons.append(remove);
      }
      row.append(buttons);
    }
    list.append(row);
  });
}
async function refreshFriendData() {
  if (!myProfile) return;
  try {
    const [data, roomData] = await Promise.all([api('/api/friends'), api('/api/room-invites')]);
    const badge = $('friendRequestBadge'), notificationCount = data.incoming.length + roomData.invites.length; badge.textContent = notificationCount; badge.classList.toggle('hidden', notificationCount === 0);
    if (!$('profileOverlay').classList.contains('hidden')) {
      renderFriendRows('incomingFriendRequests', data.incoming, 'Keine neuen Anfragen.', true);
      renderFriendRows('outgoingFriendRequests', data.outgoing, 'Keine ausstehenden Anfragen.');
      renderFriendRows('friendsList', data.friends, 'Noch keine Freunde hinzugefügt.', false, true);
      renderRoomInvitations(roomData.invites);
    }
  } catch {}
}
function renderRoomInvitations(entries) {
  const list = $('roomInvitations'); list.replaceChildren();
  if (!entries.length) { const empty = document.createElement('p'); empty.className = 'social-empty'; empty.textContent = 'Keine neuen Raumeinladungen.'; list.append(empty); return; }
  entries.forEach(entry => {
    const row = document.createElement('div'); row.className = 'social-row';
    const label = document.createElement('strong'); label.textContent = (entry.roomName || 'Chatraum') + ' · ' + entry.fromName; row.append(label);
    const actions = document.createElement('div'); actions.className = 'social-actions';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'social-action'; accept.textContent = 'Beitreten';
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      try { const result = await api('/api/room-invites/' + encodeURIComponent(entry.id) + '/accept', { method: 'POST', body: JSON.stringify({}) }); $('profileOverlay').classList.add('hidden'); joinInvitedRoom(result.roomCode); }
      catch (err) { $('friendStatus').textContent = err.message; accept.disabled = false; await refreshFriendData(); }
    });
    const decline = document.createElement('button'); decline.type = 'button'; decline.className = 'social-action'; decline.textContent = 'Ablehnen';
    decline.addEventListener('click', async () => { decline.disabled = true; try { await api('/api/room-invites/' + encodeURIComponent(entry.id), { method: 'DELETE' }); await refreshFriendData(); } catch (err) { $('friendStatus').textContent = err.message; decline.disabled = false; } });
    actions.append(accept, decline); row.append(actions); list.append(row);
  });
}
function joinInvitedRoom(code) {
  if (roomCode) leaveRoom();
  codeInput.value = code; error.textContent = ''; connect('join');
}
async function joinRoomFromNotification() {
  if (!/^[a-f0-9-]{36}$/.test(notificationInviteId)) return false;
  try {
    const result = await api('/api/room-invites/' + encodeURIComponent(notificationInviteId) + '/accept', { method: 'POST', body: JSON.stringify({}) });
    history.replaceState(null, '', location.pathname); joinInvitedRoom(result.roomCode);
  } catch (err) { error.textContent = err.message || 'Diese Raumeinladung ist nicht mehr verfügbar.'; }
  return true;
}
async function openRoomInviteDialog() {
  if (!roomCode || socket?.readyState !== WebSocket.OPEN) { renderNotice('Warte kurz, bis du mit dem Raum verbunden bist.'); return; }
  $('roomInviteName').textContent = $('roomTitle').textContent; $('roomInviteStatus').textContent = 'Freunde können die Einladung in ihrem Profil annehmen.';
  $('roomInviteOverlay').classList.remove('hidden');
  const list = $('roomInviteFriends'); list.replaceChildren();
  try {
    const data = await api('/api/friends');
    if (!data.friends.length) { const empty = document.createElement('p'); empty.className = 'social-empty'; empty.textContent = 'Du hast noch keine angenommenen Freunde.'; list.append(empty); return; }
    data.friends.forEach(friend => {
      const row = document.createElement('div'); row.className = 'social-row';
      const name = document.createElement('strong'); name.textContent = friend.name;
      const invite = document.createElement('button'); invite.type = 'button'; invite.className = 'social-action'; invite.textContent = 'Einladen';
      invite.addEventListener('click', async () => {
        invite.disabled = true; $('roomInviteStatus').textContent = 'Einladung wird gesendet …';
        try { await api('/api/room-invites', { method: 'POST', body: JSON.stringify({ identity: friend.identity, roomCode, roomName: $('roomTitle').textContent }) }); invite.textContent = 'Eingeladen ✓'; $('roomInviteStatus').textContent = friend.name + ' wurde in den Raum eingeladen.'; }
        catch (err) { $('roomInviteStatus').textContent = err.message; invite.disabled = false; }
      });
      row.append(name, invite); list.append(row);
    });
  } catch (err) { $('roomInviteStatus').textContent = err.message; }
}
function showHomeworkFolders() {
  $('homeworkFolderView').classList.add('hidden'); $('homeworkFolders').classList.remove('hidden');
  if (homeworkRefreshTimer) clearInterval(homeworkRefreshTimer); homeworkRefreshTimer = null; activeHomeworkFolder = null;
}
function renderHomeworkFolders() {
  const list = $('homeworkFolders'); list.replaceChildren();
  homeworkCatalog.forEach(folder => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'homework-folder';
    const icon = document.createElement('span'); icon.className = 'room-icon'; icon.textContent = '▤';
    const copy = document.createElement('span'); copy.className = 'homework-folder-copy';
    const subject = document.createElement('strong'); subject.textContent = folder.subject;
    const teacher = document.createElement('small'); teacher.textContent = 'bei ' + folder.teacher;
    copy.append(subject, teacher); button.append(icon, copy); button.addEventListener('click', () => openHomeworkFolder(folder)); list.append(button);
  });
}
function renderHomeworkEntry(entry, folder) {
  const item = document.createElement('article'); item.className = 'homework-entry'; item.dataset.homeworkId = entry.id;
  const head = document.createElement('div'); head.className = 'homework-entry-head';
  const author = document.createElement('strong'); author.textContent = entry.name;
  const time = document.createElement('time'); const date = new Date(entry.time); time.dateTime = entry.time; time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  head.append(author, time); item.append(head);
  if (entry.expiresAt) { const expiry = document.createElement('small'); expiry.className = 'homework-expiry'; expiry.textContent = 'Wird gelöscht am ' + new Date(entry.expiresAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }); item.append(expiry); }
  if (entry.text) { const text = document.createElement('p'); text.className = 'homework-entry-text'; text.textContent = entry.text; item.append(text); }
  if (entry.image) {
    const image = document.createElement('img'); image.className = 'homework-entry-image'; image.src = entry.image; image.alt = 'Geteiltes Bild von ' + entry.name; image.loading = 'lazy'; item.append(image);
    const save = document.createElement('button'); save.type = 'button'; save.className = 'homework-save-image'; save.textContent = '↓ In Galerie speichern';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const blob = await (await fetch(entry.image)).blob(); const file = new File([blob], 'PWG-' + folder.subject.replace(/[^\p{L}\p{N}-]/gu, '-') + '.jpg', { type: 'image/jpeg' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Bild für ' + folder.subject, text: 'Bild aus PWG Chatroom' });
        else { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); $('homeworkStatus').textContent = 'Bild heruntergeladen. Öffne es und wähle „Bild sichern“, um es in Fotos abzulegen.'; }
      } catch (err) { if (err.name !== 'AbortError') $('homeworkStatus').textContent = 'Das Bild konnte nicht gespeichert werden.'; }
      finally { save.disabled = false; }
    }); item.append(save);
  }
  if (entry.isMine) {
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'homework-delete'; remove.textContent = 'Beitrag löschen';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Diesen eigenen Beitrag wirklich löschen?')) return;
      remove.disabled = true;
      try { await api('/api/homework/' + encodeURIComponent(entry.id), { method: 'DELETE' }); item.remove(); showEmptyHomeworkFolder(); $('homeworkStatus').textContent = 'Beitrag gelöscht.'; }
      catch (err) { remove.disabled = false; $('homeworkStatus').textContent = err.message || 'Der Beitrag konnte nicht gelöscht werden.'; }
    }); item.append(remove);
  }
  $('homeworkEntries').append(item);
}
function showEmptyHomeworkFolder() {
  const list = $('homeworkEntries');
  if (list.querySelector('.homework-entry') || list.querySelector('.homework-empty')) return;
  const empty = document.createElement('p'); empty.className = 'homework-empty'; empty.textContent = 'Hier gibt es noch keine Beiträge. Teile den ersten!'; list.append(empty);
}
async function loadHomeworkEntries(folder, append = false) {
  const list = $('homeworkEntries');
  if (!append) { list.replaceChildren(); homeworkLatestTime = ''; }
  try {
    const query = new URLSearchParams({ folder: folder.id }); if (append && homeworkLatestTime) query.set('after', homeworkLatestTime);
    const data = await api('/api/homework?' + query.toString());
    if (append) list.querySelectorAll('.homework-entry').forEach(item => { if (!data.activeIds.includes(item.dataset.homeworkId)) item.remove(); });
    data.entries.forEach(entry => { list.querySelector('.homework-empty')?.remove(); renderHomeworkEntry(entry, folder); if (entry.time > homeworkLatestTime) homeworkLatestTime = entry.time; });
    if (!data.entries.length) showEmptyHomeworkFolder();
  } catch (err) { if (!append) { const message = document.createElement('p'); message.className = 'homework-empty'; message.textContent = err.message || 'Die Beiträge konnten nicht geladen werden.'; list.replaceChildren(message); } }
}
function openHomeworkFolder(folder) {
  activeHomeworkFolder = folder; homeworkLatestTime = ''; $('homeworkFolders').classList.add('hidden'); $('homeworkFolderView').classList.remove('hidden');
  const expiry = new Date(Date.now() + 60_000); expiry.setSeconds(0, 0); $('homeworkExpiresAt').min = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  $('homeworkFolderTitle').textContent = folder.subject; $('homeworkFolderTeacher').textContent = 'bei ' + folder.teacher; $('homeworkText').value = ''; $('homeworkExpiresAt').value = ''; $('homeworkStatus').textContent = ''; $('homeworkImageName').textContent = ''; $('homeworkImage').value = ''; homeworkImageData = '';
  loadHomeworkEntries(folder); if (homeworkRefreshTimer) clearInterval(homeworkRefreshTimer); homeworkRefreshTimer = setInterval(() => { if (activeHomeworkFolder?.id === folder.id) loadHomeworkEntries(folder, true); }, 10_000);
}
function closeHomework() {
  $('homeworkWorkspace').classList.add('hidden'); showHomeworkFolders();
  if (homeworkReturnTo === 'chat') { home.classList.add('hidden'); chatWorkspace.classList.remove('hidden'); }
  else { chatWorkspace.classList.add('hidden'); home.classList.remove('hidden'); }
}
function fillProfile(profile) {
  myProfile = profile; myName = profile.name; nameInput.value = myName; localStorage.setItem('pwgChatName', myName);
  $('profileName').textContent = profile.name; updateAvatarElement($('profileAvatar'), profile.avatar, profile.name);
  $('renameName').value = profile.name;
  loadRoomContacts();
  refreshFriendData(); if (!friendRefreshTimer) friendRefreshTimer = setInterval(refreshFriendData, 15_000);
  updateNotificationControls();
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
        if (!notificationInviteId && hasInviteCode) { codeInput.value = inviteCode; connect('join'); }
        else if (!notificationInviteId && savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); }
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
    if (notificationInviteId) await joinRoomFromNotification();
    else if (hasInviteCode) { codeInput.value = inviteCode; connect('join'); }
    else if (savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); }
    askForNotificationsOnce();
  } catch (err) { output.textContent = err.message; input.focus(); }
});
$('profileButton').addEventListener('click', () => { $('profileOverlay').classList.remove('hidden'); refreshFriendData(); });
$('notificationsButton').addEventListener('click', toggleNotifications);
$('inviteFriends').addEventListener('click', openRoomInviteDialog);
$('closeRoomInvite').addEventListener('click', () => $('roomInviteOverlay').classList.add('hidden'));
$('roomInviteOverlay').addEventListener('click', event => { if (event.target === $('roomInviteOverlay')) $('roomInviteOverlay').classList.add('hidden'); });
$('homeworkButton').addEventListener('click', () => {
  if (!myProfile) { $('setupOverlay').classList.remove('hidden'); return; }
  homeworkReturnTo = chatWorkspace.classList.contains('hidden') ? 'home' : 'chat';
  home.classList.add('hidden'); chatWorkspace.classList.add('hidden'); $('homeworkWorkspace').classList.remove('hidden'); showHomeworkFolders(); renderHomeworkFolders();
});
$('homeworkBack').addEventListener('click', closeHomework);
$('homeworkFoldersBack').addEventListener('click', showHomeworkFolders);
$('homeworkImageButton').addEventListener('click', () => $('homeworkImage').click());
$('homeworkImage').addEventListener('change', async event => {
  const file = event.target.files[0]; homeworkImageData = ''; $('homeworkImageName').textContent = ''; if (!file) return;
  const status = $('homeworkStatus'); status.textContent = '';
  if (!file.type.startsWith('image/')) { status.textContent = 'Bitte wähle eine Bilddatei aus.'; event.target.value = ''; return; }
  if (file.size > 15 * 1024 * 1024) { status.textContent = 'Das Bild ist zu groß. Bitte wähle ein kleineres Bild.'; event.target.value = ''; return; }
  try { homeworkImageData = await compressHomeworkImage(file); $('homeworkImageName').textContent = file.name; }
  catch (err) { status.textContent = err.message || 'Das Bild konnte nicht vorbereitet werden.'; event.target.value = ''; }
});
$('homeworkForm').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('homeworkText').value.trim(), status = $('homeworkStatus'), button = $('homeworkSubmit');
  if (!activeHomeworkFolder || (!text && !homeworkImageData)) { status.textContent = 'Schreibe etwas oder wähle ein Bild aus.'; return; }
  const expiryInput = $('homeworkExpiresAt').value, expiryDate = expiryInput ? new Date(expiryInput) : null;
  if (expiryDate && expiryDate.getTime() <= Date.now()) { status.textContent = 'Das Löschdatum muss in der Zukunft liegen.'; $('homeworkExpiresAt').focus(); return; }
  button.disabled = true; status.textContent = 'Wird geteilt …';
  try {
    const data = await api('/api/homework', { method: 'POST', body: JSON.stringify({ folder: activeHomeworkFolder.id, text, image: homeworkImageData, expiresAt: expiryDate ? expiryDate.toISOString() : '' }) });
    $('homeworkEntries').querySelector('.homework-empty')?.remove(); renderHomeworkEntry(data.entry, activeHomeworkFolder);
    if (data.entry.time > homeworkLatestTime) homeworkLatestTime = data.entry.time;
    $('homeworkText').value = ''; $('homeworkExpiresAt').value = ''; $('homeworkImage').value = ''; $('homeworkImageName').textContent = ''; homeworkImageData = ''; status.textContent = 'Beitrag wurde geteilt.';
  } catch (err) { status.textContent = err.message || 'Der Beitrag konnte nicht geteilt werden.'; }
  finally { button.disabled = false; }
});
$('closeProfile').addEventListener('click', () => $('profileOverlay').classList.add('hidden'));
$('closeOtherProfile').addEventListener('click', () => $('otherProfileOverlay').classList.add('hidden'));
$('otherProfileOverlay').addEventListener('click', event => { if (event.target === $('otherProfileOverlay')) $('otherProfileOverlay').classList.add('hidden'); });
$('otherProfileWhisper').addEventListener('click', () => { const target = activeOtherProfile; $('otherProfileOverlay').classList.add('hidden'); if (target) openWhisper(target.identity, target.name); });
$('otherProfileDraw').addEventListener('click', () => {
  if (!activeOtherProfile || !roomCode || socket?.readyState !== WebSocket.OPEN) { $('otherProfileStatus').textContent = 'Du musst mit dieser Person in einem Raum sein.'; return; }
  socket.send(JSON.stringify({ type: 'drawOpen', targetIdentity: activeOtherProfile.identity }));
  $('otherProfileStatus').textContent = 'Die gemeinsame Zeichenfläche wird geöffnet …';
});
$('closeDraw').addEventListener('click', () => $('drawOverlay').classList.add('hidden'));
$('drawOverlay').addEventListener('click', event => { if (event.target === $('drawOverlay')) $('drawOverlay').classList.add('hidden'); });
$('drawClear').addEventListener('click', () => { if (activeDrawing && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'drawClear', boardId: activeDrawing.boardId })); });
$('drawCanvas').addEventListener('pointerdown', event => {
  if (!activeDrawing || socket?.readyState !== WebSocket.OPEN) return;
  const point = drawingPoint(event); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget._lastPoint = point;
  sendDrawSegment([point]);
});
$('drawCanvas').addEventListener('pointermove', event => {
  const canvas = event.currentTarget, previous = canvas._lastPoint;
  if (!previous || !activeDrawing) return;
  const next = drawingPoint(event); canvas._lastPoint = next; sendDrawSegment([previous, next]);
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) $('drawCanvas').addEventListener(eventName, event => { event.currentTarget._lastPoint = null; });
$('otherProfileAddFriend').addEventListener('click', async () => {
  if (!activeOtherProfile) return;
  const button = $('otherProfileAddFriend'), status = $('otherProfileStatus'), target = activeOtherProfile; button.disabled = true; status.textContent = 'Wird gesendet …';
  try { await api('/api/friend-requests', { method: 'POST', body: JSON.stringify({ identity: target.identity }) }); button.textContent = 'Anfrage gesendet'; status.textContent = 'Die Person sieht deine Anfrage beim Profil.'; await refreshFriendData(); }
  catch (err) { status.textContent = err.message; button.disabled = false; }
});
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
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('profileOverlay').classList.add('hidden'); $('otherProfileOverlay').classList.add('hidden'); $('designOverlay').classList.add('hidden'); $('roomInviteOverlay').classList.add('hidden'); } });
function getRoomMedia(platform, value) {
  const input = String(value || '').trim();
  if (platform === 'twitch') {
    let channel = input;
    if (/^https:\/\//i.test(input)) { try { const url = new URL(input); if (!['twitch.tv', 'www.twitch.tv'].includes(url.hostname.toLowerCase())) return null; channel = url.pathname.split('/').filter(Boolean)[0] || ''; } catch { return null; } }
    if (!/^[a-z0-9_]{1,25}$/i.test(channel) || ['videos', 'directory', 'downloads', 'p', 'search'].includes(channel.toLowerCase())) return null;
    channel = channel.toLowerCase(); return { platform, id: channel, url: 'https://www.twitch.tv/' + channel };
  }
  if (platform === 'tiktok') {
    let id = input, url = '';
    if (/^https:\/\//i.test(input)) { try { const parsed = new URL(input); if (parsed.hostname.toLowerCase() !== 'tiktok.com' && !parsed.hostname.toLowerCase().endsWith('.tiktok.com')) return null; const match = parsed.pathname.match(/(?:\/video\/|\/player\/v1\/)(\d{10,25})/); if (!match) return null; id = match[1]; url = 'https://www.tiktok.com' + parsed.pathname; } catch { return null; } }
    if (!/^\d{10,25}$/.test(id)) return null;
    return { platform, id, url: url || 'https://www.tiktok.com/player/v1/' + id };
  }
  return null;
}
function setRoomMedia(media) {
  const player = $('roomMediaPlayer'), external = $('roomMediaExternal'); player.replaceChildren(); external.classList.add('hidden'); external.removeAttribute('href');
  if (!media || !['twitch', 'tiktok'].includes(media.platform) || typeof media.id !== 'string') {
    const message = document.createElement('span'); message.textContent = 'Noch kein Video ausgewählt.'; player.append(message);
    $('roomMediaStatus').textContent = 'Gib einen Twitch-Kanalnamen oder einen TikTok-Videolink ein.'; $('roomMediaDetails').open = false; return;
  }
  let src = '', externalUrl = '';
  if (media.platform === 'twitch' && /^[a-z0-9_]{1,25}$/i.test(media.id)) {
    src = 'https://player.twitch.tv/?channel=' + encodeURIComponent(media.id) + '&parent=' + encodeURIComponent(location.hostname) + '&autoplay=false&muted=true'; externalUrl = 'https://www.twitch.tv/' + encodeURIComponent(media.id);
  } else if (media.platform === 'tiktok' && /^\d{10,25}$/.test(media.id)) {
    src = 'https://www.tiktok.com/player/v1/' + encodeURIComponent(media.id) + '?autoplay=0&controls=1'; externalUrl = 'https://www.tiktok.com/player/v1/' + encodeURIComponent(media.id);
  } else { $('roomMediaStatus').textContent = 'Dieser Videolink konnte nicht angezeigt werden.'; return; }
  const frame = document.createElement('iframe'); frame.src = src; frame.title = media.platform === 'twitch' ? 'Twitch Livevideo' : 'TikTok-Video'; frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin'; player.append(frame);
  external.href = externalUrl; external.classList.remove('hidden'); $('roomMediaStatus').textContent = 'Das Video wird nur dir auf diesem Gerät angezeigt.'; $('roomMediaDetails').open = true;
}
function shareRoomMedia(event) {
  event.preventDefault();
  const media = getRoomMedia($('roomMediaPlatform').value, $('roomMediaInput').value);
  if (!media) { $('roomMediaStatus').textContent = $('roomMediaPlatform').value === 'twitch' ? 'Gib einen gültigen Twitch-Kanalnamen ein.' : 'Füge einen vollständigen TikTok-Link zu einem Video ein.'; return; }
  setRoomMedia(media);
}
$('roomMediaForm').addEventListener('submit', shareRoomMedia);
$('roomMediaClear').addEventListener('click', () => setRoomMedia(null));
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
    if (data.type === 'joined') { closeWhisperInbox(); if (activeWhisper) { activeWhisper = null; chatWorkspace.classList.remove('whisper-only', 'has-whisper'); $('privateChat').classList.add('hidden'); } resetRoomVideo(); setRoomMedia(null); roomCode = data.code; selfVideoPeerId = data.videoPeerId || ''; (data.videoPeers || []).forEach(addRoomVideoPeer); $('roomCode').textContent = roomCode; $('roomTitle').textContent = data.roomName || 'Euer Raum'; home.classList.add('hidden'); chat.classList.remove('hidden'); chatWorkspace.classList.remove('hidden'); $('messages').innerHTML = ''; data.history.forEach(renderMessage); saveRoomSession(); updateConnection(true); loadRoomContacts(); }
    if (data.type === 'roomPeerJoined') addRoomVideoPeer(data);
    if (data.type === 'videoPeerUp') { if (!videoPeers.has(data.peerId)) addRoomVideoPeer({ ...data, videoActive: true }); setRoomPeerCamera(data.peerId, true, data.name); }
    if (data.type === 'videoPeerDown') setRoomPeerCamera(data.peerId, false, data.name);
    if (data.type === 'videoSignal') handleVideoSignal(data).catch(err => console.warn('Kamera-Signal fehlgeschlagen.', err));
    if (data.type === 'drawOpen') openDrawing(data);
    if (data.type === 'drawStroke') receiveDrawingStroke(data);
    if (data.type === 'drawClear' && activeDrawing?.boardId === data.boardId) { activeDrawing.strokes = []; paintDrawingCanvas(); }
    if (data.type === 'drawError') $('otherProfileStatus').textContent = data.message;
    if (data.type === 'roomPeerLeft') removeRoomVideoPeer(data.peerId);
    if (data.type === 'message' || data.type === 'image') renderMessage(data);
    if (data.type === 'avatarUpdate') document.querySelectorAll('.bubble[data-identity="' + CSS.escape(data.identity) + '"] .sender-avatar').forEach(element => updateAvatarElement(element, data.avatar, data.name));
    handleWhisperData(data);
    if (data.type === 'notice') { renderNotice(data.text); loadRoomContacts(); }
    if (data.type === 'typing') renderTyping(data.users);
    if (data.type === 'readReceipt') updateReadReceipt(data.messageId, data.count);
  });
  socket.addEventListener('close', () => { updateConnection(false); resetRoomVideo(); });
  socket.addEventListener('error', () => { error.textContent = 'Verbindung fehlgeschlagen. Läuft der Chatserver?'; updateConnection(false); });
}
function updateConnection(ok) { $('connection').classList.toggle('offline', !ok); $('connection').innerHTML = '<i></i> ' + (ok ? 'verbunden' : 'Verbindung getrennt'); }
function showCameraEmpty() {
  if ($('cameraTiles').children.length) return;
  const empty = document.createElement('p'); empty.id = 'cameraPanelEmpty'; empty.className = 'camera-panel-empty'; empty.textContent = 'Noch ist keine Kamera im Raum aktiv.'; $('cameraTiles').append(empty);
}
function makeCameraTile(peerId, name, local = false) {
  $('cameraPanelEmpty')?.remove();
  const tile = document.createElement('div'); tile.className = 'camera-tile' + (local ? ' local' : ' waiting'); tile.dataset.videoPeerId = peerId;
  const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = true; video.setAttribute('aria-label', local ? 'Dein Kamerabild' : 'Kamerabild von ' + name);
  const label = document.createElement('span'); label.className = 'camera-tile-label'; label.textContent = local ? myName + ' (du)' : name;
  tile.append(video, label); $('cameraTiles').append(tile); return { tile, video, label };
}
function ensureRemoteCameraTile(peer) {
  if (!peer.tile) peer.tile = makeCameraTile(peer.peerId, peer.name);
  else peer.tile.label.textContent = peer.name;
  return peer.tile;
}
function sendVideoSignal(peer, signal) {
  if (socket?.readyState === WebSocket.OPEN && roomCode) socket.send(JSON.stringify({ type: 'videoSignal', toPeerId: peer.peerId, signal }));
}
async function negotiateVideoPeer(peer, pc) {
  if (peer.makingOffer || pc.signalingState !== 'stable') return;
  try {
    peer.makingOffer = true; await pc.setLocalDescription();
    sendVideoSignal(peer, { kind: 'description', description: pc.localDescription.toJSON() });
  } catch (err) { console.warn('Kamera-Verbindung konnte nicht ausgehandelt werden.', err); }
  finally { peer.makingOffer = false; }
}
async function ensureVideoConnection(peer) {
  if (peer.pc && peer.pc.signalingState !== 'closed') {
    if (peer.connecting) await peer.connecting;
    if (localCameraStream && peer.transceiver?.sender.track !== localCameraStream.getVideoTracks()[0]) {
      await peer.transceiver.sender.replaceTrack(localCameraStream.getVideoTracks()[0]); peer.transceiver.direction = 'sendrecv';
      if (peer.pc.signalingState === 'stable') await negotiateVideoPeer(peer, peer.pc);
    }
    return peer;
  }
  if (peer.connecting) return peer.connecting;
  peer.connecting = (async () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peer.pc = pc; peer.ready = false; peer.polite = selfVideoPeerId.localeCompare(peer.peerId) > 0;
    peer.candidateQueue = [];
    const transceiver = pc.addTransceiver('video', { direction: 'recvonly' });
    pc.onicecandidate = event => { if (event.candidate) sendVideoSignal(peer, { kind: 'candidate', candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => {
      const tile = ensureRemoteCameraTile(peer); tile.tile.classList.remove('waiting');
      clearTimeout(peer.connectTimer);
      tile.video.srcObject = event.streams[0] || new MediaStream([event.track]); tile.video.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { clearTimeout(peer.connectTimer); peer.tile?.tile.classList.add('failed'); $('cameraStatus').textContent = 'Keine Videoverbindung zu ' + peer.name + '. Das Netzwerk könnte direkte Videoverbindungen blockieren.'; }
      else if (pc.connectionState === 'connected') { clearTimeout(peer.connectTimer); peer.tile?.tile.classList.remove('failed'); if (localCameraStream) $('cameraStatus').textContent = 'Deine Kamera wird im Raum geteilt. Mikrofon aus.'; }
    };
    pc.onnegotiationneeded = () => { if (peer.ready && localCameraStream) negotiateVideoPeer(peer, pc); };
    peer.transceiver = transceiver;
    if (localCameraStream) { await transceiver.sender.replaceTrack(localCameraStream.getVideoTracks()[0]); transceiver.direction = 'sendrecv'; }
    peer.ready = true;
    if (localCameraStream) await negotiateVideoPeer(peer, pc);
    peer.connectTimer = setTimeout(() => { if (peer.pc === pc && pc.connectionState !== 'connected' && peer.tile) { peer.tile.tile.classList.add('failed'); $('cameraStatus').textContent = 'Die Kamera von ' + peer.name + ' verbindet sich nicht. Prüft eure Netzwerkverbindung.'; } }, 15_000);
    return peer;
  })();
  try { await peer.connecting; } finally { peer.connecting = null; }
  return peer;
}
async function handleVideoSignal(data) {
  if (!data.fromPeerId || data.fromPeerId === selfVideoPeerId) return;
  let peer = videoPeers.get(data.fromPeerId);
  if (!peer) { peer = { peerId: data.fromPeerId, identity: data.identity, name: data.name || 'Freund', videoActive: true, pc: null, tile: null }; videoPeers.set(peer.peerId, peer); }
  if (data.name) peer.name = data.name;
  peer.videoActive = true; ensureRemoteCameraTile(peer);
  await ensureVideoConnection(peer);
  const pc = peer.pc, signal = data.signal;
  try {
    if (signal?.kind === 'candidate' && signal.candidate) {
      if (peer.ignoreOffer) return;
      if (!pc.remoteDescription) peer.candidateQueue.push(signal.candidate);
      else await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      return;
    }
    const description = signal?.description;
    if (signal?.kind !== 'description' || !description || !['offer', 'answer'].includes(description.type)) return;
    const readyForOffer = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingRemoteAnswerPending);
    const offerCollision = description.type === 'offer' && !readyForOffer;
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;
    if (offerCollision && peer.polite) await pc.setLocalDescription({ type: 'rollback' });
    peer.settingRemoteAnswerPending = description.type === 'answer';
    await pc.setRemoteDescription(description); peer.settingRemoteAnswerPending = false;
    while (peer.candidateQueue.length) await pc.addIceCandidate(new RTCIceCandidate(peer.candidateQueue.shift()));
    if (description.type === 'offer') { await pc.setLocalDescription(); sendVideoSignal(peer, { kind: 'description', description: pc.localDescription.toJSON() }); }
  } catch (err) { if (!peer.ignoreOffer) console.warn('Kamera-Signal konnte nicht verarbeitet werden.', err); }
}
function addRoomVideoPeer(info) {
  if (!info?.peerId || info.peerId === selfVideoPeerId) return;
  const peer = videoPeers.get(info.peerId) || { peerId: info.peerId, pc: null, tile: null };
  Object.assign(peer, info); videoPeers.set(peer.peerId, peer);
  if (peer.videoActive) { ensureRemoteCameraTile(peer); ensureVideoConnection(peer).catch(() => {}); }
  else if (localCameraStream) ensureVideoConnection(peer).catch(() => {});
}
function setRoomPeerCamera(peerId, active, name) {
  const peer = videoPeers.get(peerId);
  if (!peer) return;
  if (name) peer.name = name;
  peer.videoActive = active;
  if (active) { ensureRemoteCameraTile(peer); ensureVideoConnection(peer).catch(() => {}); }
  else {
    peer.tile?.tile.remove(); peer.tile = null;
    if (!localCameraStream && peer.pc) { peer.pc.close(); peer.pc = null; peer.connecting = null; peer.ready = false; }
    showCameraEmpty();
  }
}
function removeRoomVideoPeer(peerId) {
  const peer = videoPeers.get(peerId); if (!peer) return;
  peer.pc?.close(); peer.tile?.tile.remove(); videoPeers.delete(peerId); showCameraEmpty();
}
async function startRoomCamera() {
  if (!roomCode || socket?.readyState !== WebSocket.OPEN) { $('cameraStatus').textContent = 'Tritt zuerst einem Raum bei.'; return; }
  if (!navigator.mediaDevices?.getUserMedia) { $('cameraStatus').textContent = 'Die Kamera ist in diesem Browser nicht verfügbar.'; return; }
  const button = $('cameraButton'); button.disabled = true; $('cameraStatus').textContent = 'Kamera wird gestartet …';
  try {
    localCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    localCameraTile = makeCameraTile(selfVideoPeerId, myName, true); localCameraTile.video.srcObject = localCameraStream; localCameraTile.video.play().catch(() => {});
    button.textContent = 'Kamera stoppen'; button.classList.add('is-active');
    $('cameraStatus').textContent = 'Deine Kamera wird im Raum geteilt. Mikrofon aus.';
    socket.send(JSON.stringify({ type: 'videoState', active: true }));
    for (const peer of videoPeers.values()) ensureVideoConnection(peer).catch(() => {});
  } catch (err) {
    localCameraStream?.getTracks().forEach(track => track.stop()); localCameraStream = null;
    $('cameraStatus').textContent = err.name === 'NotAllowedError' ? 'Bitte erlaube den Kamerazugriff in deinem Browser.' : 'Die Kamera konnte nicht gestartet werden.';
  } finally { button.disabled = false; }
}
function stopRoomCamera(notify = true) {
  if (notify && socket?.readyState === WebSocket.OPEN && localCameraStream) socket.send(JSON.stringify({ type: 'videoState', active: false }));
  localCameraStream?.getTracks().forEach(track => track.stop()); localCameraStream = null;
  localCameraTile?.tile.remove(); localCameraTile = null;
  for (const peer of videoPeers.values()) if (peer.transceiver?.sender) peer.transceiver.sender.replaceTrack(null).catch(() => {});
  $('cameraButton').textContent = 'Kamera starten'; $('cameraButton').classList.remove('is-active');
  $('cameraStatus').textContent = 'Dein Mikrofon bleibt aus.'; showCameraEmpty();
}
function resetRoomVideo() {
  stopRoomCamera(false); for (const peer of videoPeers.values()) { peer.pc?.close(); peer.tile?.tile.remove(); }
  videoPeers.clear(); selfVideoPeerId = ''; $('cameraTiles').replaceChildren(); showCameraEmpty();
}
showCameraEmpty();
function renderNotice(text) { const item = document.createElement('div'); item.className = 'notice'; item.textContent = text; $('messages').append(item); scrollDown(); }
function messagePreview(message) { return message.type === 'image' ? '📷 Bild' : String(message.text || '').slice(0, 180); }
function setReplyTarget(message) {
  if (!message?.id) return;
  pendingReply = { id: message.id, name: message.name, text: messagePreview(message) };
  $('replyTargetName').textContent = pendingReply.name;
  $('replyTargetText').textContent = pendingReply.text;
  $('replyComposer').classList.remove('hidden'); $('message').focus();
}
function clearReplyTarget() { pendingReply = null; $('replyComposer').classList.add('hidden'); }
function renderMessage(msg) {
  const empty = $('messages').querySelector('.empty'); if (empty) empty.remove();  const bubble = document.createElement('article'); bubble.className = 'bubble' + (msg.name === myName ? ' mine' : '');
  if (msg.id) bubble.dataset.messageId = msg.id; if (msg.identity) bubble.dataset.identity = msg.identity; bubble._chatMessage = msg;
  const sender = document.createElement('span'); sender.className = 'sender'; const avatar = document.createElement('span'); avatar.className = 'sender-avatar'; updateAvatarElement(avatar, msg.avatar, msg.name); sender.append(avatar);
  if (msg.identity && msg.identity !== identity) { const name = document.createElement('button'); name.className = 'sender-name'; name.type = 'button'; name.textContent = msg.name; name.title = 'Profil von ' + msg.name + ' öffnen'; name.addEventListener('click', () => openOtherProfile(msg.identity, msg.name, msg.avatar)); sender.append(name); }
  else sender.append(document.createTextNode(msg.name === myName ? 'Du' : msg.name));
  bubble.append(sender);
  if (msg.replyTo) {
    const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'reply-quote'; quote.setAttribute('aria-label', 'Ursprüngliche Nachricht von ' + msg.replyTo.name + ' anzeigen');
    const quoteName = document.createElement('strong'); quoteName.textContent = msg.replyTo.name;
    const quoteText = document.createElement('span'); quoteText.textContent = msg.replyTo.text;
    quote.append(quoteName, quoteText); quote.addEventListener('click', () => {
      const original = document.querySelector('[data-message-id="' + CSS.escape(msg.replyTo.id) + '"]');
      if (original) { original.scrollIntoView({ behavior: 'smooth', block: 'center' }); original.classList.add('reply-highlight'); setTimeout(() => original.classList.remove('reply-highlight'), 1300); }
    }); bubble.append(quote);
  }
  if (msg.type === 'image') { const image = document.createElement('img'); image.className = 'message-image'; image.src = msg.image; image.alt = 'Bild von ' + msg.name; image.loading = 'lazy'; bubble.append(image); }
  else { const text = document.createElement('div'); text.className = 'text'; text.textContent = msg.text; bubble.append(text); }  const time = document.createElement('time'); time.textContent = new Date(msg.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); bubble.append(time);
  if (msg.id) { const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'reply-action'; reply.textContent = '↩ Antworten'; reply.addEventListener('click', () => setReplyTarget(msg)); bubble.append(reply); }
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
async function openOtherProfile(targetIdentity, targetName, avatar) {
  if (!targetIdentity || targetIdentity === identity || !myProfile) return;
  activeOtherProfile = { identity: targetIdentity, name: targetName, avatar };
  $('otherProfileName').textContent = targetName; updateAvatarElement($('otherProfileAvatar'), avatar, targetName);
  $('otherProfileDraw').classList.toggle('hidden', !roomCode || socket?.readyState !== WebSocket.OPEN);
  const button = $('otherProfileAddFriend'), status = $('otherProfileStatus'); button.disabled = true; button.textContent = 'Wird geladen …'; status.textContent = '';
  $('otherProfileOverlay').classList.remove('hidden');
  try {
    const data = await api('/api/friends');
    if (activeOtherProfile?.identity !== targetIdentity) return;
    if (data.friends.some(friend => friend.identity === targetIdentity)) { button.textContent = 'Schon befreundet'; status.textContent = 'Ihr seid schon befreundet.'; }
    else if (data.outgoing.some(request => request.identity === targetIdentity)) { button.textContent = 'Anfrage gesendet'; status.textContent = 'Deine Anfrage wartet noch auf eine Antwort.'; }
    else if (data.incoming.some(request => request.identity === targetIdentity)) { button.textContent = 'Anfrage wartet auf dich'; status.textContent = 'Öffne dein Profil, um die Anfrage anzunehmen oder abzulehnen.'; }
    else { button.textContent = 'Freundschaftsanfrage senden'; button.disabled = false; }
  } catch (err) { if (activeOtherProfile?.identity === targetIdentity) { button.textContent = 'Freundschaftsanfrage senden'; button.disabled = false; status.textContent = err.message; } }
}
function openDrawing(data) {
  activeDrawing = { boardId: data.boardId, withName: data.withName || 'Mitglied', strokes: [] };
  $('drawSubtitle').textContent = 'Gemeinsam mit ' + activeDrawing.withName + ' · Striche werden live geteilt.';
  $('drawStatus').textContent = '';
  $('otherProfileOverlay').classList.add('hidden'); $('drawOverlay').classList.remove('hidden');
  requestAnimationFrame(paintDrawingCanvas);
}
function drawingPoint(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
}
function sendDrawSegment(points) {
  if (!activeDrawing || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'drawStroke', boardId: activeDrawing.boardId, stroke: { color: $('drawColor').value, size: Number($('drawSize').value), tool: $('drawTool').value, points } }));
}
function receiveDrawingStroke(data) {
  if (!activeDrawing || activeDrawing.boardId !== data.boardId || !data.stroke) return;
  activeDrawing.strokes.push(data.stroke); if (activeDrawing.strokes.length > 5000) activeDrawing.strokes.shift();
  paintDrawingStroke(data.stroke);
}
function paintDrawingCanvas() {
  const canvas = $('drawCanvas'), rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2), width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = '#fff'; context.fillRect(0, 0, rect.width, rect.height);
  for (const stroke of activeDrawing?.strokes || []) drawStrokeOnCanvas(context, stroke, rect.width, rect.height);
}
function paintDrawingStroke(stroke) {
  const canvas = $('drawCanvas'), rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const context = canvas.getContext('2d'), ratio = Math.min(window.devicePixelRatio || 1, 2);
  context.setTransform(ratio, 0, 0, ratio, 0, 0); drawStrokeOnCanvas(context, stroke, rect.width, rect.height);
}
function drawStrokeOnCanvas(context, stroke, width, height) {
  const points = stroke.points || []; if (!points.length) return;
  const tool = ['pencil', 'marker', 'highlighter', 'eraser'].includes(stroke.tool) ? stroke.tool : 'pencil';
  context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  context.globalAlpha = tool === 'highlighter' ? 0.28 : tool === 'marker' ? 0.78 : 1;
  context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.lineWidth = stroke.size * (tool === 'eraser' || tool === 'highlighter' ? 2.5 : tool === 'marker' ? 1.5 : 0.65); context.lineCap = 'round'; context.lineJoin = 'round';
  if (points.length === 1) { context.beginPath(); context.arc(points[0].x * width, points[0].y * height, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1; return; }
  context.beginPath(); context.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length; i++) context.lineTo(points[i].x * width, points[i].y * height);
  context.stroke();
  context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
}
window.addEventListener('resize', () => { if (activeDrawing && !$('drawOverlay').classList.contains('hidden')) paintDrawingCanvas(); });
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
function leaveRoom() { if (activeWhisper) closeWhisper(); $('drawOverlay').classList.add('hidden'); activeDrawing = null; $('drawCanvas')._lastPoint = null; clearReplyTarget(); stopRoomCamera(true); resetRoomVideo(); setRoomMedia(null); clearRoomSession(); if (socket) socket.close(); chatWorkspace.classList.add('hidden'); home.classList.remove('hidden'); error.textContent = ''; roomCode = ''; $('messages').innerHTML = '<div class="empty"><span>✳</span><strong>Hier beginnt euer Gespräch.</strong><small>Schickt die erste Nachricht oder teilt den Raumcode.</small></div>'; loadRoomContacts(); connectWhisperInbox(); }
$('create').addEventListener('click', () => connect('create'));
$('cameraButton').addEventListener('click', () => localCameraStream ? stopRoomCamera(true) : startRoomCamera());
$('join').addEventListener('click', () => { if (codeInput.value.trim().length !== 6) { error.textContent = 'Ein Raumcode besteht aus 6 Ziffern.'; codeInput.focus(); return; } connect('join'); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); error.textContent = ''; });
roomNameInput.addEventListener('input', () => error.textContent = '');$('message').addEventListener('input', () => { if ($('message').value.trim()) updateTyping(); else stopTyping(); });
$('message').addEventListener('blur', stopTyping);
$('form').addEventListener('submit', event => { event.preventDefault(); const input = $('message'), text = input.value.trim(); if (text && socket?.readyState === WebSocket.OPEN) { stopTyping(); socket.send(JSON.stringify({ type: 'message', text, replyTo: pendingReply?.id || null })); input.value = ''; clearReplyTarget(); input.focus(); } });
$('cancelReply').addEventListener('click', clearReplyTarget);
$('whisperForm').addEventListener('submit', event => { event.preventDefault(); const input = $('whisperMessage'), text = input.value.trim(), channel = roomCode ? socket : whisperSocket; if (text && activeWhisper && channel?.readyState === WebSocket.OPEN) { sendWhisper(text); input.value = ''; input.focus(); } });
$('imageButton').addEventListener('click', () => $('imageFile').click());
$('imageFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { renderNotice('Bitte wähle eine Bilddatei aus.'); event.target.value = ''; return; }
  if (file.size > 15 * 1024 * 1024) { renderNotice('Das Originalbild ist zu groß. Bitte wähle ein kleineres Bild.'); event.target.value = ''; return; }
  const button = $('imageButton'); button.disabled = true;
  try { const dataUrl = await compressImage(file); if (dataUrl.length > 650000) throw new Error('Das Bild ist zu groß. Bitte wähle ein kleineres Bild.'); if (socket?.readyState !== WebSocket.OPEN) throw new Error('Die Verbindung zum Raum ist unterbrochen.'); socket.send(JSON.stringify({ type: 'image', image: dataUrl, replyTo: pendingReply?.id || null })); clearReplyTarget(); }
  catch (err) { renderNotice(err.message || 'Das Bild konnte nicht geladen werden. Wähle JPG oder PNG.'); }
  finally { button.disabled = false; event.target.value = ''; }
});
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try { const image = new Image(); image.src = url; await image.decode(); const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); for (const quality of [0.78, 0.66, 0.54, 0.42]) { const result = canvas.toDataURL('image/jpeg', quality); if (result.length <= 650000) return result; } return canvas.toDataURL('image/jpeg', 0.35); }
  finally { URL.revokeObjectURL(url); }
}
async function compressHomeworkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.76, 0.62, 0.48, 0.34, 0.22]) { const result = canvas.toDataURL('image/jpeg', quality); if (result.length <= 650000) return result; }
    throw new Error('Das Bild ist zu groß. Bitte wähle ein anderes Bild.');
  } finally { URL.revokeObjectURL(url); }
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
loadProfile().then(() => {
  if (myProfile && notificationInviteId) { joinRoomFromNotification(); askForNotificationsOnce(); return; }
  if (myProfile && hasInviteCode) connect('join'); else if (myProfile && savedRoomSession?.code) { codeInput.value = savedRoomSession.code; connect('join'); }
  if (!myProfile) return;
  const destination = new URLSearchParams(location.search), open = destination.get('open');
  if (open === 'profile') { $('profileOverlay').classList.remove('hidden'); refreshFriendData(); }
  if (open === 'homework') {
    $('homeworkButton').click();
    const folder = homeworkCatalog.find(item => item.id === destination.get('folder'));
    if (folder) openHomeworkFolder(folder);
  }
  askForNotificationsOnce();
});


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
