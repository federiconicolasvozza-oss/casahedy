require('dotenv').config();
const express = require('express');
const { handleWebhookVerification, handleIncomingMessage } = require('./bot');

const app = express();
app.use(express.json());

// 🔹 Verificación del webhook (Meta) — GET
app.get('/webhook', handleWebhookVerification);

// 🔹 Recepción de eventos (mensajes, estados, etc.) — POST
app.post('/webhook', (req, res) => {
  // ⚠️ Siempre responder 200 rápido para que Meta no reintente
  res.sendStatus(200);

  // Procesar en background
  handleIncomingMessage(req.body).catch(err => {
    console.error('💥 Error procesando mensaje:', err);
  });
});

// 🔹 Endpoint raíz (health check)
app.get('/', (req, res) => {
  res.send('Casa Hedy API OK ✅');
});

// 🔹 Puerto dinámico para Railway
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Casa Hedy Bot corriendo en puerto ${PORT}`);
  console.log(`📋 Variables cargadas:`);
  console.log(`   VERIFY_TOKEN: ${process.env.VERIFY_TOKEN ? '✅' : '❌ FALTA'}`);
  console.log(`   WHATSAPP_TOKEN: ${process.env.WHATSAPP_TOKEN ? '✅' : '❌ FALTA'}`);
  console.log(`   PHONE_NUMBER_ID: ${process.env.PHONE_NUMBER_ID ? '✅' : '❌ FALTA'}`);
  console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅' : '❌ FALTA'}`);
  console.log(`   OWNER_PHONE: ${process.env.OWNER_PHONE ? '✅' : '❌ FALTA'}`);
});
