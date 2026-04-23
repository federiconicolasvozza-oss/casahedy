const express = require("express");

const app = express();
app.use(express.json());

// 🔐 Token que vos definís en Railway y en Meta (tienen que coincidir)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "botconektar123";

// 🔹 Verificación del webhook (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente");
    return res.status(200).send(challenge);
  } else {
    console.log("Error de verificación webhook");
    return res.sendStatus(403);
  }
});

// 🔹 Recepción de eventos (mensajes, estados, etc.)
app.post("/webhook", (req, res) => {
  console.log("Evento recibido:");
  console.dir(req.body, { depth: null });

  // ⚠️ Siempre responder 200 rápido
  res.sendStatus(200);
});

// 🔹 Endpoint raíz (para test rápido)
app.get("/", (req, res) => {
  res.send("Casa Hedy API OK");
});

// 🔹 Puerto dinámico para Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
