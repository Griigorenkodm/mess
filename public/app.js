const statusEl = document.getElementById("status");
const formEl = document.getElementById("chat-form");
const createRoomFormEl = document.getElementById("create-room-form");
const messageEl = document.getElementById("message");
const messagesEl = document.getElementById("messages");
const roomsEl = document.getElementById("rooms");
const usersEl = document.getElementById("users");
const roomNameEl = document.getElementById("room-name");
const authFormEl = document.getElementById("auth-form");
const authUsernameEl = document.getElementById("auth-username");
const authPasswordEl = document.getElementById("auth-password");
const registerBtnEl = document.getElementById("register-btn");
const loginBtnEl = document.getElementById("login-btn");
const authUserEl = document.getElementById("auth-user");
const logoutBtnEl = document.getElementById("logout-btn");
const themeBtnEl = document.getElementById("theme-btn");
const modeRoomsBtnEl = document.getElementById("mode-rooms-btn");
const modeDmsBtnEl = document.getElementById("mode-dms-btn");
const sidebarTitleEl = document.getElementById("sidebar-title");
const authScreenEl = document.getElementById("auth-screen");
const messengerShellEl = document.getElementById("messenger-shell");
const backToListBtnEl = document.getElementById("back-to-list-btn");

const savedName = localStorage.getItem("chat_auth_username");
if (savedName) authUsernameEl.value = savedName;

let rooms = [];
let users = [];
let currentRoomId = localStorage.getItem("chat_room_id") || "general";
let currentDmUser = localStorage.getItem("chat_dm_user") || "";
let currentUser = null;
let roomRestored = false;
let chatMode = localStorage.getItem("chat_mode") === "dm" ? "dm" : "room";
let isChatOpen = false;

function updateMainView(openChat) {
  isChatOpen = Boolean(openChat);
  messengerShellEl.classList.toggle("chat-open", isChatOpen);
}

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = normalized;
  themeBtnEl.textContent = normalized === "light" ? "Тема: День" : "Тема: Ночь";
  localStorage.setItem("chat_theme", normalized);
}

applyTheme(localStorage.getItem("chat_theme") || "dark");

function setStatus(isConnected) {
  statusEl.textContent = isConnected ? "Подключено" : "Отключено";
  statusEl.classList.toggle("connected", isConnected);
  statusEl.classList.toggle("disconnected", !isConnected);
}

function setChatMode(nextMode) {
  chatMode = nextMode === "dm" ? "dm" : "room";
  localStorage.setItem("chat_mode", chatMode);
  const roomMode = chatMode === "room";
  modeRoomsBtnEl.classList.toggle("active", roomMode);
  modeDmsBtnEl.classList.toggle("active", !roomMode);
  roomsEl.style.display = roomMode ? "flex" : "none";
  usersEl.style.display = roomMode ? "none" : "flex";
  createRoomFormEl.style.display = roomMode ? "grid" : "none";
  sidebarTitleEl.textContent = roomMode ? "Чаты" : "Личные переписки";
  messagesEl.innerHTML = "";
}

