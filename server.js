require('dotenv').config();
const express = require('express');
const { handleWebhookVerification, handleIncomingMessage } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'WhatsApp Bot - Casa Hedy',
    timestamp: new Date().toISOString()
  });
});

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  handleWebhookVerification(req, res);
});

// Webhook messages (POST)
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta
  try {
    await handleIncomingMessage(req.body);
  } catch (error) {
    console.error('💥 Error procesando mensaje:', error);
  }
});

app.listen(PORT, () => {
  console.log(`🔪 Casa Hedy Bot en puerto ${PORT}`);
  console.log(`🤖 Gemini: ${process.env.GEMINI_API_KEY ? '✅' : '❌ Falta GEMINI_API_KEY'}`);
  console.log(`📦 Tienda Nube: ${process.env.TIENDANUBE_ACCESS_TOKEN ? '✅' : '⚠️ Sin catálogo dinámico'}`);
  console.log(`📨 Notif. WhatsApp: ${process.env.OWNER_PHONE ? '✅ → ' + process.env.OWNER_PHONE : '⚠️ Sin OWNER_PHONE'}`);
  console.log(`📊 Google Sheets: ${process.env.GOOGLE_SHEET_WEBHOOK ? '✅' : '⚠️ No configurado'}`);
});
