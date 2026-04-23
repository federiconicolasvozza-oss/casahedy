require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

/* ================================================================
   CONFIGURACIÓN
   ================================================================ */
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'botconektar123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE;
const GOOGLE_SHEET_WEBHOOK = process.env.GOOGLE_SHEET_WEBHOOK;
const TIENDANUBE_ACCESS_TOKEN = process.env.TIENDANUBE_ACCESS_TOKEN;
const TIENDANUBE_STORE_ID = process.env.TIENDANUBE_STORE_ID;

const API_VERSION = 'v25.0';
const WHATSAPP_API_URL = `https://graph.facebook.com/${API_VERSION}`;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const TIENDANUBE_API_URL = TIENDANUBE_STORE_ID ? `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}` : null;
const TIENDANUBE_HEADERS = {
  'Authentication': `bearer ${TIENDANUBE_ACCESS_TOKEN}`,
  'User-Agent': 'Casa Hedy WhatsApp Bot (info@casahedy.com.ar)',
  'Content-Type': 'application/json'
};

/* ================================================================
   WHATSAPP — ENVÍO DE MENSAJES
   ================================================================ */
async function sendMessage(to, text) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: true, body: text }
      },
      { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ Mensaje enviado a ${to}`);
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
  }
}

async function markAsRead(messageId) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (_) { /* no crítico */ }
}

async function showTyping(to) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', status: 'typing', recipient_type: 'individual', to },
      { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (_) { /* no crítico */ }
}

/* ================================================================
   TIENDA NUBE — CATÁLOGO Y ÓRDENES
   ================================================================ */
let productCache = { products: [], lastUpdate: null };
const CACHE_DURATION = 5 * 60 * 1000;

function formatPrice(price) {
  if (!price) return 'Consultar';
  return `$${parseFloat(price).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getSpanishText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.es || field.en || Object.values(field)[0] || '';
}

async function getProducts(forceRefresh = false) {
  try {
    const now = Date.now();
    if (!forceRefresh && productCache.lastUpdate && (now - productCache.lastUpdate) < CACHE_DURATION) {
      return productCache.products;
    }
    if (!TIENDANUBE_ACCESS_TOKEN || !TIENDANUBE_STORE_ID) {
      console.log('⚠️ Tienda Nube no configurada');
      return [];
    }
    console.log('📦 Actualizando catálogo desde Tienda Nube...');
    let allProducts = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await axios.get(`${TIENDANUBE_API_URL}/products`, {
        headers: TIENDANUBE_HEADERS,
        params: { per_page: 200, page, published: true }
      });
      allProducts = allProducts.concat(response.data);
      const linkHeader = response.headers['link'];
      hasMore = linkHeader && linkHeader.includes('rel="next"');
      page++;
      if (page > 10) break;
    }
    const products = allProducts.map(product => {
      const variant = product.variants[0];
      const finalPrice = variant?.promotional_price || variant?.price || null;
      const originalPrice = variant?.price || null;
      const hasDiscount = variant?.promotional_price && parseFloat(variant.promotional_price) < parseFloat(variant.price);
      return {
        id: product.id,
        name: getSpanishText(product.name),
        description: getSpanishText(product.description),
        price: finalPrice, originalPrice, hasDiscount,
        stock: variant?.stock || 0,
        available: product.has_stock !== false && (variant?.stock > 0 || variant?.stock === null),
        url: product.canonical_url,
        image: product.images[0]?.src || null,
        categories: product.categories?.map(c => getSpanishText(c.name)) || []
      };
    });
    productCache = { products, lastUpdate: now };
    console.log(`✅ Catálogo actualizado: ${products.length} productos`);
    return products;
  } catch (error) {
    console.error('❌ Error obteniendo productos:', error.response?.data || error.message);
    return productCache.products;
  }
}

async function getCatalogSummary() {
  const products = await getProducts();
  if (products.length === 0) return 'Catálogo dinámico no disponible. Usá la información estática del prompt.';
  return products
    .filter(p => p.available)
    .map(p => {
      const price = formatPrice(p.price);
      const discount = p.hasDiscount ? ` (antes ${formatPrice(p.originalPrice)})` : '';
      const cats = p.categories.length ? ` [${p.categories.join(', ')}]` : '';
      return `- ${p.name}: ${price}${discount}${cats} | ${p.url || ''}`;
    })
    .join('\n');
}

