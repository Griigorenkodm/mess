const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const localtunnel = require("localtunnel");
const WebSocket = require("ws");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");
const DMS_FILE = path.join(DATA_DIR, "dms.json");
const ENABLE_PUBLIC_TUNNEL =
  process.argv.includes("--public") || process.env.PUBLIC_TUNNEL === "1";
const LOCALTUNNEL_SUBDOMAIN =
  typeof process.env.LT_SUBDOMAIN === "string"
    ? process.env.LT_SUBDOMAIN.trim()
    : "";
const MAX_HISTORY_PER_ROOM = 100;
const BOT_NAME = "ПриветБот";
const DEFAULT_ROOMS = [
  { id: "general", name: "Общий" },
  { id: "support", name: "Поддержка" },
  { id: "games", name: "Игры" },
];

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

const server = http.createServer((req, res) => {
  let reqPath = req.url === "/" ? "/index.html" : req.url;
  reqPath = reqPath.split("?")[0];

  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

function createDefaultRooms() {
  const map = new Map();
  for (const room of DEFAULT_ROOMS) {
    map.set(room.id, { id: room.id, name: room.name, history: [] });
  }
  return map;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function normalizeHistory(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.roomId === "string" &&
        typeof item.username === "string" &&
        typeof item.text === "string" &&
        typeof item.createdAt === "string"
    )
    .slice(-MAX_HISTORY_PER_ROOM);
}

const users = new Map();
const rooms = createDefaultRooms();
const dmStore = new Map();
let saveTimer = null;

function loadState() {
  const loadedUsers = readJsonSafe(USERS_FILE, {});
  for (const [username, password] of Object.entries(loadedUsers)) {
    if (typeof username === "string" && typeof password === "string") {
      users.set(username, password);
    }
  }

  const loadedRooms = readJsonSafe(ROOMS_FILE, []);
  if (Array.isArray(loadedRooms)) {
    for (const room of loadedRooms) {
      if (!room || typeof room !== "object") continue;
      if (typeof room.id !== "string" || typeof room.name !== "string") continue;
      rooms.set(room.id, {
        id: room.id,
        name: room.name.slice(0, 32),
        history: normalizeHistory(room.history),
      });
    }
  }

  const loadedDms = readJsonSafe(DMS_FILE, []);
  if (Array.isArray(loadedDms)) {
    for (const dm of loadedDms) {
      if (!dm || typeof dm !== "object") continue;
      if (typeof dm.key !== "string") continue;
      dmStore.set(dm.key, normalizeDmHistory(dm.history));
    }
  }
}

function persistState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const usersObj = Object.fromEntries(users);
    const roomsArr = [...rooms.values()].map((room) => ({
      id: room.id,
      name: room.name,
      history: normalizeHistory(room.history),
    }));
    const dmsArr = [...dmStore.entries()].map(([key, history]) => ({
      key,
      history: normalizeDmHistory(history),
    }));
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersObj, null, 2), "utf8");
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomsArr, null, 2), "utf8");
    fs.writeFileSync(DMS_FILE, JSON.stringify(dmsArr, null, 2), "utf8");
  } catch (error) {
    console.error("Save state failed:", error.message);
  }
}

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistState();
    saveTimer = null;
  }, 250);
}

loadState();

function roomList() {
  return [...rooms.values()].map((room) => ({ id: room.id, name: room.name }));
}

function userList() {
  return [...users.keys()].sort((a, b) => a.localeCompare(b, "ru"));
}

function sendToClient(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendBotMessage(ws, roomId, text) {
  sendToClient(ws, {
    type: "message",
    payload: {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      roomId,
      username: BOT_NAME,
      text,
      createdAt: new Date().toISOString(),
    },
  });
}

function broadcast(payload) {
  const json = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

function broadcastUsers() {
  broadcast({ type: "users", payload: userList() });
}

function broadcastToRoom(roomId, payload) {
  const json = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.roomId !== roomId) continue;
    client.send(json);
  }
}

function sanitizeRoomName(name) {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, 32);
}

function normalizeDmHistory(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.from === "string" &&
        typeof item.to === "string" &&
        typeof item.text === "string" &&
        typeof item.createdAt === "string"
    )
    .slice(-MAX_HISTORY_PER_ROOM);
}

function dmKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y, "ru")).join("::");
}

function sendDmHistory(ws, peerUser) {
  if (!ws.user) return;
  const key = dmKey(ws.user, peerUser);
  const history = dmStore.get(key) || [];
  sendToClient(ws, {
    type: "dm_history",
    payload: {
      withUser: peerUser,
      history,
    },
  });
}

function sendDmToUser(user, payload) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.user !== user) continue;
    sendToClient(client, payload);
  }
}

