const { sendMessage } = require('./whatsapp');
const axios = require('axios');

const OWNER_PHONE = process.env.OWNER_PHONE; // Número del dueño de Casa Hedy
const GOOGLE_SHEET_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;

/* ===================== SESIONES DE LEADS ===================== */
// Trackea estado de cada lead para no spamear al dueño
const leadSessions = new Map();

function getLeadSession(phone) {
  if (!leadSessions.has(phone)) {
    leadSessions.set(phone, {
      highestScore: 0,
      notifiedAt7: false,   // Notificado como lead caliente
      notifiedAt9: false,   // Notificado como comprador confirmado
      lastSheetLog: 0,
      messageCount: 0,
      nombre: null,
      motivo: null,
      lastActivity: Date.now()
    });
  }
  const s = leadSessions.get(phone);
  s.lastActivity = Date.now();
  s.messageCount++;
  return s;
}

// Limpiar sesiones viejas cada hora
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000; // 4 horas
  for (const [key, s] of leadSessions) {
    if (s.lastActivity < cutoff) leadSessions.delete(key);
  }
}, 60 * 60 * 1000);

/* ===================== NOTIFICACIÓN POR WHATSAPP ===================== */

async function notifyOwnerWhatsApp(customerPhone, leadSession, leadData, reason) {
  if (!OWNER_PHONE) {
    console.log('⚠️ OWNER_PHONE no configurado');
    return false;
  }

  try {
    const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    let emoji = '🟡';
    let label = 'LEAD INTERESADO';
    if (leadData.leadScore >= 9) {
      emoji = '🔴';
      label = 'COMPRADOR CONFIRMADO';
    } else if (leadData.leadScore >= 7) {
      emoji = '🟢';
      label = 'LEAD DE TICKET ALTO';
    }

    const text =
      `${emoji} *${label} — Casa Hedy*\n\n` +
      `👤 ${leadData.nombre || leadSession.nombre || 'Sin nombre'}\n` +
      `📱 wa.me/${customerPhone}\n` +
      `📋 ${leadData.motivo || leadSession.motivo || 'No especificado'}\n` +
      `🎯 Score: ${leadData.leadScore}/10\n` +
      `💬 Mensajes: ${leadSession.messageCount}\n` +
      (reason ? `📌 ${reason}\n` : '') +
      `🕐 ${now}`;

    await sendMessage(OWNER_PHONE, text);
    console.log(`📨 Notificación WA enviada al dueño para lead ${customerPhone}`);
    return true;
  } catch (error) {
    console.error('❌ Error notificando al dueño:', error.message);
    return false;
  }
}

/* ===================== NOTIFICACIÓN DE HANDOFF ===================== */

async function notifyHandoff(customerPhone, customerName, conversationHistory, reason) {
  if (!OWNER_PHONE) {
    console.log('⚠️ OWNER_PHONE no configurado para handoff');
    return false;
  }

  try {
    const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    // Resumen de los últimos mensajes
    const recent = conversationHistory.slice(-6);
    const summary = recent
      .map(msg => {
        const role = msg.role === 'user' ? '👤' : '🤖';
        const content = (msg.content || '').slice(0, 120);
        return `${role} ${content}`;
      })
      .join('\n');

    const text =
      `🚨 *DERIVACIÓN A HUMANO — Casa Hedy*\n\n` +
      `👤 ${customerName || 'Sin nombre'}\n` +
      `📱 wa.me/${customerPhone}\n` +
      `📋 Motivo: ${reason}\n\n` +
      `💬 Últimos mensajes:\n${summary || 'Sin historial'}\n\n` +
      `🕐 ${now}`;

    await sendMessage(OWNER_PHONE, text);
    console.log(`🚨 Handoff notificado para ${customerPhone}`);
    return true;
  } catch (error) {
    console.error('❌ Error notificando handoff:', error.message);
    return false;
  }
}

/* ===================== GOOGLE SHEETS ===================== */

async function logToSheet(customerPhone, leadSession, leadData) {
  if (!GOOGLE_SHEET_WEBHOOK) return false;

  try {
    await axios.post(GOOGLE_SHEET_WEBHOOK, {
      fecha: new Date().toISOString(),
      telefono: customerPhone,
      nombre: leadData.nombre || leadSession.nombre || '',
      motivo: leadData.motivo || leadSession.motivo || '',
      leadScore: leadData.leadScore,
      mensajes: leadSession.messageCount,
      calificado: leadData.leadScore >= 7 ? 'SÍ' : 'NO',
      ticketAlto: leadData.leadScore >= 7 ? 'SÍ' : 'NO'
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('📊 Lead guardado en Google Sheets');
    return true;
  } catch (error) {
    console.error('❌ Error guardando en Sheet:', error.message);
    return false;
  }
}

/* ===================== PROCESO PRINCIPAL DE LEAD ===================== */

async function processLead(customerPhone, leadData) {
  const session = getLeadSession(customerPhone);

  // Actualizar datos de sesión
  if (leadData.nombre) session.nombre = leadData.nombre;
  if (leadData.motivo) session.motivo = leadData.motivo;
  if (leadData.leadScore > session.highestScore) {
    session.highestScore = leadData.leadScore;
  }

  // Notificar por WhatsApp al dueño si es lead caliente (score >= 7) y no se notificó
  if (leadData.leadScore >= 7 && !session.notifiedAt7) {
    session.notifiedAt7 = true;
    await notifyOwnerWhatsApp(customerPhone, session, leadData);
  }

  // Re-notificar si sube a comprador confirmado (score >= 9)
  if (leadData.leadScore >= 9 && !session.notifiedAt9) {
    session.notifiedAt9 = true;
    await notifyOwnerWhatsApp(customerPhone, session, leadData, 'UPGRADE: Pasó a comprador confirmado');
  }

  // Guardar en Google Sheets cada 3 mensajes o si es lead caliente
  const now = Date.now();
  if (leadData.leadScore >= 7 || session.messageCount % 3 === 0 || (now - session.lastSheetLog > 60000)) {
    session.lastSheetLog = now;
    await logToSheet(customerPhone, session, leadData);
  }
}

module.exports = {
  processLead,
  notifyHandoff,
  notifyOwnerWhatsApp,
  logToSheet,
  getLeadSession
};
