import { createClient } from "redis";
import { v4 } from "uuid";
import WebSocket, { WebSocketServer } from "ws";

interface ClientSocket extends WebSocket {
  isAlive: boolean;
}

const publisher = createClient();
await publisher.connect();

const websocketServerFactory = (
  port: number,
): Promise<{ wss: WebSocketServer; port: number }> => {
  return new Promise<{ wss: WebSocketServer; port: number }>((resolve) => {
    let wss = new WebSocketServer({ port });

    wss.on("error", () => resolve(websocketServerFactory(port + 1)));

    wss.on("listening", () => resolve({ wss, port }));
  });
};
let { wss, port } = await websocketServerFactory(8080);
console.log(`started wss on port ${port}`);
const connections: Record<string, ClientSocket> = {};

wss.on("connection", async (socket) => {
  const client = socket as ClientSocket;
  const uuid = v4();

  client.isAlive = true;

  client.on("pong", () => {
    client.isAlive = true;
  });

  client.on("message", async (rawData) => {
    await publisher.publish("chat", rawData.toString());

    console.log("wss --> redis:", JSON.parse(rawData.toString()));
  });

  client.on("close", () => {
    delete connections[uuid];
    console.log("closing");
  });

  client.send(
    JSON.stringify({
      type: "welcome",
      connected_at: new Date().toISOString(),
    }),
  );

  connections[uuid] = client;
  console.log(Object.keys(connections));
});

const subscriber = createClient();
await subscriber.connect();
await subscriber.subscribe("chat", (message) => {
  console.log(
    "redis --> wss:",
    message,
    `across ${Object.values(connections).length} socket(s)`,
  );

  Object.values(connections).forEach((socket) => socket.send(message));
});

const shutdown = async () => {
  try {
    console.log("SIGTERM received. Shutting down Redis subscriber.");
    await subscriber.quit();
    await publisher.quit();
  } catch {
    subscriber.destroy();
    publisher.destroy();
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