function parseOrder(order) {
  const paymentMap = { 'paid': 'Pagado', 'pending': 'Pendiente de pago', 'refunded': 'Reembolsado', 'voided': 'Anulado', 'abandoned': 'Abandonado' };
  const shippingMap = { 'shipped': 'Enviado', 'unshipped': 'Pendiente de envío', 'partially_shipped': 'Envío parcial', 'delivered': 'Entregado' };
  let shippingStatus = shippingMap[order.shipping_status] || order.shipping_status || 'Pendiente';
  if (order.status === 'cancelled') shippingStatus = 'Orden cancelada';
  const date = new Date(order.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const products = order.products?.map(p => ({ name: p.name, quantity: p.quantity, price: p.price })) || [];
  let trackingUrl = order.shipping_tracking_url || order.shipping_tracking_number || null;
  if (!trackingUrl && order.fulfillments?.length > 0) {
    const f = order.fulfillments[0];
    trackingUrl = f.tracking_info?.url || f.tracking_info?.code || null;
  }
  const addr = order.shipping_address || {};
  return {
    number: order.number, date,
    customerName: order.contact_name,
    status: order.status,
    paymentStatus: paymentMap[order.payment_status] || order.payment_status,
    shippingStatus, trackingUrl,
    total: formatPrice(order.total),
    products,
    productsSummary: products.map(p => `${p.quantity}x ${p.name}`).join(', ') || 'Ver detalle',
    city: addr.city || order.billing_city,
    province: addr.province || order.billing_province
  };
}

function getOrderSummary(order) {
  if (!order) return null;
  let s = `Orden #${order.number} del ${order.date}\n`;
  s += `Producto: ${order.productsSummary}\n`;
  s += `Total: ${order.total}\n`;
  s += `Pago: ${order.paymentStatus}\n`;
  if (order.status === 'cancelled') {
    s += `Estado: CANCELADA\n`;
  } else {
    s += `Envío: ${order.shippingStatus}\n`;
    if (order.trackingUrl && order.trackingUrl.startsWith('http')) s += `Seguimiento: ${order.trackingUrl}\n`;
  }
  if (order.city || order.province) s += `Destino: ${order.city || ''}, ${order.province || ''}`;
  return s.trim();
}

async function findOrderByNumber(orderNumber) {
  try {
    if (!TIENDANUBE_ACCESS_TOKEN) return null;
    const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
    if (!cleanNumber) return null;
    console.log(`🔍 Buscando orden #${cleanNumber}...`);
    const response = await axios.get(`${TIENDANUBE_API_URL}/orders`, { headers: TIENDANUBE_HEADERS, params: { q: cleanNumber } });
    const orders = response.data;
    if (!orders || orders.length === 0) return null;
    const exact = orders.find(o => String(o.number) === cleanNumber);
    return parseOrder(exact || orders[0]);
  } catch (error) {
    console.error('Error buscando orden:', error.response?.data || error.message);
    return null;
  }
}

async function findOrdersByWhatsApp(whatsappNumber) {
  try {
    if (!TIENDANUBE_ACCESS_TOKEN) return [];
    const cleanNumber = whatsappNumber.replace(/\D/g, '');
    const localNumber = cleanNumber.slice(-10);
    const response = await axios.get(`${TIENDANUBE_API_URL}/orders`, { headers: TIENDANUBE_HEADERS, params: { per_page: 30, sort_by: 'created_at', sort_order: 'desc' } });
    return response.data
      .filter(order => {
        const phone = order.contact_phone?.replace(/\D/g, '') || '';
        const billingPhone = order.billing_phone?.replace(/\D/g, '') || '';
        return phone.includes(localNumber) || localNumber.includes(phone.slice(-10)) || billingPhone.includes(localNumber);
      })
      .map(parseOrder);
  } catch (error) {
    console.error('Error buscando órdenes por WhatsApp:', error.response?.data || error.message);
    return [];
  }
}

/* ================================================================
   GEMINI — IA
   ================================================================ */
const conversationHistory = new Map();

function getHistory(userId) {
  if (!conversationHistory.has(userId)) conversationHistory.set(userId, []);
  return conversationHistory.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
}

function isFirstMessage(userId) {
  return getHistory(userId).length === 0;
}

// Limpiar sesiones viejas cada 30 min
setInterval(() => {
  if (conversationHistory.size > 500) {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [key] of conversationHistory) {
      conversationHistory.delete(key);
      if (conversationHistory.size <= 250) break;
    }
  }
}, 30 * 60 * 1000);

