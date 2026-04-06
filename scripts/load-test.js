const WebSocket = require("ws");

const totalClients = Number(process.argv[2] || 200);
const messagesPerClient = Number(process.argv[3] || 3);
const targetUrl = process.argv[4] || "ws://127.0.0.1:3000";

const clients = [];
const stats = {
  connected: 0,
  failed: 0,
  sent: 0,
  received: 0,
  closed: 0,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runClient(index) {
  const username = `load_user_${index}`;
  return new Promise((resolve) => {
    const ws = new WebSocket(targetUrl);
    let authDone = false;

    ws.on("open", () => {
      stats.connected += 1;
      ws.send(
        JSON.stringify({
          type: "auth",
          mode: "register",
          username,
          password: "123456",
        })
      );
    });

    ws.on("message", (raw) => {
      stats.received += 1;
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === "auth_state" && data.payload?.username && !authDone) {
          authDone = true;
          for (let i = 0; i < messagesPerClient; i += 1) {
            ws.send(
              JSON.stringify({
                type: "message",
                roomId: "general",
                text: `hello ${i + 1} from ${username}`,
              })
            );
            stats.sent += 1;
          }
          setTimeout(() => ws.close(), 250);
        }
      } catch (error) {
        // Ignore parse issues for test
      }
    });

    ws.on("error", () => {
      stats.failed += 1;
      resolve();
    });

    ws.on("close", () => {
      stats.closed += 1;
      resolve();
    });
  });
}

async function main() {
  const startedAt = Date.now();
  console.log(
    `Load test started: clients=${totalClients}, messages/client=${messagesPerClient}, url=${targetUrl}`
  );

  for (let i = 1; i <= totalClients; i += 1) {
    clients.push(runClient(i));
    await wait(8);
  }

  await Promise.all(clients);
  const elapsed = Date.now() - startedAt;

  console.log("Load test finished.");
  console.log(`connected: ${stats.connected}`);
  console.log(`failed: ${stats.failed}`);
  console.log(`sent: ${stats.sent}`);
  console.log(`received: ${stats.received}`);
  console.log(`closed: ${stats.closed}`);
  console.log(`elapsed_ms: ${elapsed}`);
}

main().catch((error) => {
  console.error("Load test failed:", error);
  process.exit(1);
});
