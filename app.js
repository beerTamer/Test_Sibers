/* app.js
   Dark UI real-time chat with public/private channels.
   Users from users.json, BroadcastChannel for sync, localStorage for persistence.
*/

const USERS_JSON_URL = 'https://hr2.sibers.com/test/frontend/users.json';
const STORAGE_KEY = 'rtchat_v4_channels';
const BC_NAME = 'rtchat_v4_bc';

let users = [];
let channels = {};      // {id, name, owner, public, users:[], messages:[]}
let currentUser = null; // id
let currentChannel = null;

const bc = new BroadcastChannel(BC_NAME);

/* -------------------------
   Helpers
   ------------------------- */
function uid(prefix = 'id') { return prefix + '_' + Math.random().toString(36).slice(2, 9); }
function saveChannels() { localStorage.setItem(STORAGE_KEY, JSON.stringify(channels)); }
function loadChannels() { channels = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
function findUserName(id) { const u = users.find(x => x.id === id); return u ? u.name : id; }
function initials(name) { return name ? name.split(' ').map(p => p[0]).join('').toUpperCase() : '?'; }

/* -------------------------
   DOM refs
   ------------------------- */
const loginModal = document.getElementById('loginModal');
const userSelect = document.getElementById('userSelect');
const loginBtn = document.getElementById('loginBtn');

const appRoot = document.querySelector('.app');
const channelListEl = document.getElementById('channelList');
const createChannelBtn = document.getElementById('createChannelBtn');
const deleteChannelBtn = document.getElementById('deleteChannelBtn');
const channelTitleEl = document.getElementById('channelTitle');

const chatMessagesEl = document.getElementById('chatMessages');
const messageInputEl = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

const userListEl = document.getElementById('userList');
const searchInputEl = document.getElementById('searchInput');
const searchResultsEl = document.getElementById('searchResults');

/* -------------------------
   Init
   ------------------------- */
async function init() {
  loadChannels();
  await loadUsers();
  populateLoginSelect();

  const prev = sessionStorage.getItem('rtchat_user');
  if (prev && users.some(u => u.id === prev)) userSelect.value = prev;

  loginBtn.onclick = onLogin;
  createChannelBtn.onclick = onCreateChannel;
  deleteChannelBtn.onclick = onDeleteChannel;
  sendMessageBtn.onclick = onSendMessage;
  messageInputEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); onSendMessage(); } };
  searchInputEl.oninput = renderSearchResults;
  searchResultsEl.onclick = e => { if (e.target.tagName === 'BUTTON') e.target.click(); };

  bc.onmessage = onBCMessage;

  renderChannelList();
  updateChatView();
}

async function loadUsers() {
  try {
    const res = await fetch(USERS_JSON_URL);
    const data = await res.json();
    users = data.map(u => ({ id: u.id, name: u.name }));
  } catch {
    users = [
      { id: 'u1', name: 'Alice Cooper' },
      { id: 'u2', name: 'Bob Marley' },
      { id: 'u3', name: 'Carl Sagan' },
      { id: 'u4', name: 'Diana Prince' }
    ];
  }
}

/* -------------------------
   Login
   ------------------------- */
function populateLoginSelect() {
  userSelect.innerHTML = users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
}
function onLogin() {
  currentUser = userSelect.value;
  sessionStorage.setItem('rtchat_user', currentUser);
  loginModal.style.display = 'none';
  appRoot.style.display = 'grid';
  renderChannelList();
  updateChatView();
}

/* -------------------------
   Channels
   ------------------------- */
function onCreateChannel() {
  if (!currentUser) return;
  const name = prompt('Название канала:');
  if (!name) return;
  const isPublic = confirm('Сделать канал публичным? Ок = публичный, Отмена = приватный');
  const id = uid('ch');
  const ch = { id, name, owner: currentUser, public: isPublic, users: [currentUser], messages: [] };
  channels[id] = ch;
  saveChannels();
  bc.postMessage({ type: 'createChannel', channel: ch });
  openChannel(id);
}

function onDeleteChannel() {
  if (!currentChannel) return;
  const ch = channels[currentChannel];
  if (!ch || ch.owner !== currentUser) return;
  if (!confirm(`Удалить канал "${ch.name}"?`)) return;
  delete channels[currentChannel];
  saveChannels();
  bc.postMessage({ type: 'deleteChannel', channelId: currentChannel });
  currentChannel = null;
  updateChatView();
  renderChannelList();
}

function renderChannelList() {
  channelListEl.innerHTML = '';
  const arr = Object.values(channels).sort((a, b) => a.name.localeCompare(b.name));
  if (arr.length === 0) {
    channelListEl.innerHTML = '<li style="opacity:.7">Нет каналов</li>';
    return;
  }
  arr.forEach(ch => {
    const li = document.createElement('li');
    li.className = (currentChannel === ch.id) ? 'active' : '';
    li.innerHTML = `<div>${ch.name}</div><div style="font-size:12px;opacity:.7">${ch.users.length} участн. ${ch.public ? '• публичный' : '• приватный'}</div>`;
    li.onclick = () => {
      if (!ch.users.includes(currentUser)) {
        if (ch.public && confirm(`Вступить в публичный канал "${ch.name}"?`)) {
          joinChannel(ch.id, currentUser);
        } else {
          alert('Вы не участник этого канала');
          return;
        }
      }
      openChannel(ch.id);
    };
    channelListEl.appendChild(li);
  });
}