async function getSystemPrompt() {
  const catalog = await getCatalogSummary();

  return `Sos el asistente virtual de *Casa Hedy*, cuchillería y ferretería con más de 36 años en Lomas de Zamora, Buenos Aires.

PERSONALIDAD:
- Amable, cercano, experto en cuchillería y herramientas
- Español argentino (vos, tenés, querés)
- Respuestas CONCISAS: 2-3 oraciones por defecto, 4-5 si hace falta explicar
- 1 emojis máximo por mensaje, sos un tipo de 60 años se supone que no sabe tanto de emojis.
- NUNCA uses signos de apertura (¿ ¡). Solo el signo del final.
- No te presentes de nuevo si ya estás en conversación
- NUNCA digas que sos IA o bot
- NO empiezes con "Genial!", "Perfecto!", "Excelente!" salvo que corresponda
- Links van PLANOS (sin markdown): https://casahedy.com.ar/...

SALUDOS INICIALES (variá, elegí uno):
- "Hola! Soy Mingo de Casa Hedy 🔪 Hace más de 30 años que estamos acá en Lomas. Contame que andas buscando"
- "Buenas! Mingo de Casa Hedy. Decime que necesitas y te oriento, eh"
- "Hola! Aca Mingo, Casa Hedy. 30 años cortando y vendiendo los mejores filos de zona sur. En que te ayudo?"
- "Que tal! Soy Mingo de Casa Hedy, Lomas de Zamora. Decime que andas necesitando"
Si ya estás en conversación y dicen "hola" de nuevo, NO te vuelvas a presentar. Seguí natural.

SOBRE CASA HEDY:
- 3 locales en Lomas de Zamora + tienda online + MercadoLibre
- Dirección: L.N. Alem 40 local 27, Lomas de Zamora
- WhatsApp: 541160131289 | Tel: 01142446127
- Envío en el día a CABA y GBA, envíos a todo el país
- 3 cuotas sin interés con todas las tarjetas
- 15% OFF con transferencia bancaria
- Presupuestos para empresas (Factura A)
- Más de 36 años en el mercado
- Marca propia: "El Criollo"

CATEGORÍAS:
1. CUCHILLOS (producto estrella):
   - Artesanales: criollos, gaucho, alpaca, piezas únicas "El Criollo" (marca propia)
   - Cocina/Chef: sanitarios, corte de carnes, cocinero, depostar, panero, cepos/sets
   - Tácticos, deportivos, navajas
   - Facas, facones, dagas, katanas
   - Accesorios: afiladores, chairas, piedras, vainas, cajas, hojas para encabar
   - PREMIUM (+$100.000): Boker Arbolito, alpaca, piezas únicas forjadas, 3 Claveles Forge/Sakura
   - RANGO: desde ~$30.000 hasta $1.400.000+

2. HERRAMIENTAS (Bahco, Bremen, Proskit):
   - Pinzas, llaves, destornilladores, bocallaves, torquímetros
   - Gatos hidráulicos, carros de herramientas
   - Herramientas aisladas 1000V
   - RANGO: desde ~$20.000 hasta $1.700.000+

3. LINTERNAS: recargables, tácticas, antiexplosivas, vinchas, reflectores

MARCAS: Boker Arbolito, 3 Claveles, Bahco, Bremen, Proskit, Eskiltuna, Filoshark, El Criollo

MEDIOS DE PAGO:
- Transferencia: 15% de descuento
- Tarjetas: 3 cuotas sin interés
- MercadoPago
- Empresas: Factura A disponible

ENVÍOS:
- CABA y GBA: Envío en el día o 24hs
- Interior: Correo Argentino / Andreani, 3-7 días hábiles
- Todos con seguimiento

CONSULTAS DE ÓRDENES:
- Si te llega info de orden de Tienda Nube, usala para responder
- Para compras de MercadoLibre NO tenés acceso, derivá a humano

CATÁLOGO ACTUAL (precios y stock en tiempo real de Tienda Nube):
${catalog}

REGLAS:
1. Si algo NO está en catálogo o SIN STOCK, decilo y ofrecé alternativas
2. NUNCA inventes precios. Si no sabés, mandá a casahedy.com.ar
3. Si quieren comprar, pasá el link directo del producto (URL plana)
4. Reclamos de MercadoLibre → derivá: "Te paso con alguien del equipo para resolver eso"
5. Consultas técnicas complejas → derivá a humano
6. Si preguntan por presupuesto de empresa, atendelos con prioridad
7. Mencioná siempre las 3 cuotas sin interés y el 15% off transferencia cuando hables de precios

OBJETIVO PRINCIPAL — CALIFICACIÓN DE LEADS:
Además de atender, tu trabajo es DETECTAR compradores de ticket alto (productos de $100.000+).

Señales de lead caliente:
- Pregunta por cuchillos artesanales, alpaca, Boker Arbolito, piezas únicas
- Busca regalo especial, colección, o algo "de calidad"/"premium"
- Pregunta por factura A o presupuesto para empresa
- Menciona presupuesto alto o no pregunta precio (señal de que no le importa)
- Quiere personalización o grabado

Señales de lead frío:
- Solo pregunta precios y no avanza
- Busca lo más barato
- Respuestas de una palabra
- No interactúa después de 2 mensajes

IMPORTANTE — SCORING INTERNO:
Al final de CADA respuesta, en una línea nueva, poné EXACTAMENTE este formato:
[LEAD_SCORE:X|MOTIVO:descripcion_breve|NOMBRE:nombre_o_desconocido|DERIVAR:si_o_no]

Donde X es 1-10:
- 1-3: Curioso, solo mira
- 4-6: Interesado moderado
- 7-8: Lead caliente, interés en premium
- 9-10: Comprador confirmado de ticket alto
- DERIVAR: "si" cuando la IA no puede resolver (reclamo ML, técnico, etc.)

Esta línea es INVISIBLE para el cliente, el sistema la extrae automáticamente.`;
}

