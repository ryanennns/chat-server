import { createClient } from "redis";
import { v4 } from "uuid";
import WebSocket, { WebSocketServer } from "ws";

interface Server {
  id: string;
  url: string;
}

const key = "servers";
const redisClient = createClient();
await redisClient.connect();

const getServerList = async (): Promise<Server[]> =>
  JSON.parse((await redisClient.get(key)) ?? "[]") ?? [];

const removeServer = async (id: string) => {
  await redisClient.set(
    key,
    JSON.stringify(
      (await getServerList()).filter((server: Server) => server.id !== id),
    ),
  );
};

const addServer = async (id: string, url: string) => {
  await redisClient.set(
    key,
    JSON.stringify([...(await getServerList()), { id, url }]),
  );
};

interface ClientSocket extends WebSocket {
  isAlive: boolean;
}

type WebsocketServerInfo = {
  wss: WebSocketServer;
  port: number;
  id: string;
};

const websocketServerFactory = (port: number): Promise<WebsocketServerInfo> => {
  return new Promise<WebsocketServerInfo>((resolve) => {
    let wss = new WebSocketServer({ port });

    wss.on("error", () => resolve(websocketServerFactory(port + 1)));

    wss.on("listening", () => resolve({ wss, port, id: v4() }));
  });
};
let { wss, port, id } = await websocketServerFactory(8080);
console.log(`started wss on port ${port}`);
void addServer(id, `ws://localhost:${port}`).catch((e) =>
  console.log("oh no", e),
);
const connections: Record<string, ClientSocket> = {};

wss.on("connection", async (socket) => {
  const client = socket as ClientSocket;
  const uuid = v4();

  client.isAlive = true;

  client.on("pong", () => {
    client.isAlive = true;
  });

  client.on("message", async (rawData) => {
    await redisClient.publish("chat", rawData.toString());

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
    await removeServer(id);
    await subscriber.quit();
    await redisClient.quit();
  } catch {
    subscriber.destroy();
    redisClient.destroy();
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
