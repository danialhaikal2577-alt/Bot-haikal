const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const path = require('path');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    const num = "601121007038";
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(num);
        console.log("PAIRING CODE:", code);
      } catch(e){ console.log("Gagal minta code", e) }
    }, 3000);
  }

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') console.log("BOT CONNECTED!");
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Putus, reconnect...", shouldReconnect);
      if (shouldReconnect) start();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    const from = m.key.remoteJid;
    const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim().toLowerCase();

    if (text === '.menu' || text === 'menu' || text === '.ping') {
      await sock.sendMessage(from, { text: "BOT HD ✅ MAX 150MB\n\nHantar VIDEO kat sini, aku hantar balik jadi FILE HD!\n\nBoleh hantar sebagai VIDEO atau FILE.\nLimit: 150MB. Kalau lebih, WhatsApp sendiri akan fail." });
      return;
    }

    let videoMsg = m.message.videoMessage;
    let isDocVideo = false;
    if (m.message.documentWithCaptionMessage) {
      const doc = m.message.documentWithCaptionMessage.message.documentMessage;
      if (doc && (doc.mimetype?.includes('video') || doc.fileName?.toLowerCase().endsWith('.mp4') || doc.fileName?.toLowerCase().endsWith('.mov'))) {
        videoMsg = doc;
        isDocVideo = true;
      }
    } else if (m.message.documentMessage) {
      const doc = m.message.documentMessage;
      if (doc && (doc.mimetype?.includes('video') || doc.fileName?.toLowerCase().endsWith('.mp4') || doc.fileName?.toLowerCase().endsWith('.mov'))) {
        videoMsg = doc;
        isDocVideo = true;
      }
    }

    if (videoMsg) {
      const sizeMB = (videoMsg.fileLength || 0) / (1024 * 1024);
      console.log("Video masuk:", sizeMB.toFixed(2), "MB");

      if (sizeMB > 150) {
        await sock.sendMessage(from, { text: `Video kau ${sizeMB.toFixed(1)}MB, lebih 150MB. Trim / compress sikit.` });
        return;
      }

      await sock.sendMessage(from, { text: `Dapat ${sizeMB.toFixed(1)}MB. Tengah download & hantar balik HD... Jangan hantar video lain dulu, tunggu siap. Boleh ambik 1-3 minit untuk 150MB.` });

      const filePath = path.join(__dirname, `temp_${Date.now()}.mp4`);
      try {
        // STREAM - tak simpan dalam RAM, simpan terus jadi file
        const stream = await downloadContentFromMessage(videoMsg, isDocVideo ? 'document' : 'video');
        const writeStream = fs.createWriteStream(filePath);
        for await (const chunk of stream) {
          writeStream.write(chunk);
        }
        writeStream.end();
        await new Promise(res => writeStream.on('finish', res));

        console.log("Download siap, hantar balik...");
        await sock.sendMessage(from, {
          document: fs.readFileSync(filePath),
          fileName: `HD_${Date.now()}.mp4`,
          mimetype: 'video/mp4',
          caption: "Siap! Ni video HD 150MB ✅"
        });