function updateAuthUi() {
  const isAuthed = Boolean(currentUser);
  authUserEl.textContent = isAuthed ? `Пользователь: ${currentUser}` : "Не авторизован";
  logoutBtnEl.disabled = !isAuthed;
  messageEl.disabled = !isAuthed;
  formEl.querySelector("button[type='submit']").disabled = !isAuthed;
  authScreenEl.style.display = isAuthed ? "none" : "grid";
  messengerShellEl.style.display = isAuthed ? "grid" : "none";
  if (isAuthed) {
    authPasswordEl.value = "";
  }
  if (!isAuthed) {
    currentDmUser = "";
    usersEl.innerHTML = "";
    updateMainView(false);
  }
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function removeMessageFromView(messageId) {
  if (!messageId) return;
  const item = messagesEl.querySelector(`[data-message-id="${messageId}"]`);
  if (item) item.remove();
}

function appendMessage(message) {
  const item = document.createElement("article");
  item.className = "message";
  if (message.id) item.dataset.messageId = message.id;

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const user = document.createElement("span");
  user.className = "message-username";
  user.textContent = message.username;

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatTime(message.createdAt);

  meta.append(user, time);

  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = message.text;

  if (message.canDelete && message.id) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "message-delete-btn";
    delBtn.textContent = "Удалить";
    delBtn.addEventListener("click", () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (message.kind === "dm") {
        ws.send(
          JSON.stringify({
            type: "delete_dm_message",
            withUser: message.withUser,
            messageId: message.id,
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "delete_message",
            roomId: message.roomId,
            messageId: message.id,
          })
        );
      }
    });
    meta.append(delBtn);
  }

  item.append(meta, text);
  messagesEl.append(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderRooms() {
  roomsEl.innerHTML = "";
  for (const room of rooms) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `room-btn${room.id === currentRoomId ? " active" : ""}`;
    btn.textContent = room.name;
    btn.addEventListener("click", () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      currentRoomId = room.id;
      localStorage.setItem("chat_room_id", currentRoomId);
      renderRooms();
      updateMainView(true);
      ws.send(
        JSON.stringify({
          type: "switch_room",
          roomId: room.id,
        })
      );
    });
    roomsEl.append(btn);
  }
}

function renderUsers() {
  usersEl.innerHTML = "";
  const visibleUsers = users.filter((u) => u !== currentUser);
  for (const username of visibleUsers) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `room-btn${username === currentDmUser ? " active" : ""}`;
    btn.textContent = username;
    btn.addEventListener("click", () => {
      if (!currentUser) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      currentDmUser = username;
      localStorage.setItem("chat_dm_user", currentDmUser);
      renderUsers();
      updateMainView(true);
      ws.send(
        JSON.stringify({
          type: "switch_dm",
          withUser: username,
        })
      );
    });
    usersEl.append(btn);
  }
}