async function detectAndFetchOrder(message, userId) {
  const msgLower = message.toLowerCase();
  const orderKeywords = ['orden', 'pedido', 'compra', 'envio', 'envío', 'llegó', 'llego', 'tracking', 'seguimiento', 'cuando llega', 'donde está', 'donde esta', 'estado de mi'];
  if (!orderKeywords.some(kw => msgLower.includes(kw))) return null;
  const match = message.match(/#?(\d{4,12})\b/);
  if (match) {
    const order = await findOrderByNumber(match[1]);
    if (order) return getOrderSummary(order);
    return `No encontré la orden #${match[1]}. Verificá el número o puede ser de MercadoLibre.`;
  }
  const orders = await findOrdersByWhatsApp(userId);
  if (orders.length === 0) return 'No encontré órdenes con este número. Si compraste con otro número o por ML, pasame el número de orden.';
  if (orders.length === 1) return getOrderSummary(orders[0]);
  const recent = orders.slice(0, 3);
  let summary = `Encontré ${orders.length} órdenes. Las más recientes:\n\n`;
  recent.forEach(o => { summary += `• #${o.number} (${o.date}) - ${o.paymentStatus} - ${o.shippingStatus}\n`; });
  summary += '\nDecime el número de orden para más detalles.';
  return summary;
}

function parseLeadData(rawReply) {
  const result = { cleanMessage: rawReply, leadScore: 0, motivo: null, nombre: null, derivar: false };
  const match = rawReply.match(/\[LEAD_SCORE:(\d+)\|MOTIVO:(.+?)\|NOMBRE:(.+?)\|DERIVAR:(.+?)\]/);
  if (match) {
    result.leadScore = parseInt(match[1], 10);
    result.motivo = match[2].trim();
    const nombre = match[3].trim();
    if (nombre.toLowerCase() !== 'desconocido') result.nombre = nombre;
    result.derivar = match[4].trim().toLowerCase() === 'si';
  } else {
    const scoreMatch = rawReply.match(/\[LEAD_SCORE:?\s*(\d+)/);
    if (scoreMatch) result.leadScore = parseInt(scoreMatch[1], 10);
    const motivoMatch = rawReply.match(/MOTIVO:(.+?)[\]|]/);
    if (motivoMatch) result.motivo = motivoMatch[1].trim();
    const nombreMatch = rawReply.match(/NOMBRE:(.+?)[\]|]/);
    if (nombreMatch && nombreMatch[1].trim().toLowerCase() !== 'desconocido') result.nombre = nombreMatch[1].trim();
    const derivarMatch = rawReply.match(/DERIVAR:(si|no)/i);
    if (derivarMatch) result.derivar = derivarMatch[1].toLowerCase() === 'si';
  }
  result.cleanMessage = rawReply.replace(/\[LEAD_SCORE.*?\]/g, '').replace(/\n\s*$/g, '').trim();
  return result;
}

