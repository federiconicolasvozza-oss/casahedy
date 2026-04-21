// index.js — Casa Hedy Bot (WhatsApp Business API)

import express from "express";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

/* ===================== ENV ===================== */
const PORT = process.env.PORT || 8080;
const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || "").trim();
const WHATSAPP_TOKEN = (process.env.WHATSAPP_TOKEN || "").trim();
const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || "").trim();
const API_VERSION = "v25.0";

/* ===================== WHATSAPP HELPERS ===================== */
async function sendMessage(payload) {
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("❌ Error enviando mensaje:", res.status, txt);
  }
  return res.ok;
}

function sendText(to, body) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

function sendButtons(to, text, buttons) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: {
        buttons: buttons.slice(0, 3).map(({ id, title }) => ({
          type: "reply",
          reply: { id, title: String(title).slice(0, 20) },
        })),
      },
    },
  });
}

/* ===================== MENÚ PRINCIPAL ===================== */
async function sendWelcome(to) {
  await sendText(
    to,
    "🔪 ¡Hola! Bienvenido a *Casa Hedy*\n\n" +
    "Somos especialistas en cuchillería, herramientas y más.\n" +
    "3 cuotas sin interés · Envío en el día a CABA y GBA\n\n" +
    "¿En qué te puedo ayudar?"
  );
  return sendButtons(to, "Elegí una opción:", [
    { id: "cat_cuchillos", title: "🔪 Cuchillos" },
    { id: "cat_herramientas", title: "🔧 Herramientas" },
    { id: "cat_asesor", title: "💬 Hablar c/ asesor" },
  ]);
}

/* ===================== HEALTH ===================== */
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ===================== WEBHOOK VERIFY (GET) ===================== */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* ===================== WEBHOOK EVENTS (POST) ===================== */
app.post("/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!change) return res.sendStatus(200);

    // Ignorar status updates (entregado, leído, etc.)
    if (change.statuses) return res.sendStatus(200);

    const msg = change?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    console.log("📲 Mensaje de:", from, "| Tipo:", msg.type);

    // ===== INTERACTIVE (botones) =====
    if (msg.type === "interactive") {
      const id =
        msg.interactive?.button_reply?.id ||
        msg.interactive?.list_reply?.id;

      if (id === "cat_cuchillos") {
        await sendText(
          from,
          "🔪 *Cuchillos Casa Hedy*\n\n" +
          "Tenemos:\n" +
          "• Artesanales y criollos\n" +
          "• Cocina y Chef\n" +
          "• Tácticos y deportivos\n" +
          "• Facas, facones y navajas\n\n" +
          "📲 Mirá todo el catálogo en:\nhttps://casahedy.com.ar/\n\n" +
          "Escribí *menu* para volver al inicio."
        );
        return res.sendStatus(200);
      }

      if (id === "cat_herramientas") {
        await sendText(
          from,
          "🔧 *Herramientas Casa Hedy*\n\n" +
          "Pinzas, llaves, destornilladores, torquímetros, bocallaves, y mucho más.\n\n" +
          "📲 Mirá todo en:\nhttps://casahedy.com.ar/herramientas/\n\n" +
          "Escribí *menu* para volver al inicio."
        );
        return res.sendStatus(200);
      }

      if (id === "cat_asesor") {
        await sendText(
          from,
          "👤 Un asesor te va a contactar a la brevedad.\n" +
          "También podés escribirnos directo a:\nhttps://wa.me/NUMERO_ASESOR"
        );
        return res.sendStatus(200);
      }

      return res.sendStatus(200);
    }

    // ===== TEXT =====
    if (msg.type === "text") {
      const body = (msg.text?.body || "").trim().toLowerCase();

      if (["hola", "menu", "menú", "inicio", "buenas", "hi"].includes(body)) {
        await sendWelcome(from);
        return res.sendStatus(200);
      }

      // Cualquier otro texto → menú
      await sendWelcome(from);
      return res.sendStatus(200);
    }

    // Otros tipos (imagen, audio, etc.) → menú
    await sendWelcome(from);
    return res.sendStatus(200);
  } catch (e) {
    console.error("💥 Webhook error:", e);
    return res.sendStatus(200);
  }
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`🚀 Casa Hedy Bot en http://localhost:${PORT}`);
  console.log("📞 PHONE_NUMBER_ID:", PHONE_NUMBER_ID || "(vacío)");
});
