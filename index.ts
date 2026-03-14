import {createClient} from "redis";
import {v4} from "uuid";
import WebSocket, {WebSocketServer} from "ws";

const loadbalancerUrl = `http://localhost:3000`;
const removeServer = async () => {
  await fetch(`${loadbalancerUrl}/delete-server`, {
    method: "DELETE",
    body: JSON.stringify({
      name: id,
    })
  })
}

const addServer = async (name: string, url: string) => {
  await fetch(`${loadbalancerUrl}/create-server`, {
    method: "POST",
    body: JSON.stringify({
      name,
      url,
    })
  });
}

interface ClientSocket extends WebSocket {
  isAlive: boolean;
}

const publisher = createClient();
await publisher.connect();

type WebsocketServerInfo = {
  wss: WebSocketServer;
  port: number;
  id: string;
};

const websocketServerFactory = (
    port: number,
): Promise<WebsocketServerInfo> => {
  return new Promise<WebsocketServerInfo>((resolve) => {
    let wss = new WebSocketServer({port});

    wss.on("error", () => resolve(websocketServerFactory(port + 1)));

    wss.on("listening", () => resolve({wss, port, id: v4()}));
  });
};
let {wss, port, id} = await websocketServerFactory(8080);
console.log(`started wss on port ${port}`);
void addServer(id, `ws://localhost:${port}`).catch(() => console.log("oh no"));
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
    await removeServer();
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
