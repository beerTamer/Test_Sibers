const USERS_JSON_URL = 'https://hr2.sibers.com/test/frontend/users.json';
const STORAGE_KEY = 'rtchat_v5_channels';
const BC_NAME = 'rtchat_v5_bc';

let users = [];
let channels = {};      // {id, name, owner, public, users:[names], messages:[{userName,text,ts}]}
let currentUser = null; // stores the name of the logged in user
let currentChannel = null;

const bc = new BroadcastChannel(BC_NAME);

/* Helpers */
function uid(prefix = 'id') { return prefix + '_' + Math.random().toString(36).slice(2, 9); }
function saveChannels() { localStorage.setItem(STORAGE_KEY, JSON.stringify(channels)); }
function loadChannels() { channels = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
function initials(name) { return name ? name.split(' ').map(p => p[0]).join('').toUpperCase() : '?'; }

/* DOM refs */
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

/* Init */
async function init() {
  loadChannels();
  await loadUsers();
  populateLoginSelect();

  const prev = sessionStorage.getItem('rtchat_user');
  if (prev && users.some(u => u.name === prev)) userSelect.value = prev;

  loginBtn.onclick = onLogin;
  createChannelBtn.onclick = onCreateChannel;
  deleteChannelBtn.onclick = onDeleteChannel;
  sendMessageBtn.onclick = onSendMessage;
  messageInputEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); onSendMessage(); } };
  searchInputEl.oninput = renderSearchResults;

  bc.onmessage = onBCMessage;

  renderChannelList();
  updateChatView();
}

async function loadUsers() {
  try {
    const res = await fetch(USERS_JSON_URL);
    const data = await res.json();
    users = data.map(u => ({ name: u.name }));
  } catch {
    // fallback users in case fetch fails
    users = [
      { name: 'Alice Cooper' },
      { name: 'Bob Marley' },
      { name: 'Carl Sagan' },
      { name: 'Diana Prince' }
    ];
  }
}

/* Login */
function populateLoginSelect() {
  userSelect.innerHTML = users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
}
function onLogin() {
  currentUser = userSelect.value;
  sessionStorage.setItem('rtchat_user', currentUser);
  loginModal.style.display = 'none';
  appRoot.style.display = 'grid';
  renderChannelList();
  updateChatView();
}

/* Channels */
function onCreateChannel() {
  if (!currentUser) return;
  const name = prompt('Название канала:');
  if (!name) return;

  // Public = anyone can join
  // Private = only invited users can join
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

  // Only the owner can delete the channel
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
    li.innerHTML = `
      <div>${ch.name}</div>
      <div class="ch-meta">${ch.users.length} участн. ${ch.public ? '• публичный' : '• приватный'}</div>
    `;
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

  // Show delete button only if current user is the owner
  deleteChannelBtn.style.display = (ch.owner === currentUser) ? 'inline-block' : 'none';

  const isMember = ch.users.includes(currentUser);
  messageInputEl.disabled = !isMember;
  sendMessageBtn.disabled = !isMember;

  renderMessages();
  renderUsers();
}

function joinChannel(id, userName) {
  const ch = channels[id];
  if (!ch) return;
  if (!ch.users.includes(userName)) ch.users.push(userName);
  saveChannels();
  bc.postMessage({ type: 'updateUsers', channelId: id, users: ch.users });
  openChannel(id);
}

/* Users */
function renderUsers() {
  userListEl.innerHTML = '';
  const ch = channels[currentChannel];
  if (!ch) return;

  ch.users.forEach(uName => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="user-entry">
        <div class="avatar">${initials(uName)}</div>
        ${uName} ${uName === ch.owner ? '<span class="owner-label">(владелец)</span>' : ''}
      </div>
    `;

    // Owner can kick other users (only in private channels!)
    if (!ch.public && ch.owner === currentUser && uName !== currentUser) {
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.title = 'Удалить пользователя';
      btn.onclick = () => kickUser(currentChannel, uName);
      li.appendChild(btn);
    }
    userListEl.appendChild(li);
  });
}

function kickUser(channelId, uName) {
  const ch = channels[channelId];
  if (!ch || ch.owner !== currentUser) return;

  ch.users = ch.users.filter(u => u !== uName);
  saveChannels();
  bc.postMessage({ type: 'updateUsers', channelId, users: ch.users });
  renderUsers();
}

/* Search & add */
function renderSearchResults() {
  const q = searchInputEl.value.toLowerCase();
  searchResultsEl.innerHTML = '';
  const ch = channels[currentChannel];
  if (!ch) return;

  const arr = users.filter(u =>
    !ch.users.includes(u.name) &&
    u.name.toLowerCase().includes(q)
  );

  arr.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `${u.name} <button>Добавить</button>`;
    li.querySelector('button').onclick = () => {
      if (!ch.users.includes(u.name)) {
        ch.users.push(u.name);
        saveChannels();
        bc.postMessage({ type: 'updateUsers', channelId: currentChannel, users: ch.users });
        renderUsers();
        renderSearchResults();
      }
    };
    searchResultsEl.appendChild(li);
  });
}

/* Messages */
function onSendMessage() {
  const txt = messageInputEl.value.trim();
  if (!txt) return;
  const ch = channels[currentChannel];
  if (!ch || !ch.users.includes(currentUser)) return;

  const m = { id: uid('m'), userName: currentUser, text: txt, ts: Date.now() };
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
    div.className = 'message' + (m.userName === currentUser ? ' self' : '');
    div.innerHTML = `
      <div class="avatar">${initials(m.userName)}</div>
      <div class="message-content">
        <strong>${m.userName}</strong>
        <div>${m.text}</div>
        <div class="msg-time">${new Date(m.ts).toLocaleTimeString()}</div>
      </div>`;
    chatMessagesEl.appendChild(div);
  });
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/* Broadcast sync */
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

/* View */
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
