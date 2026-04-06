const statusEl = document.getElementById("status");
const formEl = document.getElementById("chat-form");
const createRoomFormEl = document.getElementById("create-room-form");
const messageEl = document.getElementById("message");
const messagesEl = document.getElementById("messages");
const roomsEl = document.getElementById("rooms");
const roomNameEl = document.getElementById("room-name");
const authFormEl = document.getElementById("auth-form");
const authUsernameEl = document.getElementById("auth-username");
const authPasswordEl = document.getElementById("auth-password");
const registerBtnEl = document.getElementById("register-btn");
const loginBtnEl = document.getElementById("login-btn");
const authUserEl = document.getElementById("auth-user");
const logoutBtnEl = document.getElementById("logout-btn");
const themeBtnEl = document.getElementById("theme-btn");

const savedName = localStorage.getItem("chat_auth_username");
if (savedName) authUsernameEl.value = savedName;

let rooms = [];
let currentRoomId = localStorage.getItem("chat_room_id") || "general";
let currentUser = null;
let roomRestored = false;

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

function updateAuthUi() {
  const isAuthed = Boolean(currentUser);
  authUserEl.textContent = isAuthed ? `Пользователь: ${currentUser}` : "Не авторизован";
  logoutBtnEl.disabled = !isAuthed;
  messageEl.disabled = !isAuthed;
  formEl.querySelector("button[type='submit']").disabled = !isAuthed;
  authFormEl.style.display = isAuthed ? "none" : "grid";
  if (isAuthed) {
    authPasswordEl.value = "";
  }
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appendMessage(message) {
  const item = document.createElement("article");
  item.className = "message";

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

    if (
      data.type === "room_history" &&
      data.payload &&
      Array.isArray(data.payload.history)
    ) {
      currentRoomId = data.payload.roomId;
      localStorage.setItem("chat_room_id", currentRoomId);
      renderRooms();
      messagesEl.innerHTML = "";
      data.payload.history.forEach(appendMessage);
      return;
    }

    if (data.type === "message" && data.payload) {
      if (data.payload.roomId !== currentRoomId) return;
      appendMessage(data.payload);
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

  ws.send(
    JSON.stringify({
      type: "message",
      roomId: currentRoomId,
      text,
    })
  );

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

updateAuthUi();
