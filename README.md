# 🤖 24/7 Headless WhatsApp Community Roster Listener

A standalone, micro-service that keeps a persistent companion session to WhatsApp Web in the cloud. It continuously inspects who is inside your WhatsApp Community / Group and exposes the ground-truth roster via a clean REST API and Web Dashboard — **completely independent of your personal computer, browser, or home internet**.

---

## 🛡️ Safety & Zero-Ban Guarantee
* **Strictly Read-Only**: This service contains **ZERO message sending functions**. 
* It never broadcasts, texts, or replies.
* It only queries `groupMetadata(TARGET_GROUP_ID)` and listens for real-time join events.
* Because WhatsApp anti-spam algorithms only trigger on outgoing messages, a read-only companion device has **0% ban risk**.

---

## 🌐 How It Works 24/7 (Even When Laptop Is Off)
1. Runs inside a lightweight cloud Docker container (e.g., on Railway, Render, Fly.io, or VPS).
2. Uses your **secondary number** (which is already an Admin in the Community).
3. Connects via WhatsApp's official Multi-Device protocol as an independent companion device.
4. Your personal MacBook and Brave browser remain 100% free to sleep, shut down, or disconnect.

---

## 🚀 How to Run Locally for Testing

1. Navigate to the directory:
   ```bash
   cd headless_group_listener
   ```

2. Start the listener server:
   ```bash
   npm start
   ```

3. Open your browser at:
   ```
   http://localhost:3000
   ```

4. **Pair Once**:
   * You will see a clean QR code on the webpage (and in your terminal).
   * Open WhatsApp on your **secondary admin phone**.
   * Go to **Settings** ➔ **Linked Devices** ➔ **Link a Device**.
   * Scan the QR code.

5. **Done!**
   * The dashboard will immediately turn **GREEN ("CONNECTED")**.
   * It will display the live member count (`308+ members`) and show all participants.
   * You can query the live JSON roster anytime at:
     ```
     GET http://localhost:3000/api/roster
     ```

---

## ☁️ 1-Click Cloud Deployment (Railway / Render)

### Deploy on Railway.app (Free / ~$3.50 mo)
1. Push this folder to a GitHub repository.
2. In Railway.app, click **"New Project"** ➔ **"Deploy from GitHub repo"**.
3. Select the repository. Railway will detect the `Dockerfile` automatically.
4. Add a **Persistent Volume** mounted at `/app/auth_session` (so pairing persists across restarts).
5. Open your generated Railway public URL (e.g. `https://roster-listener.up.railway.app`).
6. Scan the QR code once from your phone.
7. **It is now permanently monitoring your community 24/7/365 in the cloud!**

---

## 🔌 API Endpoints Reference

| Endpoint | Method | Description |
|:---|:---:|:---|
| `/` | `GET` | HTML Web Dashboard with QR Pairing & Live Member Table |
| `/api/roster` | `GET` | JSON response containing `{ group, memberCount, participants: [...] }` |
| `/api/refresh` | `POST` | Forces an immediate real-time sync with WhatsApp servers |
| `/health` | `GET` | Cloud health check endpoint returning `{ status: "ok", connection: "CONNECTED" }` |
