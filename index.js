import { WebSocketServer } from "ws";
import { createClient } from "redis";
import { v4 } from "uuid";

const publisher = createClient();
await publisher.connect();

const wss = new WebSocketServer({ port: 8080 });
const connections = {};
wss.on("connection", async (socket) => {
  const uuid = v4();

  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (rawData) => {
    await publisher.publish("chat", rawData.toString());

    console.log("wss --> redis:", JSON.parse(rawData.toString()));
  });

  socket.on("close", () => {
    delete connections[uuid];
    console.log("closing");
  });

  socket.send(
    JSON.stringify({
      type: "welcome",
      connected_at: new Date().toISOString(),
    }),
  );

  connections[uuid] = socket;
  console.log(Object.keys(connections));
});

const subscriber = createClient();
await subscriber.connect();
await subscriber.subscribe("chat", (message) => {
  console.log("redis --> wss:", message);

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
