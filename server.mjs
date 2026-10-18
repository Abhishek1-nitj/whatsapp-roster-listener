// 24/7 Read-Only Headless WhatsApp Community Roster Listener
// Strictly Read-Only: ZERO message sending capabilities (0% Ban Risk)

import express from "express";
import qrcode from "qrcode";
import pino from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, "auth_session");
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || "120363412628405469@g.us";

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || "silent" });

// In-Memory State
let sock = null;
let currentQR = null;
let connectionStatus = "INITIALIZING"; // INITIALIZING | SCAN_QR | CONNECTED | DISCONNECTED
let connectedUser = null;
let groupMetadataCache = null;
let lastSyncTime = null;

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// -------------------------------------------------------------
// 1. WhatsApp Headless Socket Manager
// -------------------------------------------------------------
async function initWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`\n===============================================================`);
  console.log(`🤖 Starting Headless WhatsApp Roster Listener (Baileys v${version.join(".")})`);
  console.log(`🛡️ Operational Mode   : STRICTLY READ-ONLY (0% Ban Risk)`);
  console.log(`🎯 Target Group ID    : ${TARGET_GROUP_ID}`);
  console.log(`📁 Auth Storage Path  : ${SESSION_DIR}`);
  console.log(`===============================================================\n`);

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: true,
    auth: state,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false
  });

  // Credential persistence
  sock.ev.on("creds.update", saveCreds);

  // Connection lifecycle handler
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      connectionStatus = "SCAN_QR";
      console.log("📲 New Pairing QR Code generated. View dashboard at http://localhost:" + PORT);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      connectionStatus = "DISCONNECTED";
      currentQR = null;
      console.log(`⚠️ Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(initWhatsApp, 5000);
      } else {
        console.log("❌ Logged out. Clearing session directory for clean re-pairing.");
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        setTimeout(initWhatsApp, 3000);
      }
    } else if (connection === "open") {
      connectionStatus = "CONNECTED";
      currentQR = null;
      connectedUser = sock.user?.id ? sock.user.id.split(":")[0] : "Admin";
      console.log(`✅ Headless Listener CONNECTED successfully as: +${connectedUser}`);

      // Immediately fetch target group metadata
      await syncGroupRoster();
    }
  });

  // Real-time group join/leave event listener
  sock.ev.on("group-participants.update", async (event) => {
    if (event.id === TARGET_GROUP_ID) {
      console.log(`🔔 [LIVE EVENT] Group roster updated (${event.action}):`, event.participants);
      await syncGroupRoster();
    }
  });
}

// -------------------------------------------------------------
// 2. Read-Only Group Metadata Poller
// -------------------------------------------------------------
async function syncGroupRoster() {
  if (!sock || connectionStatus !== "CONNECTED") return null;

  try {
    console.log(`🔄 Fetching latest group metadata for: ${TARGET_GROUP_ID}...`);
    const metadata = await sock.groupMetadata(TARGET_GROUP_ID);

    const participants = (metadata.participants || []).map((p) => {
      const raw = p.id.split("@")[0];
      return {
        id: p.id,
        phone: raw,
        isAdmin: p.admin === "admin" || p.admin === "superadmin",
        isSuperAdmin: p.admin === "superadmin"
      };
    });

    groupMetadataCache = {
      id: metadata.id,
      subject: metadata.subject,
      creation: metadata.creation,
      owner: metadata.owner,
      size: metadata.size || participants.length,
      participantsCount: participants.length,
      participants: participants,
      lastUpdated: new Date().toISOString()
    };
    lastSyncTime = new Date().toISOString();

    console.log(`📊 [ROSTER SYNC COMPLETE] Group: "${metadata.subject}" | Total Members: ${participants.length}`);
    return groupMetadataCache;
  } catch (err) {
    console.error("❌ Failed to fetch group metadata:", err.message);
    return null;
  }
}

// Periodic background sync every 15 minutes (even if laptop is off)
setInterval(syncGroupRoster, 15 * 60 * 1000);

// -------------------------------------------------------------
// 3. Web Dashboard & REST API
// -------------------------------------------------------------

// Health check endpoint for cloud monitoring (Railway, Render, Fly.io)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    connection: connectionStatus,
    connectedUser: connectedUser ? `+${connectedUser}` : null,
    targetGroup: TARGET_GROUP_ID,
    memberCount: groupMetadataCache ? groupMetadataCache.participantsCount : 0,
    lastSync: lastSyncTime
  });
});

// JSON API: Get current roster
app.get("/api/roster", (req, res) => {
  if (!groupMetadataCache) {
    return res.status(503).json({
      success: false,
      status: connectionStatus,
      message: "Roster not yet synced or listener not connected"
    });
  }

  res.json({
    success: true,
    group: groupMetadataCache.subject,
    groupId: groupMetadataCache.id,
    memberCount: groupMetadataCache.participantsCount,
    lastUpdated: groupMetadataCache.lastUpdated,
    participants: groupMetadataCache.participants
  });
});

// Trigger an immediate manual roster refresh
app.post("/api/refresh", async (req, res) => {
  const result = await syncGroupRoster();
  if (result) {
    res.json({ success: true, count: result.participantsCount, lastUpdated: result.lastUpdated });
  } else {
    res.status(500).json({ success: false, error: "Failed to refresh roster" });
  }
});

// Main HTML Dashboard with QR Code / Live Roster
app.get("/", async (req, res) => {
  let qrImageHtml = "";
  if (connectionStatus === "SCAN_QR" && currentQR) {
    const qrDataUrl = await qrcode.toDataURL(currentQR, { width: 300 });
    qrImageHtml = `
      <div class="qr-box">
        <h3 style="margin-top:0; color:#128c7e;">📲 Pair Secondary Admin Phone</h3>
        <p style="color:#555; font-size:14px;">Open WhatsApp on your secondary phone ➔ <b>Settings</b> ➔ <b>Linked Devices</b> ➔ <b>Link a Device</b> and scan this QR code.</p>
        <img src="${qrDataUrl}" alt="Pairing QR Code" style="border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); margin:10px 0;" />
        <p style="font-size:12px; color:#888;">QR auto-refreshes every 20 seconds</p>
      </div>
    `;
  }

  const isConnected = connectionStatus === "CONNECTED";

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WhatsApp Headless Roster Listener</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${isConnected ? 30 : 5}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; margin: 0; padding: 24px; color: #111b21; }
    .card { background: white; border-radius: 16px; padding: 24px; max-width: 720px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 13px; }
    .badge-online { background: #dcf8c6; color: #075e54; }
    .badge-offline { background: #fee2e2; color: #991b1b; }
    .badge-qr { background: #fef3c7; color: #92400e; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 20px 0; }
    .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; text-align: center; }
    .stat-num { font-size: 28px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .stat-label { font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .qr-box { text-align: center; background: #fafafa; border: 2px dashed #cbd5e1; border-radius: 16px; padding: 24px; margin: 20px 0; }
    .roster-table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    .roster-table th, .roster-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; text-align: left; }
    .roster-table th { background: #f8fafc; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:16px;">
      <div>
        <h2 style="margin:0; font-size:22px;">🤖 24/7 Headless Roster Listener</h2>
        <p style="margin:4px 0 0 0; color:#64748b; font-size:13px;">Cloud-Hosted Multi-Device Companion (0% Ban Risk | Strictly Read-Only)</p>
      </div>
      <span class="badge ${isConnected ? 'badge-online' : (connectionStatus === 'SCAN_QR' ? 'badge-qr' : 'badge-offline')}">
        ${connectionStatus}
      </span>
    </div>

    ${qrImageHtml}

    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-label">Connected Device</div>
        <div class="stat-num" style="font-size:18px;">${connectedUser ? `+${connectedUser}` : 'Not Paired'}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Community Members</div>
        <div class="stat-num" style="color:#059669;">${groupMetadataCache ? groupMetadataCache.participantsCount : 0}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Last Roster Sync</div>
        <div class="stat-num" style="font-size:13px; font-weight:600; color:#475569; margin-top:12px;">
          ${lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('en-IN') : 'Pending'}
        </div>
      </div>
    </div>

    ${groupMetadataCache ? `
      <div style="margin-top:20px;">
        <h3 style="margin-bottom:8px; font-size:16px;">📋 Group: "${groupMetadataCache.subject}"</h3>
        <p style="font-size:12px; color:#64748b; margin-top:0;">Showing active roster synced directly from WhatsApp servers 24/7:</p>
        <div style="max-height: 280px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
          <table class="roster-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Phone Number</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              ${groupMetadataCache.participants.map((p, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td><b>+${p.phone}</b></td>
                  <td>${p.isSuperAdmin ? '👑 Creator' : (p.isAdmin ? '⭐ Admin' : 'Member')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}

    <div style="margin-top:24px; padding-top:16px; border-top:1px solid #f1f5f9; text-align:center; font-size:12px; color:#94a3b8;">
      ⚡ Runs continuously in the cloud independent of your personal computer, browser, or home internet.
    </div>
  </div>
</body>
</html>
  `);
});

// Start Express HTTP Server
app.listen(PORT, () => {
  console.log(`🚀 Headless Listener Web Dashboard listening at http://localhost:${PORT}`);
  initWhatsApp().catch((err) => {
    console.error("Fatal initialization error:", err);
  });
});
