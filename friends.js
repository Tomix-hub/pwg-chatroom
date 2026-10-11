const $ = (id) => document.getElementById(id);
const list = $('friendList'), input = $('friendName'), error = $('friendError');
function getFriends() {
  try { const value = JSON.parse(localStorage.getItem('pwgChatFriends') || '[]'); return Array.isArray(value) ? value.filter(name => typeof name === 'string') : []; }
  catch { return []; }
}
function renderFriends() {
  list.replaceChildren();
  const friends = getFriends();
  if (!friends.length) { const empty = document.createElement('div'); empty.className = 'friends-empty'; empty.textContent = 'Deine Freundesliste ist noch leer. Füge oben einen Namen hinzu.'; list.append(empty); return; }
  friends.forEach((name, index) => {
    const row = document.createElement('div'); row.className = 'friend-row';
    const avatar = document.createElement('span'); avatar.className = 'friend-avatar'; avatar.textContent = name.trim().charAt(0).toLocaleUpperCase();
    const label = document.createElement('span'); label.className = 'friend-name'; label.textContent = name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'friend-remove'; remove.textContent = 'Entfernen'; remove.setAttribute('aria-label', name + ' aus der Freundesliste entfernen');
    remove.addEventListener('click', () => { const current = getFriends(); current.splice(index, 1); localStorage.setItem('pwgChatFriends', JSON.stringify(current)); renderFriends(); });
    row.append(avatar, label, remove); list.append(row);
  });
}
$('friendForm').addEventListener('submit', event => {
  event.preventDefault(); const name = input.value.trim().slice(0, 24); if (!name) { error.textContent = 'Bitte gib einen Namen ein.'; return; }
  const ownName = (localStorage.getItem('pwgChatName') || '').trim();
  if (name.toLocaleLowerCase() === ownName.toLocaleLowerCase()) { error.textContent = 'Das bist schon du.'; return; }
  const friends = getFriends();
  if (friends.some(friend => friend.toLocaleLowerCase() === name.toLocaleLowerCase())) { error.textContent = 'Dieser Name steht schon in deiner Freundesliste.'; return; }
  if (friends.length >= 50) { error.textContent = 'Deine Freundesliste ist voll.'; return; }
  friends.push(name); localStorage.setItem('pwgChatFriends', JSON.stringify(friends)); input.value = ''; error.textContent = ''; renderFriends();
});
input.addEventListener('input', () => error.textContent = '');
renderFriends();
