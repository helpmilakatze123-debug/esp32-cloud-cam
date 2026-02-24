import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";
import auth from "basic-auth";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Kamera-Verbindung
let camera = null;
let cameraVersion = null;
let streaming = false;

// Alle Viewer
const viewers = new Set();

// Auflösung
let currentResolution = "VGA";

// OTA Firmware Beispiel
let latestFirmware = {
  version: "1.0.0",
  url: "https://raw.githubusercontent.com/USER/REPO/main/firmware.bin"
};

// --- HTTP Basic Auth ---
const USERNAME = "admin";
const PASSWORD = "geheim";

function authMiddleware(req, res, next) {
  const user = auth(req);
  if (!user || user.name !== USERNAME || user.pass !== PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="ESP32-CAM"');
    return res.status(401).send("Authentication required.");
  }
  next();
}

// --- Webinterface ---
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.send("OK"));
app.get("/firmware", (req, res) => res.json(latestFirmware));

// --- WebSocket Handling ---
wss.on("connection", (ws, req) => {
  const path = req.url;

  if (path === "/camera") {
    camera = ws;
    console.log("Camera connected");

    ws.on("message", (msg) => {
      if (typeof msg === "string") {
        try {
          const data = JSON.parse(msg);
          if (data.type === "camera_register") {
            cameraVersion = data.version;
            console.log("Camera firmware:", cameraVersion);
          }
          if (data.type === "health") {
            // optional
          }
          if (data.type === "update_result") {
            console.log("OTA result:", data.status);
          }
        } catch {}
      } else {
        // Binary MJPEG -> an alle Viewer senden
        viewers.forEach(v => {
          if (v.readyState === WebSocket.OPEN) v.send(msg);
        });
      }
    });

    ws.on("close", () => {
      console.log("Camera disconnected");
      camera = null;
      streaming = false;
    });
  }

  if (path === "/viewer") {
    viewers.add(ws);
    console.log("Viewer connected");

    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);
        if (!camera || camera.readyState !== WebSocket.OPEN) return;

        switch (data.type) {
          case "start_stream":
            camera.send(JSON.stringify({ type: "start_stream" }));
            streaming = true;
            break;
          case "stop_stream":
            camera.send(JSON.stringify({ type: "stop_stream" }));
            streaming = false;
            break;
          case "set_resolution":
            currentResolution = data.value;
            camera.send(JSON.stringify({ type: "set_resolution", value: data.value }));
            break;
        }
      } catch {}
    });

    ws.on("close", () => {
      viewers.delete(ws);
      console.log("Viewer disconnected");
    });
  }
});

// --- Firmware Check alle 10 Minuten ---
async function checkFirmware() {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/USER/REPO/main/version.json"
    );
    const data = await res.json();

    if (data.version !== latestFirmware.version) {
      latestFirmware = data;
      console.log("New firmware:", data.version);

      if (camera && camera.readyState === WebSocket.OPEN) {
        camera.send(JSON.stringify({
          type: "update_available",
          version: data.version,
          url: data.url
        }));
      }
    }
  } catch {
    console.log("Firmware check failed");
  }
}

setInterval(checkFirmware, 10 * 60 * 1000);

// --- Server starten ---
server.listen(PORT, () => console.log("Server running on port", PORT));
