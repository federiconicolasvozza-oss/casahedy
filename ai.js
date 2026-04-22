const axios = require('axios');
const { getCatalogSummary, findOrderByNumber, findOrdersByWhatsApp, getOrderSummary } = require('./tiendanube');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

/* ===================== CACHE DEL CATÁLOGO ===================== */
let catalogCache = { summary: '', lastUpdate: null };
const CATALOG_CACHE_DURATION = 5 * 60 * 1000;

async function getUpdatedCatalog() {
  const now = Date.now();
  if (catalogCache.lastUpdate && (now - catalogCache.lastUpdate) < CATALOG_CACHE_DURATION) {
    return catalogCache.summary;
  }
  try {
    const summary = await getCatalogSummary();
    catalogCache = { summary, lastUpdate: now };
    return summary;
  } catch (error) {
    console.error('Error obteniendo catálogo:', error);
    return catalogCache.summary || 'Catálogo no disponible temporalmente.';
  }
}

/* ===================== SYSTEM PROMPT ===================== */
async function getSystemPrompt() {
  const catalog = await getUpdatedCatalog();

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

/* ===================== HISTORIAL ===================== */
const conversationHistory = new Map();

function getHistory(userId) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
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
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 horas
  for (const [key] of conversationHistory) {
    // Simple cleanup — en producción podrías trackear lastActivity
    if (conversationHistory.size > 500) {
      conversationHistory.delete(key);
    }
  }
}, 30 * 60 * 1000);

/* ===================== DETECCIÓN DE ÓRDENES ===================== */
async function detectAndFetchOrder(message, userId) {
  const msgLower = message.toLowerCase();
  const orderKeywords = ['orden', 'pedido', 'compra', 'envio', 'envío', 'llegó', 'llego',
    'tracking', 'seguimiento', 'cuando llega', 'donde está', 'donde esta', 'estado de mi'];

  if (!orderKeywords.some(kw => msgLower.includes(kw))) return null;

  // Buscar número de orden
  const match = message.match(/#?(\d{4,12})\b/);
  if (match) {
    const order = await findOrderByNumber(match[1]);
    if (order) return getOrderSummary(order);
    return `No encontré la orden #${match[1]}. Verificá el número o puede ser de MercadoLibre.`;
  }

  // Buscar por WhatsApp del usuario
  const orders = await findOrdersByWhatsApp(userId);
  if (orders.length === 0) {
    return 'No encontré órdenes con este número. Si compraste con otro número o por ML, pasame el número de orden.';
  }
  if (orders.length === 1) return getOrderSummary(orders[0]);

  const recent = orders.slice(0, 3);
  let summary = `Encontré ${orders.length} órdenes. Las más recientes:\n\n`;
  recent.forEach(o => {
    summary += `• #${o.number} (${o.date}) - ${o.paymentStatus} - ${o.shippingStatus}\n`;
  });
  summary += '\nDecime el número de orden para más detalles.';
  return summary;
}

/* ===================== PARSEAR SCORING ===================== */
function parseLeadData(rawReply) {
  const result = {
    cleanMessage: rawReply,
    leadScore: 0,
    motivo: null,
    nombre: null,
    derivar: false
  };

  // Formato: [LEAD_SCORE:X|MOTIVO:desc|NOMBRE:name|DERIVAR:si/no]
  const match = rawReply.match(/\[LEAD_SCORE:(\d+)\|MOTIVO:(.+?)\|NOMBRE:(.+?)\|DERIVAR:(.+?)\]/);
  if (match) {
    result.leadScore = parseInt(match[1], 10);
    result.motivo = match[2].trim();
    const nombre = match[3].trim();
    if (nombre.toLowerCase() !== 'desconocido') result.nombre = nombre;
    result.derivar = match[4].trim().toLowerCase() === 'si';
  } else {
    // Fallback: intentar parsear formato parcial
    const scoreMatch = rawReply.match(/\[LEAD_SCORE:?\s*(\d+)/);
    if (scoreMatch) result.leadScore = parseInt(scoreMatch[1], 10);

    const motivoMatch = rawReply.match(/MOTIVO:(.+?)[\]|]/);
    if (motivoMatch) result.motivo = motivoMatch[1].trim();

    const nombreMatch = rawReply.match(/NOMBRE:(.+?)[\]|]/);
    if (nombreMatch && nombreMatch[1].trim().toLowerCase() !== 'desconocido') {
      result.nombre = nombreMatch[1].trim();
    }

    const derivarMatch = rawReply.match(/DERIVAR:(si|no)/i);
    if (derivarMatch) result.derivar = derivarMatch[1].toLowerCase() === 'si';
  }

  // Limpiar el scoring del mensaje visible
  result.cleanMessage = rawReply
    .replace(/\[LEAD_SCORE.*?\]/g, '')
    .replace(/\n\s*$/g, '')
    .trim();

  return result;
}

/* ===================== GENERAR RESPUESTA ===================== */
async function generateResponse(userId, userMessage) {
  try {
    if (!GEMINI_API_KEY) {
      console.error('❌ GEMINI_API_KEY no configurada');
      return { text: null, leadData: null };
    }

    const isFirst = isFirstMessage(userId);

    // Detectar consulta de orden
    const orderInfo = await detectAndFetchOrder(userMessage, userId);

    // Agregar al historial
    addToHistory(userId, 'user', userMessage);

    const history = getHistory(userId);
    let systemPrompt = await getSystemPrompt();

    if (orderInfo) {
      systemPrompt += `\n\nINFORMACIÓN DE ORDEN (usá estos datos para responder):\n${orderInfo}`;
    }

    // Construir mensajes para Gemini
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
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 500,
        candidateCount: 1
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const rawReply = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawReply) {
      console.error('Respuesta vacía de Gemini:', response.data);
      return { text: null, leadData: null };
    }

    // Parsear scoring
    const leadData = parseLeadData(rawReply);

    // Guardar respuesta limpia en historial
    addToHistory(userId, 'assistant', leadData.cleanMessage);

    return { text: leadData.cleanMessage, leadData };

  } catch (error) {
    console.error('❌ Error Gemini:', error.response?.data || error.message);
    return { text: null, leadData: null };
  }
}

/* ===================== DETECCIÓN DE HANDOFF ===================== */
function shouldHandoff(response, leadData) {
  if (leadData?.derivar) return true;

  const handoffPhrases = [
    'te paso con', 'te contacto con', 'te derivo',
    'alguien del equipo', 'hablar con alguien'
  ];
  return handoffPhrases.some(p => response.toLowerCase().includes(p));
}

module.exports = {
  generateResponse,
  parseLeadData,
  shouldHandoff,
  getHistory,
  isFirstMessage
};