function openChannel(id) {
  currentChannel = id;
  renderChannelList();
  const ch = channels[id];
  if (!ch) { updateChatView(); return; }
  channelTitleEl.textContent = ch.name;
  deleteChannelBtn.style.display = (ch.owner === currentUser) ? 'inline-block' : 'none';
  const isMember = ch.users.includes(currentUser);
  messageInputEl.disabled = !isMember;
  sendMessageBtn.disabled = !isMember;
  renderMessages();
  renderUsers();
}

function joinChannel(id, userId) {
  const ch = channels[id];
  if (!ch) return;
  if (!ch.users.includes(userId)) ch.users.push(userId);
  saveChannels();
  bc.postMessage({ type: 'updateUsers', channelId: id, users: ch.users });
  openChannel(id);
}

/* -------------------------
   Users
   ------------------------- */
function renderUsers() {
  userListEl.innerHTML = '';
  const ch = channels[currentChannel];
  if (!ch) return;
  ch.users.forEach(uid => {
    const li = document.createElement('li');
    li.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
      <div class="avatar">${initials(findUserName(uid))}</div>
      ${findUserName(uid)}
    </div>`;
    if (ch.owner === currentUser && uid !== currentUser) {
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.onclick = () => kickUser(currentChannel, uid);
      li.appendChild(btn);
    }
    userListEl.appendChild(li);
  });
}
function kickUser(channelId, uid) {
  const ch = channels[channelId];
  if (!ch || ch.owner !== currentUser) return;
  ch.users = ch.users.filter(u => u !== uid);
  saveChannels();
  bc.postMessage({ type: 'updateUsers', channelId, users: ch.users });
  renderUsers();
}

/* -------------------------
   Search & add
   ------------------------- */
function renderSearchResults() {
  const q = searchInputEl.value.toLowerCase();
  searchResultsEl.innerHTML = '';
  if (!q) return;
  const ch = channels[currentChannel];
  const arr = users.filter(u => u.name.toLowerCase().includes(q) && (!ch || !ch.users.includes(u.id)));
  arr.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `${u.name} <button>Добавить</button>`;
    li.querySelector('button').onclick = () => {
      if (!currentChannel) return;
      ch.users.push(u.id);
      saveChannels();
      bc.postMessage({ type: 'updateUsers', channelId: currentChannel, users: ch.users });
      renderUsers();
      renderSearchResults();
    };
    searchResultsEl.appendChild(li);
  });
}

/* -------------------------
   Messages
   ------------------------- */
function onSendMessage() {
  const txt = messageInputEl.value.trim();
  if (!txt) return;
  const ch = channels[currentChannel];
  if (!ch || !ch.users.includes(currentUser)) return;
  const m = { id: uid('m'), userId: currentUser, text: txt, ts: Date.now() };
  ch.messages.push(m);
  saveChannels();
  bc.postMessage({ type: 'newMessage', channelId: currentChannel, message: m });
  renderMessages();
  messageInputEl.value = '';
}
function renderMessages() {
  chatMessagesEl.innerHTML = '';
  const ch = channels[currentChannel];
  if (!ch) return;
  ch.messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'message' + (m.userId === currentUser ? ' self' : '');
    div.innerHTML = `<div class="avatar">${initials(findUserName(m.userId))}</div>
      <div class="message-content"><strong>${findUserName(m.userId)}</strong><div>${m.text}</div>
      <div style="font-size:11px;opacity:.6">${new Date(m.ts).toLocaleTimeString()}</div></div>`;
    chatMessagesEl.appendChild(div);
  });
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/* -------------------------
   Broadcast sync
   ------------------------- */
function onBCMessage(ev) {
  const d = ev.data;
  if (!d) return;
  switch (d.type) {
    case 'createChannel': channels[d.channel.id] = d.channel; break;
    case 'deleteChannel': delete channels[d.channelId]; break;
    case 'updateUsers': if (channels[d.channelId]) channels[d.channelId].users = d.users; break;
    case 'newMessage': if (channels[d.channelId]) channels[d.channelId].messages.push(d.message); break;
  }
  saveChannels();
  renderChannelList();
  if (d.channelId === currentChannel) { renderUsers(); renderMessages(); }
}

/* -------------------------
   View
   ------------------------- */
function updateChatView() {
  if (!currentChannel) {
    channelTitleEl.textContent = 'Выберите канал';
    chatMessagesEl.innerHTML = '<div style="opacity:.7">Нет сообщений</div>';
    userListEl.innerHTML = '';
    messageInputEl.disabled = true;
    sendMessageBtn.disabled = true;
    deleteChannelBtn.style.display = 'none';
  } else openChannel(currentChannel);
}

init();
