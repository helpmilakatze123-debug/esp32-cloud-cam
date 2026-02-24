import express from "express";
import http from "http";
import WebSocket from "ws";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Kamera-Verbindung
let camera = null;
let cameraVersion = null;
let streaming = false;

// Aktuelle Auflösung
let currentResolution = "VGA";

// Beispiel OTA Firmware (GitHub)
let latestFirmware = {
  version: "1.0.0",
  url: "https://raw.githubusercontent.com/USER/REPO/main/firmware.bin"
};

// HTML Webinterface
app.get("/", (req, res) => {
  res.send(`
<html>
  <body>
    <h2>ESP32 Cloud Camera</h2>
    <img id="stream" width="640"/><br>

    <select id="res">
      <option>QVGA</option>
      <option selected>VGA</option>
      <option>SVGA</option>
      <option>XGA</option>
    </select>
    <button id="start">Start Stream</button>
    <button id="stop">Stop Stream</button>

    <script>
      const ws = new WebSocket("wss://" + location.host + "/viewer");
      const img = document.getElementById("stream");

      ws.binaryType = "arraybuffer";

      ws.onopen = () => console.log("Connected to server");

      ws.onmessage = (event) => {
        if (typeof event.data === "string") return;

        const blob = new Blob([event.data], { type: "image/jpeg" });
        img.src = URL.createObjectURL(blob);
      };

      document.getElementById("res").onchange = (e) => {
        ws.send(JSON.stringify({
          type: "set_resolution",
          value: e.target.value
        }));
      };

      document.getElementById("start").onclick = () => {
        ws.send(JSON.stringify({ type: "start_stream" }));
      };

      document.getElementById("stop").onclick = () => {
        ws.send(JSON.stringify({ type: "stop_stream" }));
      };
    </script>
  </body>
</html>
  `);
});

// Health-Check Endpoint
app.get("/health", (req, res) => {
  res.send("OK");
});

// Firmware Info Endpoint
app.get("/firmware", (req, res) => {
  res.json(latestFirmware);
});

// WebSocket Handling
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
            console.log("Camera firmware version:", cameraVersion);
          }

          if (data.type === "health") {
            // optional: keep alive log
          }

          if (data.type === "update_result") {
            console.log("OTA update result:", data.status);
          }

        } catch (e) {}
      } else {
        // Binary MJPEG Frame -> an alle Viewer senden
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

        if (!camera) return;

        if (data.type === "start_stream") {
          camera.send(JSON.stringify({ type: "start_stream" }));
          streaming = true;
        }

        if (data.type === "stop_stream") {
          camera.send(JSON.stringify({ type: "stop_stream" }));
          streaming = false;
        }

        if (data.type === "set_resolution") {
          currentResolution = data.value;
          camera.send(JSON.stringify({ type: "set_resolution", value: data.value }));
        }

      } catch {}
    });

    ws.on("close", () => {
      viewers.delete(ws);
      console.log("Viewer disconnected");
    });
  }
});

// Alle Viewer speichern
const viewers = new Set();

// Firmware Check alle 10 Minuten
async function checkFirmware() {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/USER/REPO/main/version.json"
    );
    const data = await res.json();

    if (data.version !== latestFirmware.version) {
      latestFirmware = data;
      console.log("New firmware available:", data.version);

      if (camera && camera.readyState === WebSocket.OPEN) {
        camera.send(JSON.stringify({
          type: "update_available",
          version: data.version,
          url: data.url
        }));
      }
    }
  } catch (e) {
    console.log("Firmware check failed");
  }
}

setInterval(checkFirmware, 10 * 60 * 1000); // alle 10 Minuten

// Server starten
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
