const axios = require('axios');

const TIENDANUBE_ACCESS_TOKEN = process.env.TIENDANUBE_ACCESS_TOKEN;
const TIENDANUBE_STORE_ID = process.env.TIENDANUBE_STORE_ID;
const TIENDANUBE_API_URL = `https://api.tiendanube.com/v1/${TIENDANUBE_STORE_ID}`;

const headers = {
  'Authentication': `bearer ${TIENDANUBE_ACCESS_TOKEN}`,
  'User-Agent': 'Casa Hedy WhatsApp Bot (info@casahedy.com.ar)',
  'Content-Type': 'application/json'
};

/* ===================== CACHE DE PRODUCTOS ===================== */
let productCache = { products: [], lastUpdate: null };
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Obtener todos los productos con paginación
async function getProducts(forceRefresh = false) {
  try {
    const now = Date.now();
    if (!forceRefresh && productCache.lastUpdate && (now - productCache.lastUpdate) < CACHE_DURATION) {
      return productCache.products;
    }

    if (!TIENDANUBE_ACCESS_TOKEN || !TIENDANUBE_STORE_ID) {
      console.log('⚠️ Tienda Nube no configurada, usando catálogo estático');
      return [];
    }

    console.log('📦 Actualizando catálogo desde Tienda Nube...');

    let allProducts = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${TIENDANUBE_API_URL}/products`, {
        headers,
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
      const hasDiscount = variant?.promotional_price &&
        parseFloat(variant.promotional_price) < parseFloat(variant.price);

      return {
        id: product.id,
        name: getSpanishText(product.name),
        description: getSpanishText(product.description),
        price: finalPrice,
        originalPrice,
        hasDiscount,
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

// Generar resumen del catálogo para el prompt de Gemini
async function getCatalogSummary() {
  const products = await getProducts();

  if (products.length === 0) {
    return 'Catálogo dinámico no disponible. Usá la información estática del prompt.';
  }

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

/* ===================== ÓRDENES ===================== */

// Buscar orden por número
async function findOrderByNumber(orderNumber) {
  try {
    if (!TIENDANUBE_ACCESS_TOKEN) return null;
    const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
    if (!cleanNumber) return null;

    console.log(`🔍 Buscando orden #${cleanNumber}...`);
    const response = await axios.get(`${TIENDANUBE_API_URL}/orders`, {
      headers,
      params: { q: cleanNumber }
    });

    const orders = response.data;
    if (!orders || orders.length === 0) return null;

    const exact = orders.find(o => String(o.number) === cleanNumber);
    return parseOrder(exact || orders[0]);
  } catch (error) {
    console.error('Error buscando orden:', error.response?.data || error.message);
    return null;
  }
}

// Buscar órdenes por WhatsApp
async function findOrdersByWhatsApp(whatsappNumber) {
  try {
    if (!TIENDANUBE_ACCESS_TOKEN) return [];
    const cleanNumber = whatsappNumber.replace(/\D/g, '');
    const localNumber = cleanNumber.slice(-10);

    const response = await axios.get(`${TIENDANUBE_API_URL}/orders`, {
      headers,
      params: { per_page: 30, sort_by: 'created_at', sort_order: 'desc' }
    });

    return response.data
      .filter(order => {
        const phone = order.contact_phone?.replace(/\D/g, '') || '';
        const billingPhone = order.billing_phone?.replace(/\D/g, '') || '';
        return phone.includes(localNumber) ||
          localNumber.includes(phone.slice(-10)) ||
          billingPhone.includes(localNumber);
      })
      .map(parseOrder);
  } catch (error) {
    console.error('Error buscando órdenes por WhatsApp:', error.response?.data || error.message);
    return [];
  }
}

// Parsear orden
function parseOrder(order) {
  const paymentMap = {
    'paid': 'Pagado', 'pending': 'Pendiente de pago',
    'refunded': 'Reembolsado', 'voided': 'Anulado', 'abandoned': 'Abandonado'
  };
  const shippingMap = {
    'shipped': 'Enviado', 'unshipped': 'Pendiente de envío',
    'partially_shipped': 'Envío parcial', 'delivered': 'Entregado'
  };

  let shippingStatus = shippingMap[order.shipping_status] || order.shipping_status || 'Pendiente';
  if (order.status === 'cancelled') shippingStatus = 'Orden cancelada';

  const date = new Date(order.created_at).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const products = order.products?.map(p => ({
    name: p.name, quantity: p.quantity, price: p.price
  })) || [];

  let trackingUrl = order.shipping_tracking_url || order.shipping_tracking_number || null;
  if (!trackingUrl && order.fulfillments?.length > 0) {
    const f = order.fulfillments[0];
    trackingUrl = f.tracking_info?.url || f.tracking_info?.code || null;
  }

  const addr = order.shipping_address || {};

  return {
    number: order.number,
    date,
    customerName: order.contact_name,
    status: order.status,
    paymentStatus: paymentMap[order.payment_status] || order.payment_status,
    shippingStatus,
    trackingUrl,
    total: formatPrice(order.total),
    products,
    productsSummary: products.map(p => `${p.quantity}x ${p.name}`).join(', ') || 'Ver detalle',
    city: addr.city || order.billing_city,
    province: addr.province || order.billing_province
  };
}

// Resumen de orden para Gemini
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
    if (order.trackingUrl && order.trackingUrl.startsWith('http')) {
      s += `Seguimiento: ${order.trackingUrl}\n`;
    }
  }
  if (order.city || order.province) {
    s += `Destino: ${order.city || ''}, ${order.province || ''}`;
  }
  return s.trim();
}

/* ===================== HELPERS ===================== */

function formatPrice(price) {
  if (!price) return 'Consultar';
  return `$${parseFloat(price).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getSpanishText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.es || field.en || Object.values(field)[0] || '';
}

module.exports = {
  getProducts,
  getCatalogSummary,
  findOrderByNumber,
  findOrdersByWhatsApp,
  getOrderSummary,
  formatPrice
};