function dmContactsForUser(username) {
  const result = [];
  for (const [key, history] of dmStore.entries()) {
    if (!Array.isArray(history) || history.length === 0) continue;
    const parts = key.split("::");
    if (parts.length !== 2) continue;
    const [a, b] = parts;
    if (username !== a && username !== b) continue;
    const otherUser = username === a ? b : a;
    const lastMessage = history[history.length - 1];
    result.push({ username: otherUser, lastAt: lastMessage.createdAt });
  }

  result.sort((x, y) => y.lastAt.localeCompare(x.lastAt));
  return result.map((item) => item.username);
}

function sendDmContacts(user) {
  sendDmToUser(user, {
    type: "dm_contacts",
    payload: dmContactsForUser(user),
  });
}

function makeRoomId(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  const prefix = base || "chat";
  let candidate = prefix;
  let i = 2;
  while (rooms.has(candidate)) {
    candidate = `${prefix}-${i}`;
    i += 1;
  }
  return candidate;
}

wss.on("connection", (ws) => {
  ws.roomId = "general";
  ws.user = null;
  ws.dmWithUser = null;
  ws.visitedRooms = new Set(["general"]);
  sendToClient(ws, { type: "auth_state", payload: { username: null } });
  sendToClient(ws, { type: "rooms", payload: roomList() });
  sendToClient(ws, { type: "users", payload: userList() });
  sendToClient(ws, {
    type: "room_history",
    payload: {
      roomId: ws.roomId,
      history: rooms.get(ws.roomId).history,
    },
  });

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === "switch_room") {
        const nextRoomId =
          typeof data.roomId === "string" ? data.roomId.trim() : "";
        if (!rooms.has(nextRoomId)) return;

        ws.roomId = nextRoomId;
        sendToClient(ws, {
          type: "room_history",
          payload: {
            roomId: nextRoomId,
            history: rooms.get(nextRoomId).history,
          },
        });
        if (ws.user && !ws.visitedRooms.has(nextRoomId)) {
          ws.visitedRooms.add(nextRoomId);
          sendBotMessage(
            ws,
            nextRoomId,
            `Добро пожаловать в чат "${rooms.get(nextRoomId).name}", ${ws.user}!`
          );
        }
        return;
      }

      if (data.type === "switch_dm") {
        if (!ws.user) return;
        const peerUser =
          typeof data.withUser === "string" ? data.withUser.trim() : "";
        if (!peerUser || peerUser === ws.user || !users.has(peerUser)) return;
        ws.dmWithUser = peerUser;
        sendDmHistory(ws, peerUser);
        return;
      }

      if (data.type === "auth") {
        const mode = data.mode === "register" ? "register" : "login";
        const username =
          typeof data.username === "string" ? data.username.trim().slice(0, 24) : "";
        const password =
          typeof data.password === "string" ? data.password.trim().slice(0, 64) : "";

        if (!username || !password) {
          sendToClient(ws, {
            type: "error",
            payload: { text: "Введите логин и пароль." },
          });
          return;
        }

        if (mode === "register") {
          if (users.has(username)) {
            sendToClient(ws, {
              type: "error",
              payload: { text: "Такой пользователь уже существует." },
            });
            return;
          }
          users.set(username, password);
          schedulePersist();
          ws.user = username;
          broadcastUsers();
          sendToClient(ws, {
            type: "auth_state",
            payload: { username },
          });
          sendDmContacts(username);
          sendBotMessage(
            ws,
            ws.roomId,
            `Привет, ${username}! Рад тебя видеть. Выбери чат слева или создай новый.`
          );
          return;
        }

        if (!users.has(username) || users.get(username) !== password) {
          sendToClient(ws, {
            type: "error",
            payload: { text: "Неверный логин или пароль." },
          });
          return;
        }

        ws.user = username;
        broadcastUsers();
        sendToClient(ws, {
          type: "auth_state",
          payload: { username },
        });
        sendDmContacts(username);
        sendBotMessage(
          ws,
          ws.roomId,
          `С возвращением, ${username}! Хорошего общения.`
        );
        return;
      }

      if (data.type === "logout") {
        ws.user = null;
        ws.dmWithUser = null;
        broadcastUsers();
        sendToClient(ws, { type: "auth_state", payload: { username: null } });
        return;
      }

      if (data.type === "create_room") {
        const roomName = sanitizeRoomName(data.name);
        if (!roomName) return;

        const roomId = makeRoomId(roomName);
        rooms.set(roomId, { id: roomId, name: roomName, history: [] });
        schedulePersist();
        broadcast({ type: "rooms", payload: roomList() });
        return;
      }

      if (data.type === "delete_message") {
        if (!ws.user) return;
        const roomId = typeof data.roomId === "string" ? data.roomId.trim() : "";
        const messageId =
          typeof data.messageId === "string" ? data.messageId.trim() : "";
        if (!roomId || !messageId || !rooms.has(roomId)) return;

        const room = rooms.get(roomId);
        const idx = room.history.findIndex((m) => m.id === messageId);
        if (idx < 0) return;
        if (room.history[idx].username !== ws.user) return;

        room.history.splice(idx, 1);
        schedulePersist();
        broadcastToRoom(roomId, {
          type: "message_deleted",
          payload: { roomId, messageId },
        });
        return;
      }

      if (data.type === "dm_message") {
        if (!ws.user) {
          sendToClient(ws, {
            type: "error",
            payload: { text: "Сначала зарегистрируйтесь или войдите." },
          });
          return;
        }

        const toUser = typeof data.toUser === "string" ? data.toUser.trim() : "";
        const text =
          typeof data.text === "string" && data.text.trim()
            ? data.text.trim().slice(0, 500)
            : "";
        if (!toUser || toUser === ws.user || !users.has(toUser) || !text) return;

        const message = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          from: ws.user,
          to: toUser,
          text,
          createdAt: new Date().toISOString(),
        };

        const key = dmKey(ws.user, toUser);
        const history = dmStore.get(key) || [];
        history.push(message);
        if (history.length > MAX_HISTORY_PER_ROOM) history.shift();
        dmStore.set(key, history);
        schedulePersist();

        const payload = {
          type: "dm_message",
          payload: {
            withUser: toUser,
            message,
          },
        };
        sendDmToUser(ws.user, payload);
        sendDmToUser(toUser, {
          type: "dm_message",
          payload: {
            withUser: ws.user,
            message,
          },
        });
        sendDmContacts(ws.user);
        sendDmContacts(toUser);
        return;
      }

      if (data.type === "delete_dm_message") {
        if (!ws.user) return;
        const withUser =
          typeof data.withUser === "string" ? data.withUser.trim() : "";
        const messageId =
          typeof data.messageId === "string" ? data.messageId.trim() : "";
        if (!withUser || !messageId || !users.has(withUser)) return;

        const key = dmKey(ws.user, withUser);
        const history = dmStore.get(key) || [];
        const idx = history.findIndex((m) => m.id === messageId);
        if (idx < 0) return;
        if (history[idx].from !== ws.user) return;

        history.splice(idx, 1);
        dmStore.set(key, history);
        schedulePersist();

        sendDmToUser(ws.user, {
          type: "dm_message_deleted",
          payload: { withUser, messageId },
        });
        sendDmToUser(withUser, {
          type: "dm_message_deleted",
          payload: { withUser: ws.user, messageId },
        });
        sendDmContacts(ws.user);
        sendDmContacts(withUser);
        return;
      }

      if (data.type !== "message") return;
      if (!ws.user) {
        sendToClient(ws, {
          type: "error",
          payload: { text: "Сначала зарегистрируйтесь или войдите." },
        });
        return;
      }

      const text =
        typeof data.text === "string" && data.text.trim()
          ? data.text.trim().slice(0, 500)
          : "";

      if (!text) return;

      const roomId =
        typeof data.roomId === "string" && rooms.has(data.roomId)
          ? data.roomId
          : ws.roomId;
      if (!roomId || !rooms.has(roomId)) return;

      const message = {
        type: "message",
        payload: {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          roomId,
          username: ws.user,
          text,
          createdAt: new Date().toISOString(),
        },
      };

      const room = rooms.get(roomId);
      room.history.push(message.payload);
      if (room.history.length > MAX_HISTORY_PER_ROOM) room.history.shift();
      schedulePersist();

      broadcastToRoom(roomId, message);
    } catch (error) {
      sendToClient(ws, {
        type: "error",
        payload: { text: "Некорректный формат сообщения." },
      });
    }
  });

  ws.on("close", () => {
    if (ws.user) {
      broadcastUsers();
    }
  });
});