async function generateResponse(userId, userMessage) {
  try {
    if (!GEMINI_API_KEY) {
      console.error('❌ GEMINI_API_KEY no configurada');
      return { text: null, leadData: null };
    }
    const isFirst = isFirstMessage(userId);
    const orderInfo = await detectAndFetchOrder(userMessage, userId);
    addToHistory(userId, 'user', userMessage);
    const history = getHistory(userId);
    let systemPrompt = await getSystemPrompt();
    if (orderInfo) systemPrompt += `\n\nINFORMACIÓN DE ORDEN (usá estos datos para responder):\n${orderInfo}`;
    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: isFirst ? 'Entendido, lista para ayudar.' : 'Continuando conversación...' }] },
      ...history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }))
    ];
    const response = await axios.post(GEMINI_URL, {
      contents,
      generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 500, candidateCount: 1 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    }, { headers: { 'Content-Type': 'application/json' } });
    const rawReply = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawReply) {
      console.error('Respuesta vacía de Gemini:', response.data);
      return { text: null, leadData: null };
    }
    const leadData = parseLeadData(rawReply);
    addToHistory(userId, 'assistant', leadData.cleanMessage);
    return { text: leadData.cleanMessage, leadData };
  } catch (error) {
    console.error('❌ Error Gemini:', error.response?.data || error.message);
    return { text: null, leadData: null };
  }
}

function shouldHandoff(response, leadData) {
  if (leadData?.derivar) return true;
  const handoffPhrases = ['te paso con', 'te contacto con', 'te derivo', 'alguien del equipo', 'hablar con alguien'];
  return handoffPhrases.some(p => response.toLowerCase().includes(p));
}

/* ================================================================
   LEADS — NOTIFICACIONES Y GOOGLE SHEETS
   ================================================================ */
const leadSessions = new Map();

function getLeadSession(phone) {
  if (!leadSessions.has(phone)) {
    leadSessions.set(phone, {
      highestScore: 0, notifiedAt7: false, notifiedAt9: false,
      lastSheetLog: 0, messageCount: 0, nombre: null, motivo: null, lastActivity: Date.now()
    });
  }
  const s = leadSessions.get(phone);
  s.lastActivity = Date.now();
  s.messageCount++;
  return s;
}

// Limpiar leads viejos cada hora
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [key, s] of leadSessions) {
    if (s.lastActivity < cutoff) leadSessions.delete(key);
  }
}, 60 * 60 * 1000);

async function notifyOwnerWhatsApp(customerPhone, leadSession, leadData, reason) {
  if (!OWNER_PHONE) return;
  try {
    const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    let emoji = '🟡', label = 'LEAD INTERESADO';
    if (leadData.leadScore >= 9) { emoji = '🔴'; label = 'COMPRADOR CONFIRMADO'; }
    else if (leadData.leadScore >= 7) { emoji = '🟢'; label = 'LEAD DE TICKET ALTO'; }
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
    console.log(`📨 Notificación enviada al dueño para lead ${customerPhone}`);
  } catch (error) {
    console.error('❌ Error notificando al dueño:', error.message);
  }
}

async function notifyHandoff(customerPhone, customerName, conversationHist, reason) {
  if (!OWNER_PHONE) return;
  try {
    const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    const recent = conversationHist.slice(-6);
    const summary = recent.map(msg => {
      const role = msg.role === 'user' ? '👤' : '🤖';
      return `${role} ${(msg.content || '').slice(0, 120)}`;
    }).join('\n');
    const text =
      `🚨 *DERIVACIÓN A HUMANO — Casa Hedy*\n\n` +
      `👤 ${customerName || 'Sin nombre'}\n` +
      `📱 wa.me/${customerPhone}\n` +
      `📋 Motivo: ${reason}\n\n` +
      `💬 Últimos mensajes:\n${summary || 'Sin historial'}\n\n` +
      `🕐 ${now}`;
    await sendMessage(OWNER_PHONE, text);
    console.log(`🚨 Handoff notificado para ${customerPhone}`);
  } catch (error) {
    console.error('❌ Error notificando handoff:', error.message);
  }
}

async function logToSheet(customerPhone, leadSession, leadData) {
  if (!GOOGLE_SHEET_WEBHOOK) return;
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
    }, { headers: { 'Content-Type': 'application/json' } });
    console.log('📊 Lead guardado en Google Sheets');
  } catch (error) {
    console.error('❌ Error guardando en Sheet:', error.message);
  }
}

