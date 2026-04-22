const { sendMessage, markAsRead, showTyping } = require('./whatsapp');
const { generateResponse, shouldHandoff, getHistory } = require('./ai');
const { processLead, notifyHandoff } = require('./notifications');

// Webhook verification
function handleWebhookVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verificación fallida');
    res.sendStatus(403);
  }
}

// Procesar mensajes entrantes
async function handleIncomingMessage(body) {
  try {
    if (!body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) return;

    const value = body.entry[0].changes[0].value;
    const message = value.messages[0];
    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    // Ignorar status updates
    if (value.statuses) return;

    // Nombre del contacto
    const contactName = value.contacts?.[0]?.profile?.name || null;

    // Marcar como leído
    await markAsRead(messageId);

    // Extraer texto según tipo
    let messageBody = '';
    if (messageType === 'text') {
      messageBody = message.text?.body?.trim() || '';
    } else if (messageType === 'interactive') {
      messageBody = message.interactive?.button_reply?.title?.trim() ||
                    message.interactive?.list_reply?.title?.trim() || '';
    } else if (messageType === 'image') {
      messageBody = '[El cliente envió una imagen]';
    } else if (messageType === 'audio') {
      messageBody = '[El cliente envió un audio]';
    } else {
      await sendMessage(from, 'Por favor enviame un mensaje de texto para ayudarte mejor 😊');
      return;
    }

    if (!messageBody) return;

    console.log(`📲 ${from}${contactName ? ` (${contactName})` : ''}: ${messageBody.slice(0, 100)}`);

    // Mostrar "escribiendo..."
    await showTyping(from);

    // Generar respuesta con Gemini
    const { text: aiResponse, leadData } = await generateResponse(from, messageBody);

    // Si Gemini falló, respuesta de fallback
    if (!aiResponse) {
      await sendMessage(
        from,
        'Hola! Gracias por escribirnos 🔪\n\n' +
        'En este momento estamos con mucha demanda. ' +
        'Podes ver todo nuestro catálogo en:\n' +
        'https://casahedy.com.ar\n\n' +
        'O escribinos en unos minutos y te atendemos!'
      );
      return;
    }

    // Enviar respuesta
    await sendMessage(from, aiResponse);

    // Procesar lead (notificaciones + sheets)
    if (leadData) {
      // Pasar nombre del contacto de WhatsApp si no tenemos nombre del lead
      if (!leadData.nombre && contactName) {
        leadData.nombre = contactName;
      }
      await processLead(from, leadData);
    }

    // Detectar derivación a humano
    if (shouldHandoff(aiResponse, leadData)) {
      console.log(`🚨 DERIVACIÓN — Usuario: ${from}`);

      const history = getHistory(from);
      let reason = 'Derivación solicitada';
      const lower = aiResponse.toLowerCase();
      if (lower.includes('reclamo') || lower.includes('problema')) {
        reason = 'Reclamo o problema con pedido';
      } else if (lower.includes('mercadolibre') || lower.includes('ml')) {
        reason = 'Consulta de MercadoLibre';
      } else if (lower.includes('técnic') || lower.includes('tecnic')) {
        reason = 'Consulta técnica';
      }

      await notifyHandoff(from, contactName || leadData?.nombre, history, reason);
    }

  } catch (error) {
    console.error('💥 Error en handleIncomingMessage:', error);
  }
}

module.exports = {
  handleWebhookVerification,
  handleIncomingMessage
};