function getLanUrls(port) {
  const nets = os.networkInterfaces();
  const urls = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4") continue;
      if (net.internal) continue;
      urls.push(`http://${net.address}:${port}`);
    }
  }

  return [...new Set(urls)];
}

let tunnel = null;

async function startPublicTunnel(port) {
  try {
    tunnel = await localtunnel({
      port,
      ...(LOCALTUNNEL_SUBDOMAIN ? { subdomain: LOCALTUNNEL_SUBDOMAIN } : {}),
    });
    console.log("Open from any network (public link):");
    console.log(`- ${tunnel.url}`);
    if (LOCALTUNNEL_SUBDOMAIN) {
      console.log(`Requested subdomain: ${LOCALTUNNEL_SUBDOMAIN}`);
    }
    console.log("If link expires, restart server to get a new one.");

    tunnel.on("close", () => {
      console.log("Public tunnel closed.");
    });
  } catch (error) {
    console.error("Public tunnel start failed:", error.message);
  }
}

server.listen(PORT, HOST, async () => {
  console.log(`Messenger started: http://localhost:${PORT}`);
  const lan = getLanUrls(PORT);
  if (lan.length) {
    console.log("Open on your phone (same Wi‑Fi):");
    for (const url of lan) console.log(`- ${url}`);
  }

  if (ENABLE_PUBLIC_TUNNEL) {
    await startPublicTunnel(PORT);
  } else {
    console.log("To enable internet access use: npm run start:public");
  }
});

process.on("SIGINT", async () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistState();
  if (tunnel) {
    await tunnel.close();
  }
  process.exit(0);
});