async function processLead(customerPhone, leadData) {
  const session = getLeadSession(customerPhone);
  if (leadData.nombre) session.nombre = leadData.nombre;
  if (leadData.motivo) session.motivo = leadData.motivo;
  if (leadData.leadScore > session.highestScore) session.highestScore = leadData.leadScore;
  if (leadData.leadScore >= 7 && !session.notifiedAt7) {
    session.notifiedAt7 = true;
    await notifyOwnerWhatsApp(customerPhone, session, leadData);
  }
  if (leadData.leadScore >= 9 && !session.notifiedAt9) {
    session.notifiedAt9 = true;
    await notifyOwnerWhatsApp(customerPhone, session, leadData, 'UPGRADE: Pasó a comprador confirmado');
  }
  const now = Date.now();
  if (leadData.leadScore >= 7 || session.messageCount % 3 === 0 || (now - session.lastSheetLog > 60000)) {
    session.lastSheetLog = now;
    await logToSheet(customerPhone, session, leadData);
  }
}

/* ================================================================
   PROCESAMIENTO DE MENSAJES ENTRANTES
   ================================================================ */
async function handleIncomingMessage(body) {
  try {
    if (!body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) return;
    const value = body.entry[0].changes[0].value;
    const message = value.messages[0];
    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;
    if (value.statuses) return;
    const contactName = value.contacts?.[0]?.profile?.name || null;
    await markAsRead(messageId);

    let messageBody = '';
    if (messageType === 'text') {
      messageBody = message.text?.body?.trim() || '';
    } else if (messageType === 'interactive') {
      messageBody = message.interactive?.button_reply?.title?.trim() || message.interactive?.list_reply?.title?.trim() || '';
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
    await showTyping(from);

    const { text: aiResponse, leadData } = await generateResponse(from, messageBody);

    if (!aiResponse) {
      await sendMessage(from,
        'Hola! Gracias por escribirnos 🔪\n\n' +
        'En este momento estamos con mucha demanda. ' +
        'Podes ver todo nuestro catálogo en:\nhttps://casahedy.com.ar\n\n' +
        'O escribinos en unos minutos y te atendemos!'
      );
      return;
    }

    await sendMessage(from, aiResponse);

    if (leadData) {
      if (!leadData.nombre && contactName) leadData.nombre = contactName;
      await processLead(from, leadData);
    }

    if (shouldHandoff(aiResponse, leadData)) {
      console.log(`🚨 DERIVACIÓN — Usuario: ${from}`);
      const history = getHistory(from);
      let reason = 'Derivación solicitada';
      const lower = aiResponse.toLowerCase();
      if (lower.includes('reclamo') || lower.includes('problema')) reason = 'Reclamo o problema con pedido';
      else if (lower.includes('mercadolibre') || lower.includes('ml')) reason = 'Consulta de MercadoLibre';
      else if (lower.includes('técnic') || lower.includes('tecnic')) reason = 'Consulta técnica';
      await notifyHandoff(from, contactName || leadData?.nombre, history, reason);
    }
  } catch (error) {
    console.error('💥 Error en handleIncomingMessage:', error);
  }
}

/* ================================================================
   RUTAS EXPRESS
   ================================================================ */

// Verificación webhook (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verificación fallida');
    res.sendStatus(403);
  }
});

// Recepción de eventos (mensajes)
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  handleIncomingMessage(req.body).catch(err => console.error('💥 Error:', err));
});

// Health check
app.get('/', (req, res) => {
  res.send('Casa Hedy API OK ✅');
});

/* ================================================================
   ARRANQUE
   ================================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Casa Hedy Bot corriendo en puerto ${PORT}`);
  console.log(`📋 Variables:`);
  console.log(`   VERIFY_TOKEN: ${VERIFY_TOKEN ? '✅' : '❌'}`);
  console.log(`   WHATSAPP_TOKEN: ${WHATSAPP_TOKEN ? '✅' : '❌'}`);
  console.log(`   PHONE_NUMBER_ID: ${PHONE_NUMBER_ID ? '✅' : '❌'}`);
  console.log(`   GEMINI_API_KEY: ${GEMINI_API_KEY ? '✅' : '❌'}`);
  console.log(`   OWNER_PHONE: ${OWNER_PHONE ? '✅' : '❌'}`);
  console.log(`   TIENDANUBE: ${TIENDANUBE_ACCESS_TOKEN ? '✅' : '⚠️ no configurada'}`);
});