const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${location.host}`);

ws.addEventListener("open", () => setStatus(true));
ws.addEventListener("close", () => setStatus(false));
ws.addEventListener("error", () => setStatus(false));

ws.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === "auth_state" && data.payload) {
      currentUser = data.payload.username || null;
      updateAuthUi();
      return;
    }

    if (data.type === "error" && data.payload && data.payload.text) {
      alert(data.payload.text);
      return;
    }

    if (data.type === "rooms" && Array.isArray(data.payload)) {
      rooms = data.payload;
      const hasCurrent = rooms.some((room) => room.id === currentRoomId);
      if (!hasCurrent && rooms.length) currentRoomId = rooms[0].id;
      renderRooms();
      if (!roomRestored && ws.readyState === WebSocket.OPEN) {
        roomRestored = true;
        ws.send(
          JSON.stringify({
            type: "switch_room",
            roomId: currentRoomId,
          })
        );
      }
      return;
    }

    if (data.type === "users" && Array.isArray(data.payload)) {
      users = data.payload;
      const hasCurrentDm = users.includes(currentDmUser) && currentDmUser !== currentUser;
      if (!hasCurrentDm) {
        currentDmUser = "";
      }
      renderUsers();
      return;
    }

    if (
      data.type === "room_history" &&
      data.payload &&
      Array.isArray(data.payload.history)
    ) {
      currentRoomId = data.payload.roomId;
      localStorage.setItem("chat_room_id", currentRoomId);
      renderRooms();
      updateMainView(true);
      messagesEl.innerHTML = "";
      data.payload.history.forEach((message) =>
        appendMessage({
          ...message,
          kind: "room",
          canDelete: message.username === currentUser,
        })
      );
      return;
    }

    if (
      data.type === "dm_history" &&
      data.payload &&
      typeof data.payload.withUser === "string" &&
      Array.isArray(data.payload.history)
    ) {
      currentDmUser = data.payload.withUser;
      localStorage.setItem("chat_dm_user", currentDmUser);
      renderUsers();
      updateMainView(true);
      if (chatMode === "dm") {
        messagesEl.innerHTML = "";
        data.payload.history.forEach((item) => {
          appendMessage({
            id: item.id,
            username: item.from,
            text: item.text,
            createdAt: item.createdAt,
            kind: "dm",
            withUser: data.payload.withUser,
            canDelete: item.from === currentUser,
          });
        });
      }
      return;
    }

    if (data.type === "message" && data.payload) {
      if (chatMode !== "room" || data.payload.roomId !== currentRoomId) return;
      appendMessage({
        ...data.payload,
        kind: "room",
        canDelete: data.payload.username === currentUser,
      });
      return;
    }

    if (data.type === "dm_message" && data.payload && data.payload.message) {
      const peer = data.payload.withUser;
      if (chatMode !== "dm" || peer !== currentDmUser) return;
      appendMessage({
        id: data.payload.message.id,
        username: data.payload.message.from,
        text: data.payload.message.text,
        createdAt: data.payload.message.createdAt,
        kind: "dm",
        withUser: peer,
        canDelete: data.payload.message.from === currentUser,
      });
      return;
    }

    if (data.type === "message_deleted" && data.payload) {
      if (data.payload.roomId !== currentRoomId) return;
      removeMessageFromView(data.payload.messageId);
      return;
    }

    if (data.type === "dm_message_deleted" && data.payload) {
      if (chatMode !== "dm" || data.payload.withUser !== currentDmUser) return;
      removeMessageFromView(data.payload.messageId);
    }
  } catch (error) {
    console.error("Incoming message parse failed:", error);
  }
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = messageEl.value.trim();

  if (!currentUser || !text) return;
  if (ws.readyState !== WebSocket.OPEN) return;

  if (chatMode === "room") {
    ws.send(
      JSON.stringify({
        type: "message",
        roomId: currentRoomId,
        text,
      })
    );
  } else {
    if (!currentDmUser) {
      alert("Выберите пользователя для личной переписки.");
      return;
    }
    ws.send(
      JSON.stringify({
        type: "dm_message",
        toUser: currentDmUser,
        text,
      })
    );
  }

  messageEl.value = "";
  messageEl.focus();
});

createRoomFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = roomNameEl.value.trim();
  if (!name) return;
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: "create_room",
      name,
    })
  );
  roomNameEl.value = "";
  roomNameEl.focus();
});

authFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
});

function sendAuth(mode) {
  const username = authUsernameEl.value.trim();
  const password = authPasswordEl.value.trim();
  if (!username || !password) return;
  if (ws.readyState !== WebSocket.OPEN) return;

  localStorage.setItem("chat_auth_username", username);
  ws.send(
    JSON.stringify({
      type: "auth",
      mode,
      username,
      password,
    })
  );
}

registerBtnEl.addEventListener("click", () => sendAuth("register"));
loginBtnEl.addEventListener("click", () => sendAuth("login"));

logoutBtnEl.addEventListener("click", () => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "logout" }));
});

themeBtnEl.addEventListener("click", () => {
  const currentTheme = document.body.dataset.theme === "light" ? "light" : "dark";
  applyTheme(currentTheme === "light" ? "dark" : "light");
});

modeRoomsBtnEl.addEventListener("click", () => {
  setChatMode("room");
  updateMainView(false);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "switch_room", roomId: currentRoomId }));
  }
});

modeDmsBtnEl.addEventListener("click", () => {
  setChatMode("dm");
  updateMainView(false);
  if (ws.readyState === WebSocket.OPEN && currentDmUser) {
    ws.send(JSON.stringify({ type: "switch_dm", withUser: currentDmUser }));
  }
});

backToListBtnEl.addEventListener("click", () => {
  updateMainView(false);
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 900) {
    updateMainView(true);
  }
});

updateAuthUi();
setChatMode(chatMode);
if (window.innerWidth > 900) {
  updateMainView(true);
} else {
  updateMainView(false);
}
