// ============================================================
// babyluc · Aplicación completa SPA (Dexie.js + Vanilla JS)
// ============================================================

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ==================== 1. BASE DE DATOS DEXIE.JS ====================
const db = new Dexie('babylucDB');
const DEXIE_V1_STORES = {
  empresa: 'id',
  categorias: '++id, &nombre',
  proveedores: '++id, nombre, CIF, telefono, email, fechaCreacion',
  articulos: '++id, nombre, *aliases, categoriaId, proveedorId, tipoIVA, fechaCreacion, [categoriaId+activo], [proveedorId+activo]',
  variantes: '++id, articuloId, talla, color, stock, [articuloId+talla], &[articuloId+talla+color]',
  clientes: '++id, nombre, telefono, email, fechaCreacion',
  pedidos: '++id, &numero, clienteId, nombreCliente, telefonoCliente, fecha, estado, metodoPago, numeroFactura, [estado+fecha], [clienteId+fecha]',
  lineasPedido: '++id, pedidoId, articuloId, varianteId, [pedidoId+articuloId], [articuloId+varianteId]',
  facturas_compra: '++id, proveedorId, nombreProveedor, fecha, numeroFactura, [proveedorId+fecha]',
  registros_iva: '++id, trimestre, año, estado, fechaGeneracion, &[año+trimestre], [año+estado]'
};
db.version(1).stores(DEXIE_V1_STORES);
const DEXIE_V2_STORES = {
  ...DEXIE_V1_STORES,
  movimientos_stock: '++id, fecha, articuloId, varianteId, tipo, referencia'
};
db.version(2).stores(DEXIE_V2_STORES);
db.version(3).stores({
  ...DEXIE_V2_STORES,
  articulos: '++id, codigo, nombre, *aliases, categoriaId, proveedorId, tipoIVA, fechaCreacion, [categoriaId+activo], [proveedorId+activo]'
});

// ==================== 2. UTILIDADES GLOBALES ====================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtEur = (n) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fmtFecha = (iso) => {
  if (!iso) return '—';
  const s = String(iso).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtFechaHora = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

window.calcPedidoTotales = function(p, lineas) {
  const brutoLineas = round2((lineas || []).reduce((acc, l) => acc + Number(l.cantidad || 0) * Number(l.precioUnitario || 0), 0));
  const descTipo = p?.descuentoTipo === 'pct' ? 'pct' : 'eur';
  const descVal = Math.max(0, Number(p?.descuentoValor || 0));
  const descuentoEur = round2(descTipo === 'pct' ? Math.min(brutoLineas, brutoLineas * (descVal / 100)) : Math.min(brutoLineas, descVal));
  const envio = round2(Math.max(0, Number(p?.gastosEnvio || 0)));
  const totalOriginal = round2(Math.max(0, brutoLineas - descuentoEur) + envio);
  const totalDevuelto = round2(Array.isArray(p?.devoluciones) ? p.devoluciones.reduce((acc, d) => acc + Number(d.totalDevuelto || 0), 0) : 0);
  const totalNeto = round2(Math.max(0, totalOriginal - totalDevuelto));
  return { brutoLineas, descTipo, descVal, descuentoEur, envio, totalOriginal, totalDevuelto, totalNeto };
};

window.buildWhatsAppUrl = function(telefono, mensaje) {
  let digits = String(telefono || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = '34' + digits;
  else if (digits.startsWith('00')) digits = digits.slice(2);
  return `https://wa.me/${digits}?text=${encodeURIComponent(mensaje || '')}`;
};

window.copyTextToClipboard = async function(text) {
  const value = String(text || '');
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below
    }
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
};

window.registrarMovimientoStock = async function({
  fecha,
  articuloId = null,
  varianteId = null,
  nombreArticulo = 'Artículo',
  descripcionVariante = '',
  tipo = 'ajuste_manual',
  delta = 0,
  stockResultante = null,
  referencia = '',
  nota = ''
}) {
  const numDelta = Number(delta || 0);
  if (!Number.isFinite(numDelta) || numDelta === 0) return null;
  return db.movimientos_stock.add({
    fecha: fecha || new Date().toISOString(),
    articuloId: articuloId || null,
    varianteId: varianteId || null,
    nombreArticulo: String(nombreArticulo || 'Artículo').slice(0, 200),
    descripcionVariante: String(descripcionVariante || '').slice(0, 150),
    tipo: String(tipo || 'ajuste_manual').slice(0, 40),
    delta: numDelta,
    stockResultante: stockResultante === null || stockResultante === undefined ? null : Number(stockResultante),
    referencia: String(referencia || '').slice(0, 80),
    nota: String(nota || '').slice(0, 300)
  });
};

window.showToast = function(mensaje, tipo = 'success') {
  const cont = document.getElementById('toast-container');
  if (!cont) return;
  const styles = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    warning: 'bg-amber-500 text-white'
  };
  const el = document.createElement('div');
  el.className = `pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition transform duration-200 ${styles[tipo] || styles.success}`;
  el.textContent = mensaje;
  cont.appendChild(el);
  setTimeout(() => {
    el.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => el.remove(), 220);
  }, 3000);
};

window.showGlobalSpinner = (text = 'Procesando...') => {
  document.getElementById('global-spinner-text').textContent = text;
  document.getElementById('global-async-spinner').classList.remove('hidden');
};
window.hideGlobalSpinner = () => {
  document.getElementById('global-async-spinner').classList.add('hidden');
};

window.generateCSV = function(headers, rows, filename) {
  const escCsv = (val) => {
    const s = String(val ?? '').replace(/\r?\n/g, ' ');
    return (s.includes(',') || s.includes('"') || s.includes(';')) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escCsv).join(','), ...rows.map(r => r.map(escCsv).join(','))];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(`Exportado ${a.download}`, 'success');
};

// ==================== 3. ROUTER SPA ====================
const ROUTE_TITLES = { stock: 'Stock', pedidos: 'Pedidos', clientes: 'Clientes', proveedores: 'Proveedores', balances: 'Balances', ajustes: 'Ajustes' };

window.navigateTo = function(route, opts = {}) {
  if (!ROUTE_TITLES[route]) route = 'stock';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  Object.keys(ROUTE_TITLES).forEach(r => {
    const sec = document.getElementById(`view-${r}`);
    if (sec) sec.classList.toggle('hidden', r !== route);
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    const active = btn.dataset.nav === route;
    btn.className = active
      ? 'nav-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2]'
      : 'nav-btn w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer text-gray-600 hover:bg-gray-100 border border-transparent';
  });

  document.querySelectorAll('.nav-btn-mob').forEach(btn => {
    const active = btn.dataset.nav === route;
    btn.classList.toggle('text-[#727D6E]', active);
    btn.classList.toggle('font-bold', active);
    btn.classList.toggle('text-gray-500', !active);
  });

  document.getElementById('mobile-section-title').textContent = ROUTE_TITLES[route];
  document.getElementById('desktop-breadcrumb').textContent = `babyluc · ${ROUTE_TITLES[route]}`;

  if (!opts.skipEnter) {
    if (route === 'stock') { StockModule.refresh(); recalcularAlertasStock(false); }
    else if (route === 'pedidos') PedidosModule.onEnterView();
    else if (route === 'clientes') ClientesModule.onEnterView();
    else if (route === 'proveedores') ProveedoresModule.onEnterView();
    else if (route === 'balances') BalancesModule.onEnterView();
    else if (route === 'ajustes') { AjustesModule.load(); PinAndAjustesExtra.refreshAjustesExtra(); }
  }
};

window.recalcularAlertasStock = async function(notificar = false) {
  const [emp, arts, vars] = await Promise.all([db.empresa.get(1), db.articulos.toArray(), db.variantes.toArray()]);
  const globalUmbral = Number(emp?.umbralStockGlobal ?? 3);
  const artMap = new Map(arts.filter(a => a.activo !== false).map(a => [a.id, a]));
  let bajas = 0;
  for (const v of vars) {
    const a = artMap.get(v.articuloId);
    if (!a) continue;
    const umbral = (a.umbralAlerta !== null && a.umbralAlerta !== undefined && a.umbralAlerta !== '')
      ? Number(a.umbralAlerta) : globalUmbral;
    if (Number(v.stock || 0) <= umbral) bajas++;
  }
  document.querySelectorAll('.nav-stock-badge').forEach(el => {
    el.textContent = String(bajas);
    el.classList.toggle('hidden', bajas === 0);
  });
  if (notificar && bajas > 0) showToast(`${bajas} variante(s) con stock bajo`, 'warning');
  return bajas;
};

// ==================== 4. CATÁLOGOS DE TALLAS/COLORES Y AJUSTES ====================
const DEFAULT_TALLAS_CATALOGO = [
  'Única',
  // Bebé (meses y prematuro)
  'Prematuro', '0m', '0-1m', '1m', '0-3m', '1-3m', '3m', '3-6m', '6m', '6-9m', '9m', '9-12m',
  '12m', '12-18m', '18m', '18-24m', '24m', '24-36m', '36m',
  // Bebé (tallas europeas por cm)
  '50', '56', '62', '68', '74', '80', '86', '92', '98',
  // Niño / Junior (años)
  '2a', '2-3a', '3a', '3-4a', '4a', '4-5a', '5a', '5-6a', '6a', '6-7a', '7a', '8a', '9a', '10a', '11a', '12a', '13a', '14a', '16a',
  // Adulto (letras)
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL',
  // Calzado bebé/infantil y adulto + tallas numéricas
  '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '44', '46', '48', '50'
];

const DEFAULT_COLORES_CATALOGO = [
  'Estándar',
  // Neutros y básicos
  'Blanco', 'Crudo', 'Marfil', 'Beige', 'Arena', 'Piedra', 'Topo', 'Gris', 'Gris claro', 'Gris marengo', 'Antracita', 'Negro',
  // Rosas, rojos y corales
  'Rosa', 'Rosa empolvado', 'Rosa palo', 'Rosa bebé', 'Fucsia', 'Magenta', 'Salmón', 'Coral', 'Melocotón', 'Rojo', 'Cereza', 'Granate', 'Burdeos', 'Teja',
  // Azules y verdes
  'Azul', 'Azul bebé', 'Celeste', 'Cielo', 'Azulón', 'Turquesa', 'Aguamarina', 'Azul marino', 'Teal', 'Petróleo', 'Denim', 'Vaquero',
  'Verde', 'Verde agua', 'Menta', 'Salvia', 'Pistacho', 'Esmeralda', 'Verde botella', 'Caqui', 'Oliva', 'Militar',
  // Amarillos, naranjas, marrones y morados
  'Amarillo', 'Vainilla', 'Limón', 'Mostaza', 'Ocre', 'Naranja', 'Calabaza', 'Terracota', 'Camel', 'Tostado', 'Marrón', 'Chocolate',
  'Lila', 'Lavanda', 'Malva', 'Morado', 'Berenjena',
  // Metálicos y estampados
  'Dorado', 'Plateado', 'Multicolor', 'Estampado', 'Rayas', 'Cuadros', 'Vichy', 'Flores', 'Topos'
];

const VariantComboModule = (() => {
  let tallas = [...DEFAULT_TALLAS_CATALOGO];
  let colores = [...DEFAULT_COLORES_CATALOGO];
  let activeInput = null;
  let internalDispatch = false;
  let initialized = false;

  const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function mergeUnique(baseList, extraList) {
    const out = [];
    const seen = new Set();
    for (const item of [...baseList, ...extraList]) {
      const clean = String(item || '').trim();
      if (!clean || clean.startsWith('__tmp')) continue;
      const k = norm(clean);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(clean);
      }
    }
    return out;
  }

  async function refreshCatalog() {
    try {
      const [emp, vars] = await Promise.all([db.empresa.get(1), db.variantes.toArray()]);
      const baseTallas = Array.isArray(emp?.tallasCatalogo) && emp.tallasCatalogo.length ? emp.tallasCatalogo : DEFAULT_TALLAS_CATALOGO;
      const baseColores = Array.isArray(emp?.coloresCatalogo) && emp.coloresCatalogo.length ? emp.coloresCatalogo : DEFAULT_COLORES_CATALOGO;
      tallas = mergeUnique(baseTallas, vars.map(v => v.talla));
      colores = mergeUnique(baseColores, vars.map(v => v.color));
    } catch { /* ignore */ }
  }

  function close() {
    const menu = document.getElementById('babyluc-combo-menu');
    if (menu) menu.classList.add('hidden');
    activeInput = null;
  }

  function positionMenu(inputEl, menu) {
    const rect = inputEl.getBoundingClientRect();
    const minW = Math.max(rect.width, 175);
    const maxW = Math.min(280, window.innerWidth - 16);
    const width = Math.min(minW, maxW);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      menu.style.top = 'auto';
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = `${rect.bottom + 4}px`;
    }
  }

  function openMenu(inputEl, { showAll = false } = {}) {
    const menu = document.getElementById('babyluc-combo-menu');
    if (!menu || !inputEl) return;
    activeInput = inputEl;
    const kind = inputEl.dataset.comboKind === 'color' ? 'color' : 'talla';
    const items = kind === 'color' ? colores : tallas;
    const rawVal = String(inputEl.value || '').trim();
    const q = norm(rawVal);
    const isExactMatch = q !== '' && items.some(it => norm(it) === q);
    const filtered = (showAll || !q || isExactMatch)
      ? items
      : items.filter(it => norm(it).includes(q));

    const customOptHtml = (rawVal && !isExactMatch && !showAll)
      ? `<button type="button" data-combo-opt="${encodeURIComponent(rawVal)}" class="w-full text-left px-3 py-1.5 hover:bg-[#F5F7F4] text-emerald-700 font-semibold border-b border-gray-100 cursor-pointer flex items-center justify-between"><span>✓ Usar "${esc(rawVal)}"</span><span class="text-[10px] text-gray-400">Personalizado</span></button>`
      : '';

    const optsHtml = filtered.map(it => {
      const active = q !== '' && norm(it) === q;
      return `<button type="button" data-combo-opt="${encodeURIComponent(it)}" class="w-full text-left px-3 py-1.5 hover:bg-[#F5F7F4] cursor-pointer flex items-center justify-between ${active ? 'bg-[#EAEEE9] font-bold text-gray-900' : 'text-gray-700'}"><span>${esc(it)}</span>${active ? '<span class="text-[10px] text-[#727D6E]">Actual</span>' : ''}</button>`;
    }).join('');

    const emptyHtml = (!optsHtml && !customOptHtml)
      ? '<div class="px-3 py-2 text-gray-400 text-[11px]">Sin coincidencias — escribe libremente</div>'
      : '';

    menu.innerHTML = customOptHtml + optsHtml + emptyHtml;
    menu.classList.remove('hidden');
    positionMenu(inputEl, menu);
    const activeBtn = menu.querySelector('.bg-\\[\\#EAEEE9\\]');
    if (activeBtn && showAll) {
      activeBtn.scrollIntoView({ block: 'nearest' });
    } else {
      menu.scrollTop = 0;
    }
  }

  function selectValue(val) {
    const inp = activeInput;
    close();
    if (!inp) return;
    internalDispatch = true;
    inp.value = val;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    internalDispatch = false;
  }

  function init() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-combo-btn]');
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const inp = btn.parentElement?.querySelector('input[data-combo-kind]');
        if (!inp) return;
        const menu = document.getElementById('babyluc-combo-menu');
        const alreadyOpenForThis = activeInput === inp && menu && !menu.classList.contains('hidden');
        if (alreadyOpenForThis) {
          close();
          return;
        }
        openMenu(inp, { showAll: true });
        return;
      }
      const inp = e.target.closest('input[data-combo-kind]');
      if (inp) {
        openMenu(inp, { showAll: false });
      }
    });

    document.addEventListener('focusin', (e) => {
      const inp = e.target.closest('input[data-combo-kind]');
      if (inp) openMenu(inp, { showAll: false });
    });

    document.addEventListener('input', (e) => {
      if (internalDispatch) return;
      const inp = e.target.closest('input[data-combo-kind]');
      if (inp) openMenu(inp, { showAll: false });
    });

    document.addEventListener('mousedown', (e) => {
      const menu = document.getElementById('babyluc-combo-menu');
      const opt = e.target.closest('#babyluc-combo-menu [data-combo-opt]');
      if (opt) {
        e.preventDefault();
        selectValue(decodeURIComponent(opt.dataset.comboOpt || ''));
        return;
      }
      if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(e.target) && !e.target.closest('input[data-combo-kind]') && !e.target.closest('[data-combo-btn]')) {
          close();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    window.addEventListener('scroll', (e) => {
      const menu = document.getElementById('babyluc-combo-menu');
      if (!menu || menu.classList.contains('hidden')) return;
      if (e.target && (e.target === menu || (e.target.nodeType === 1 && menu.contains(e.target)))) return;
      close();
    }, true);
  }

  return { init, refreshCatalog, close };
})();

const AjustesModule = (() => {
  let logoBase64 = '';

  async function ensureDefault() {
    let emp = await db.empresa.get(1);
    if (!emp) {
      emp = {
        id: 1, nombre: 'babyluc', cif: '', direccion: '', telefono: '', email: '',
        logo: '', mensajeAlbaran: '¡Gracias por tu compra en babyluc!',
        ivaDefecto: 21, pedidosPorPagina: 10, umbralStockGlobal: 3,
        pinHash: '', pinActivo: false,
        ultimoNumeroPedido: { año: new Date().getFullYear(), numero: 0 },
        ultimoNumeroFactura: { año: new Date().getFullYear(), numero: 0 },
        apiKeyGemini: '',
        tiposPortes: [],
        tallasCatalogo: [...DEFAULT_TALLAS_CATALOGO],
        coloresCatalogo: [...DEFAULT_COLORES_CATALOGO]
      };
      await db.empresa.put(emp);
      return emp;
    }
    let changed = false;
    if (!Array.isArray(emp.tallasCatalogo) || emp.tallasCatalogo.length === 0) {
      emp.tallasCatalogo = [...DEFAULT_TALLAS_CATALOGO];
      changed = true;
    }
    if (!Array.isArray(emp.coloresCatalogo) || emp.coloresCatalogo.length === 0) {
      emp.coloresCatalogo = [...DEFAULT_COLORES_CATALOGO];
      changed = true;
    }
    if (changed) await db.empresa.put(emp);
    return emp;
  }

  function renderPortes(portes) {
    const listEl = document.getElementById('aj-portes-list');
    const emptyEl = document.getElementById('aj-portes-empty');
    if (!listEl || !emptyEl) return;
    const arr = Array.isArray(portes) ? portes : [];
    emptyEl.classList.toggle('hidden', arr.length > 0);
    listEl.classList.toggle('hidden', arr.length === 0);
    listEl.innerHTML = arr.map(pt => `
      <div class="p-3 flex flex-col sm:flex-row sm:items-center gap-2 bg-white">
        <input type="text" value="${esc(pt.nombre || '')}" data-porte-name="${pt.id}" placeholder="Nombre del porte" class="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white" />
        <div class="flex items-center gap-2">
          <div class="relative w-32">
            <input type="number" min="0" step="0.01" value="${Number(pt.precio || 0).toFixed(2)}" data-porte-price="${pt.id}" class="w-full pr-7 pl-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-right" />
            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">€</span>
          </div>
          <button type="button" data-porte-del="${pt.id}" class="px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold cursor-pointer">✕</button>
        </div>
      </div>`).join('');
  }

  function renderTallasColores(emp) {
    const tallasArr = Array.isArray(emp?.tallasCatalogo) ? emp.tallasCatalogo : [];
    const coloresArr = Array.isArray(emp?.coloresCatalogo) ? emp.coloresCatalogo : [];
    const tCount = document.getElementById('aj-tallas-count');
    const cCount = document.getElementById('aj-colores-count');
    const tList = document.getElementById('aj-tallas-list');
    const cList = document.getElementById('aj-colores-list');
    if (tCount) tCount.textContent = `${tallasArr.length} talla(s)`;
    if (cCount) cCount.textContent = `${coloresArr.length} color(es)`;
    if (tList) {
      tList.innerHTML = tallasArr.map((t, idx) => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-800">
          ${esc(t)}
          <button type="button" data-aj-tc-del="talla:${idx}" class="text-gray-400 hover:text-red-600 font-bold cursor-pointer">×</button>
        </span>`).join('');
    }
    if (cList) {
      cList.innerHTML = coloresArr.map((c, idx) => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-800">
          ${esc(c)}
          <button type="button" data-aj-tc-del="color:${idx}" class="text-gray-400 hover:text-red-600 font-bold cursor-pointer">×</button>
        </span>`).join('');
    }
  }

  async function load() {
    const emp = await ensureDefault();
    document.getElementById('aj-nombre').value = emp.nombre || '';
    document.getElementById('aj-cif').value = emp.cif || '';
    document.getElementById('aj-direccion').value = emp.direccion || '';
    document.getElementById('aj-telefono').value = emp.telefono || '';
    document.getElementById('aj-email').value = emp.email || '';
    document.getElementById('aj-iva').value = '21';
    document.getElementById('aj-paginacion').value = String(emp.pedidosPorPagina ?? 10);
    document.getElementById('aj-umbral').value = String(emp.umbralStockGlobal ?? 3);
    document.getElementById('aj-mensaje-albaran').value = emp.mensajeAlbaran || '';

    logoBase64 = emp.logo || '';
    const prev = document.getElementById('aj-logo-preview');
    const rem = document.getElementById('aj-logo-remove');
    if (logoBase64) {
      prev.src = logoBase64;
      prev.classList.remove('hidden');
      rem.classList.remove('hidden');
    } else {
      prev.classList.add('hidden');
      rem.classList.add('hidden');
    }
    renderPortes(emp.tiposPortes || []);
    renderTallasColores(emp);
  }

  function init() {
    document.getElementById('aj-logo-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 480;
          const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
          const cw = Math.max(1, Math.round(img.width * ratio));
          const ch = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
          let out = canvas.toDataURL('image/png');
          if (out.length > 450000) out = canvas.toDataURL('image/jpeg', 0.82);
          logoBase64 = out;
          const prev = document.getElementById('aj-logo-preview');
          prev.src = logoBase64;
          prev.classList.remove('hidden');
          document.getElementById('aj-logo-remove').classList.remove('hidden');
        };
        img.onerror = () => {
          logoBase64 = String(reader.result || '').slice(0, 650000);
          const prev = document.getElementById('aj-logo-preview');
          prev.src = logoBase64;
          prev.classList.remove('hidden');
          document.getElementById('aj-logo-remove').classList.remove('hidden');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('aj-logo-remove').addEventListener('click', () => {
      logoBase64 = '';
      document.getElementById('aj-logo-input').value = '';
      document.getElementById('aj-logo-preview').classList.add('hidden');
      document.getElementById('aj-logo-remove').classList.add('hidden');
    });

    document.getElementById('form-ajustes').addEventListener('submit', async (e) => {
      e.preventDefault();
      const emp = await ensureDefault();
      await db.empresa.put({
        ...emp,
        id: 1,
        nombre: document.getElementById('aj-nombre').value.trim() || 'babyluc',
        cif: document.getElementById('aj-cif').value.trim(),
        direccion: document.getElementById('aj-direccion').value.trim(),
        telefono: document.getElementById('aj-telefono').value.trim(),
        email: document.getElementById('aj-email').value.trim(),
        logo: logoBase64,
        ivaDefecto: Number(document.getElementById('aj-iva').value) || 21,
        pedidosPorPagina: Number(document.getElementById('aj-paginacion').value) || 10,
        umbralStockGlobal: Math.max(0, Number(document.getElementById('aj-umbral').value || 0)),
        mensajeAlbaran: document.getElementById('aj-mensaje-albaran').value.trim()
      });
      await recalcularAlertasStock(false);
      showToast('Ajustes guardados correctamente', 'success');
    });

    const addPorteHandler = async () => {
      const nomEl = document.getElementById('aj-porte-nombre');
      const preEl = document.getElementById('aj-porte-precio');
      const nombre = (nomEl?.value || '').trim();
      const precio = round2(Math.max(0, parseFloat(preEl?.value || '0') || 0));
      if (!nombre) return showToast('Indica un nombre para el porte', 'warning');
      const emp = await ensureDefault();
      const tiposPortes = [...(Array.isArray(emp.tiposPortes) ? emp.tiposPortes : []), { id: Date.now(), nombre, precio }];
      await db.empresa.put({ ...emp, id: 1, tiposPortes });
      if (nomEl) nomEl.value = '';
      if (preEl) preEl.value = '';
      renderPortes(tiposPortes);
      showToast('Tipo de porte añadido', 'success');
    };
    document.getElementById('aj-porte-add')?.addEventListener('click', addPorteHandler);
    ['aj-porte-nombre', 'aj-porte-precio'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addPorteHandler(); }
      });
    });

    document.getElementById('aj-portes-list')?.addEventListener('change', async (e) => {
      const emp = await ensureDefault();
      const tiposPortes = [...(Array.isArray(emp.tiposPortes) ? emp.tiposPortes : [])];
      if (e.target.dataset.porteName !== undefined) {
        const pid = Number(e.target.dataset.porteName);
        const item = tiposPortes.find(x => Number(x.id) === pid);
        if (!item) return;
        const nuevo = e.target.value.trim();
        if (!nuevo) { e.target.value = item.nombre; return showToast('El nombre no puede estar vacío', 'warning'); }
        item.nombre = nuevo;
        await db.empresa.put({ ...emp, id: 1, tiposPortes });
        showToast('Porte actualizado', 'success');
      } else if (e.target.dataset.portePrice !== undefined) {
        const pid = Number(e.target.dataset.portePrice);
        const item = tiposPortes.find(x => Number(x.id) === pid);
        if (!item) return;
        const precio = round2(Math.max(0, parseFloat(e.target.value || '0') || 0));
        item.precio = precio;
        e.target.value = precio.toFixed(2);
        await db.empresa.put({ ...emp, id: 1, tiposPortes });
        showToast('Precio del porte actualizado', 'success');
      }
    });

    document.getElementById('aj-portes-list')?.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-porte-del]');
      if (!del) return;
      const pid = Number(del.dataset.porteDel);
      const emp = await ensureDefault();
      const tiposPortes = (Array.isArray(emp.tiposPortes) ? emp.tiposPortes : []).filter(x => Number(x.id) !== pid);
      await db.empresa.put({ ...emp, id: 1, tiposPortes });
      renderPortes(tiposPortes);
      showToast('Tipo de porte eliminado', 'success');
    });

    const addCatalogoItem = async (kind) => {
      const inp = document.getElementById(kind === 'talla' ? 'aj-talla-add-input' : 'aj-color-add-input');
      const val = (inp?.value || '').trim();
      if (!val) return showToast(`Escribe un ${kind === 'talla' ? 'talla' : 'color'} para añadir`, 'warning');
      const emp = await ensureDefault();
      const field = kind === 'talla' ? 'tallasCatalogo' : 'coloresCatalogo';
      const arr = Array.isArray(emp[field]) ? [...emp[field]] : [];
      if (arr.some(x => String(x || '').trim().toLowerCase() === val.toLowerCase())) {
        return showToast(`Ese ${kind} ya está en el catálogo`, 'warning');
      }
      arr.push(val);
      const nextEmp = { ...emp, id: 1, [field]: arr };
      await db.empresa.put(nextEmp);
      if (inp) inp.value = '';
      renderTallasColores(nextEmp);
      await VariantComboModule.refreshCatalog();
      showToast(`${kind === 'talla' ? 'Talla añadida' : 'Color añadido'} al catálogo`, 'success');
    };
    document.getElementById('aj-talla-add-btn')?.addEventListener('click', () => addCatalogoItem('talla'));
    document.getElementById('aj-color-add-btn')?.addEventListener('click', () => addCatalogoItem('color'));
    document.getElementById('aj-talla-add-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCatalogoItem('talla'); }
    });
    document.getElementById('aj-color-add-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCatalogoItem('color'); }
    });

    const delCatalogoHandler = async (e) => {
      const btn = e.target.closest('[data-aj-tc-del]');
      if (!btn) return;
      const [kind, idxStr] = String(btn.dataset.ajTcDel || '').split(':');
      const idx = Number(idxStr);
      const emp = await ensureDefault();
      const field = kind === 'talla' ? 'tallasCatalogo' : 'coloresCatalogo';
      const arr = Array.isArray(emp[field]) ? [...emp[field]] : [];
      if (idx < 0 || idx >= arr.length) return;
      if (arr.length <= 1) return showToast('Debe quedar al menos un elemento en el catálogo', 'warning');
      arr.splice(idx, 1);
      const nextEmp = { ...emp, id: 1, [field]: arr };
      await db.empresa.put(nextEmp);
      renderTallasColores(nextEmp);
      await VariantComboModule.refreshCatalog();
      showToast('Eliminado del catálogo', 'success');
    };
    document.getElementById('aj-tallas-list')?.addEventListener('click', delCatalogoHandler);
    document.getElementById('aj-colores-list')?.addEventListener('click', delCatalogoHandler);

    document.getElementById('aj-tc-reset')?.addEventListener('click', async () => {
      const emp = await ensureDefault();
      const nextEmp = {
        ...emp,
        id: 1,
        tallasCatalogo: [...DEFAULT_TALLAS_CATALOGO],
        coloresCatalogo: [...DEFAULT_COLORES_CATALOGO]
      };
      await db.empresa.put(nextEmp);
      renderTallasColores(nextEmp);
      await VariantComboModule.refreshCatalog();
      showToast('Catálogo de tallas y colores restaurado', 'success');
    });
  }

  return { init, load, ensureDefault };
})();

// ==================== 5. MÓDULO STOCK + ESCÁNER FACTURAS ====================
const StockModule = (() => {
  const MOV_META = {
    compra: { label: 'Compra / Factura', cls: 'bg-emerald-100 text-emerald-800' },
    venta: { label: 'Venta / Pedido', cls: 'bg-blue-100 text-blue-800' },
    devolucion: { label: 'Devolución', cls: 'bg-amber-100 text-amber-800' },
    cancelacion: { label: 'Cancelación pedido', cls: 'bg-teal-100 text-teal-800' },
    ajuste_manual: { label: 'Ajuste manual', cls: 'bg-gray-100 text-gray-700' },
    eliminacion_pedido: { label: 'Eliminación pedido', cls: 'bg-orange-100 text-orange-800' },
    baja_articulo: { label: 'Baja artículo', cls: 'bg-red-100 text-red-700' }
  };
  let activeTab = 'articulos';
  let filterLowOnly = false;
  let editArtId = null;
  let modalAliases = [];
  let modalVars = [];

  async function getFilteredMovimientos() {
    const movs = await db.movimientos_stock.toArray();
    const q = (document.getElementById('mov-search')?.value || '').trim().toLowerCase();
    const tipo = document.getElementById('mov-filter-tipo')?.value || '';
    const desde = document.getElementById('mov-desde')?.value || '';
    const hasta = document.getElementById('mov-hasta')?.value || '';
    return movs
      .filter(m => {
        if (tipo && m.tipo !== tipo) return false;
        const ymd = String(m.fecha || '').slice(0, 10);
        if (desde && ymd < desde) return false;
        if (hasta && ymd > hasta) return false;
        if (q) {
          const hit = (m.nombreArticulo || '').toLowerCase().includes(q)
            || (m.descripcionVariante || '').toLowerCase().includes(q)
            || (m.referencia || '').toLowerCase().includes(q)
            || (m.nota || '').toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (Number(b.id) - Number(a.id)));
  }

  async function renderMovimientos() {
    const tbody = document.getElementById('mov-tbody');
    const emptyEl = document.getElementById('mov-empty');
    if (!tbody || !emptyEl) return;
    const list = await getFilteredMovimientos();
    emptyEl.classList.toggle('hidden', list.length > 0);
    tbody.innerHTML = list.slice(0, 300).map(m => {
      const meta = MOV_META[m.tipo] || { label: m.tipo || 'Ajuste', cls: 'bg-gray-100 text-gray-700' };
      const d = Number(m.delta || 0);
      const deltaTxt = d > 0 ? `+${d}` : String(d);
      const deltaCls = d > 0 ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold';
      const refNota = [m.referencia ? `Ref: ${m.referencia}` : '', m.nota || ''].filter(Boolean).join(' · ') || '—';
      return `
        <tr class="hover:bg-gray-50">
          <td class="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">${fmtFechaHora(m.fecha)}</td>
          <td class="px-4 py-2.5 font-semibold text-gray-900">${esc(m.nombreArticulo || 'Artículo')}</td>
          <td class="px-4 py-2.5 text-xs text-gray-600">${esc(m.descripcionVariante || '—')}</td>
          <td class="px-4 py-2.5 whitespace-nowrap"><span class="px-2 py-0.5 rounded-lg text-[11px] font-semibold ${meta.cls}">${esc(meta.label)}</span></td>
          <td class="px-4 py-2.5 text-center ${deltaCls}">${deltaTxt}</td>
          <td class="px-4 py-2.5 text-center text-xs font-semibold text-gray-700">${m.stockResultante !== null && m.stockResultante !== undefined ? m.stockResultante : '—'}</td>
          <td class="px-4 py-2.5 text-xs text-gray-500">${esc(refNota)}</td>
        </tr>`;
    }).join('');
  }

  async function refresh() {
    const [arts, vars, cats, provs, emp, facs] = await Promise.all([
      db.articulos.toArray(), db.variantes.toArray(), db.categorias.toArray(), db.proveedores.toArray(), db.empresa.get(1), db.facturas_compra.toArray()
    ]);
    const activos = arts.filter(a => a.activo !== false);
    const catMap = new Map(cats.map(c => [c.id, c.nombre]));
    const provMap = new Map(provs.map(p => [p.id, p.nombre]));
    const globalUmbral = Number(emp?.umbralStockGlobal ?? 3);

    // Artículos incluidos en facturas de compra en estado pendiente de recibir
    const pendingByArtId = new Map();
    facs.filter(f => getFacturaCompraEstado(f) === 'pendiente_recibir').forEach(f => {
      (Array.isArray(f.articulos) ? f.articulos : []).forEach(line => {
        if (!line || line._skipStock || line.afectaStock === false) return;
        const matched = fcResolveMatchForLine(activos, line);
        if (!matched) return;
        const lineQty = Array.isArray(line.variantes) && line.variantes.length
          ? line.variantes.reduce((s, v) => s + Math.max(0, Number(v.cantidad || 0)), 0)
          : Math.max(0, Number(line.cantidad || 0));
        if (!pendingByArtId.has(matched.id)) {
          pendingByArtId.set(matched.id, { totalUds: 0, facturas: [] });
        }
        const entry = pendingByArtId.get(matched.id);
        entry.totalUds += lineQty;
        const refLabel = `${f.numeroFactura || 'S/N'}${f.nombreProveedor ? ` · ${f.nombreProveedor}` : ''}`;
        if (!entry.facturas.includes(refLabel)) entry.facturas.push(refLabel);
      });
    });

    // Poblar filtros y datalists
    const selCat = document.getElementById('stock-filter-cat');
    const prevCat = selCat.value;
    selCat.innerHTML = '<option value="">Todas las categorías</option>' + cats.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    selCat.value = prevCat;

    const selProv = document.getElementById('stock-filter-prov');
    const prevProv = selProv.value;
    selProv.innerHTML = '<option value="">Todos los proveedores</option>' + provs.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    selProv.value = prevProv;

    document.getElementById('dl-categorias').innerHTML = cats.map(c => `<option value="${esc(c.nombre)}"></option>`).join('');
    document.getElementById('dl-proveedores').innerHTML = provs.map(p => `<option value="${esc(p.nombre)}"></option>`).join('');

    // Render Tab Artículos
    const q = document.getElementById('stock-search').value.trim().toLowerCase();
    const fCat = selCat.value ? Number(selCat.value) : null;
    const fProv = selProv.value ? Number(selProv.value) : null;

    const varsByArt = new Map();
    vars.forEach(v => {
      if (!varsByArt.has(v.articuloId)) varsByArt.set(v.articuloId, []);
      varsByArt.get(v.articuloId).push(v);
    });

    const filtered = activos.filter(a => {
      if (fCat && a.categoriaId !== fCat) return false;
      if (fProv && a.proveedorId !== fProv) return false;
      if (q) {
        const ok = (a.nombre || '').toLowerCase().includes(q) ||
          (a.codigo || '').toLowerCase().includes(q) ||
          (Array.isArray(a.aliases) && a.aliases.some(al => (al || '').toLowerCase().includes(q)));
        if (!ok) return false;
      }
      const aVars = varsByArt.get(a.id) || [];
      const umbral = (a.umbralAlerta !== null && a.umbralAlerta !== undefined && a.umbralAlerta !== '') ? Number(a.umbralAlerta) : globalUmbral;
      const hasLow = aVars.some(v => Number(v.stock || 0) <= umbral);
      if (filterLowOnly && !hasLow) return false;
      return true;
    });

    const listEl = document.getElementById('stock-articulos-list');
    const emptyEl = document.getElementById('stock-articulos-empty');
    if (!filtered.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.innerHTML = filtered.map(a => {
        const aVars = varsByArt.get(a.id) || [];
        const totalStock = aVars.reduce((acc, v) => acc + Number(v.stock || 0), 0);
        const umbral = (a.umbralAlerta !== null && a.umbralAlerta !== undefined && a.umbralAlerta !== '') ? Number(a.umbralAlerta) : globalUmbral;
        const hasLow = aVars.some(v => Number(v.stock || 0) <= umbral);
        const pend = pendingByArtId.get(a.id);
        const pendTitle = pend ? `Pendiente de recibir en factura(s): ${pend.facturas.join(', ')}` : '';
        const pendBadge = pend
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 font-semibold" title="${esc(pendTitle)}">🚚 Pedido${pend.totalUds > 0 ? ` · +${pend.totalUds} ud${pend.totalUds === 1 ? '' : 's'}` : ''}</span>`
          : '';
        const varBadges = aVars.slice(0, 6).map(v => {
          const st = Number(v.stock || 0);
          const isLow = st <= umbral;
          return `<span class="px-2 py-0.5 rounded-md border text-[11px] ${isLow ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-gray-50 border-gray-200 text-gray-700'}">${esc(v.talla || 'Única')} / ${esc(v.color || 'Estándar')}: <strong>${st}</strong></span>`;
        }).join('');
        const extraVars = aVars.length > 6 ? `<span class="px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[11px]">+${aVars.length - 6} más</span>` : '';
        const cardBorder = hasLow ? 'border-amber-300' : (pend ? 'border-sky-200' : 'border-gray-200');
        return `
          <div data-open-art="${a.id}" class="bg-white border ${cardBorder} rounded-2xl p-4 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3">
            <div>
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <h3 class="font-bold text-gray-900 leading-snug">${esc(a.nombre)}</h3>
                  ${a.codigo ? `<span class="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono text-[10px]">Cód: ${esc(a.codigo)}</span>` : ''}
                </div>
                <span class="text-sm font-bold text-[#727D6E] whitespace-nowrap">${fmtEur(a.precioVenta)}</span>
              </div>
              ${a.aliases?.length ? `<p class="text-xs text-gray-400 mt-1 truncate">Alias: ${esc(a.aliases.join(', '))}</p>` : ''}
              <div class="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                ${a.categoriaId ? `<span class="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700">${esc(catMap.get(a.categoriaId) || '')}</span>` : ''}
                ${a.proveedorId ? `<span class="px-2 py-0.5 rounded-lg bg-[#F5F7F4] text-gray-700">${esc(provMap.get(a.proveedorId) || '')}</span>` : ''}
                ${pendBadge}
              </div>
              ${aVars.length ? `<div class="flex flex-wrap gap-1 mt-2.5">${varBadges}${extraVars}</div>` : ''}
            </div>
            <div class="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <span class="text-gray-500">${aVars.length} combinación(es)</span>
              <span class="font-semibold ${hasLow ? 'text-amber-700' : 'text-gray-800'}">${hasLow ? '⚠️ ' : ''}Stock total: ${totalStock}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render Tab Precios
    const pq = document.getElementById('precios-search').value.trim().toLowerCase();
    const pFiltered = activos.filter(a => !pq || (a.nombre || '').toLowerCase().includes(pq) || (a.codigo || '').toLowerCase().includes(pq) || (a.aliases || []).some(al => (al || '').toLowerCase().includes(pq)));
    document.getElementById('precios-tbody').innerHTML = pFiltered.map(a => {
      const pc = Number(a.precioCompra || 0);
      const pv = Number(a.precioVenta || 0);
      const iva = Number(a.tipoIVA || 21);
      const pvSinIva = pv / (1 + iva / 100);
      const margenEur = pvSinIva - pc;
      const margenPct = pc > 0 ? (margenEur / pc) * 100 : 0;
      return `
        <tr data-precio-row="${a.id}">
          <td class="px-3 py-2.5 font-semibold text-gray-800">${esc(a.nombre)}${a.codigo ? `<div class="text-[11px] font-mono font-normal text-gray-400">Cód: ${esc(a.codigo)}</div>` : ''}</td>
          <td class="px-3 py-2.5 text-xs text-gray-400">${esc((a.aliases || [])[0] || '—')}</td>
          <td class="px-3 py-2.5 text-xs text-gray-600">${esc(provMap.get(a.proveedorId) || '—')}</td>
          <td class="px-3 py-2.5 text-right"><input type="number" step="0.01" min="0" data-precio-compra="${a.id}" value="${pc.toFixed(2)}" class="w-24 text-right px-2 py-1 border border-gray-200 rounded-lg text-xs" /></td>
          <td class="px-3 py-2.5 text-right"><input type="number" step="0.01" min="0" data-precio-venta="${a.id}" value="${pv.toFixed(2)}" class="w-24 text-right px-2 py-1 border border-gray-200 rounded-lg text-xs" /></td>
          <td class="px-3 py-2.5 text-right font-semibold ${margenEur >= 0 ? 'text-green-700' : 'text-red-600'}" data-margen-eur="${a.id}">${fmtEur(margenEur)}</td>
          <td class="px-3 py-2.5 text-right text-xs" data-margen-pct="${a.id}">${margenPct.toFixed(1)}%</td>
          <td class="px-3 py-2.5 text-center text-xs">${iva}%</td>
        </tr>
      `;
    }).join('');

    // Render Tab Categorías
    const catCount = new Map();
    activos.forEach(a => { if (a.categoriaId) catCount.set(a.categoriaId, (catCount.get(a.categoriaId) || 0) + 1); });
    document.getElementById('categorias-list').innerHTML = cats.length ? cats.map(c => {
      const cnt = catCount.get(c.id) || 0;
      return `
        <div class="px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <span class="font-semibold text-gray-800">${esc(c.nombre)}</span>
            <span class="ml-2 text-xs text-gray-400">${cnt} artículo(s)</span>
          </div>
          <div class="flex gap-2">
            <button type="button" data-cat-edit="${c.id}" class="px-3 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">Renombrar</button>
            <button type="button" data-cat-del="${c.id}" class="px-3 py-1 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer">Eliminar</button>
          </div>
        </div>
      `;
    }).join('') : '<div class="py-8 text-center text-xs text-gray-400">No hay categorías creadas todavía.</div>';

    if (activeTab === 'movimientos') {
      await renderMovimientos();
    }
  }

  async function openArticuloModal(id = null) {
    editArtId = id;
    const [cats, provs] = await Promise.all([db.categorias.toArray(), db.proveedores.toArray(), VariantComboModule.refreshCatalog()]);

    document.getElementById('mart-var-gen-panel')?.classList.add('hidden');
    if (document.getElementById('mart-gen-tallas')) document.getElementById('mart-gen-tallas').value = '';
    if (document.getElementById('mart-gen-colores')) document.getElementById('mart-gen-colores').value = '';
    if (document.getElementById('mart-gen-stock')) document.getElementById('mart-gen-stock').value = '0';

    if (id) {
      const a = await db.articulos.get(id);
      if (!a) return;
      const vars = await db.variantes.where('articuloId').equals(id).toArray();
      document.getElementById('mart-title').textContent = 'Editar artículo';
      document.getElementById('mart-nombre').value = a.nombre || '';
      document.getElementById('mart-codigo').value = a.codigo || '';
      modalAliases = Array.isArray(a.aliases) ? [...a.aliases] : [];
      document.getElementById('mart-cat-input').value = cats.find(c => c.id === a.categoriaId)?.nombre || '';
      document.getElementById('mart-prov-input').value = provs.find(p => p.id === a.proveedorId)?.nombre || '';
      document.getElementById('mart-pcompra').value = a.precioCompra ?? '';
      document.getElementById('mart-pventa').value = a.precioVenta ?? '';
      document.getElementById('mart-iva').value = '21';
      document.getElementById('mart-umbral').value = a.umbralAlerta ?? '';
      modalVars = vars.length
        ? vars.map(v => ({ id: v.id, talla: v.talla || '', color: v.color || '', stock: Number(v.stock || 0) }))
        : [{ id: null, talla: 'Única', color: 'Estándar', stock: 0 }];
      document.getElementById('mart-delete').classList.remove('hidden');
    } else {
      document.getElementById('mart-title').textContent = 'Nuevo artículo';
      document.getElementById('mart-nombre').value = '';
      document.getElementById('mart-codigo').value = '';
      modalAliases = [];
      document.getElementById('mart-cat-input').value = '';
      document.getElementById('mart-prov-input').value = '';
      document.getElementById('mart-pcompra').value = '';
      document.getElementById('mart-pventa').value = '';
      document.getElementById('mart-iva').value = '21';
      document.getElementById('mart-umbral').value = '';
      modalVars = [{ id: null, talla: 'Única', color: 'Estándar', stock: 0 }];
      document.getElementById('mart-delete').classList.add('hidden');
    }

    renderModalAliases();
    renderModalVars();
    document.getElementById('modal-articulo').classList.remove('hidden');
  }

  function renderModalAliases() {
    document.getElementById('mart-aliases-list').innerHTML = modalAliases.map((al, i) => `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F5F7F4] border border-[#B6BEB2] text-xs font-medium">
        ${esc(al)}
        <button type="button" data-del-alias="${i}" class="text-gray-500 hover:text-red-600 font-bold cursor-pointer">×</button>
      </span>
    `).join('');
  }

  function updateVarsSummary() {
    const el = document.getElementById('mart-vars-summary');
    if (!el) return;
    const totalStock = modalVars.reduce((acc, v) => acc + Number(v.stock || 0), 0);
    el.textContent = `${modalVars.length} ${modalVars.length === 1 ? 'combinación' : 'combinaciones'} · Stock total: ${totalStock}`;
  }

  function renderModalVars() {
    document.getElementById('mart-vars-tbody').innerHTML = modalVars.map((v, i) => `
      <tr>
        <td class="px-2 py-2">
          <div class="relative flex items-center">
            <input type="text" autocomplete="off" data-combo-kind="talla" data-v-talla="${i}" value="${esc(v.talla)}" placeholder="Ej: 3m" class="w-full pl-2 pr-6 py-1 border border-gray-200 rounded-lg bg-white" />
            <button type="button" data-combo-btn="talla" tabindex="-1" class="absolute right-1 px-1 py-0.5 text-gray-400 hover:text-gray-700 cursor-pointer" title="Elegir talla">▾</button>
          </div>
        </td>
        <td class="px-2 py-2">
          <div class="relative flex items-center">
            <input type="text" autocomplete="off" data-combo-kind="color" data-v-color="${i}" value="${esc(v.color)}" placeholder="Ej: Rosa" class="w-full pl-2 pr-6 py-1 border border-gray-200 rounded-lg bg-white" />
            <button type="button" data-combo-btn="color" tabindex="-1" class="absolute right-1 px-1 py-0.5 text-gray-400 hover:text-gray-700 cursor-pointer" title="Elegir color">▾</button>
          </div>
        </td>
        <td class="px-2 py-2">
          <div class="flex items-center justify-center gap-1">
            <button type="button" data-v-dec="${i}" class="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 font-bold cursor-pointer">−</button>
            <input type="number" data-v-stock="${i}" value="${v.stock}" class="w-16 text-center px-1 py-1 border border-gray-200 rounded-lg" />
            <button type="button" data-v-inc="${i}" class="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 font-bold cursor-pointer">+</button>
          </div>
        </td>
        <td class="px-2 py-2 text-center">
          <button type="button" data-v-del="${i}" class="text-red-500 hover:text-red-700 font-bold cursor-pointer">✕</button>
        </td>
      </tr>
    `).join('');
    updateVarsSummary();
  }

  async function saveArticulo() {
    const nombre = document.getElementById('mart-nombre').value.trim();
    if (!nombre) return showToast('El nombre del artículo es obligatorio', 'warning');

    const codigo = document.getElementById('mart-codigo').value.trim();
    const catNombre = document.getElementById('mart-cat-input').value.trim();
    const provNombre = document.getElementById('mart-prov-input').value.trim();
    const pCompra = Number(document.getElementById('mart-pcompra').value || 0);
    const pVenta = Number(document.getElementById('mart-pventa').value || 0);
    const tipoIVA = Number(document.getElementById('mart-iva').value || 21);
    const umbStr = document.getElementById('mart-umbral').value.trim();
    const umbralAlerta = umbStr === '' ? null : Number(umbStr);

    if (!modalVars.length) {
      return showToast('Debe haber al menos una combinación de talla y color', 'warning');
    }

    // Normalizar antes de comprobar duplicados para evitar colisiones con valores por defecto
    const normalizedVars = modalVars.map(v => ({
      id: v.id || null,
      talla: String(v.talla || '').trim() || 'Única',
      color: String(v.color || '').trim() || 'Estándar',
      stock: Number.isFinite(Number(v.stock)) ? Number(v.stock) : 0
    }));
    const seen = new Set();
    for (const v of normalizedVars) {
      const key = `${v.talla.toLowerCase()}|${v.color.toLowerCase()}`;
      if (seen.has(key)) {
        return showToast(`Combinación duplicada: ${v.talla} / ${v.color}`, 'warning');
      }
      seen.add(key);
    }

    await db.transaction('rw', [db.categorias, db.proveedores, db.articulos, db.variantes, db.movimientos_stock], async () => {
      let categoriaId = null;
      if (catNombre) {
        const catExist = await db.categorias.where('nombre').equalsIgnoreCase(catNombre).first();
        categoriaId = catExist ? catExist.id : await db.categorias.add({ nombre: catNombre });
      }
      let proveedorId = null;
      if (provNombre) {
        const allP = await db.proveedores.toArray();
        const provExist = allP.find(p => (p.nombre || '').toLowerCase() === provNombre.toLowerCase());
        proveedorId = provExist ? provExist.id : await db.proveedores.add({ nombre: provNombre, CIF: '', telefono: '', email: '', notas: '', fechaCreacion: new Date().toISOString() });
      }

      const isCreate = !editArtId;
      let artId = editArtId;
      if (artId) {
        await db.articulos.update(artId, {
          codigo, nombre, aliases: modalAliases, categoriaId, proveedorId,
          precioCompra: pCompra, precioVenta: pVenta, tipoIVA, umbralAlerta, activo: true
        });
      } else {
        artId = await db.articulos.add({
          codigo, nombre, aliases: modalAliases, categoriaId, proveedorId,
          precioCompra: pCompra, precioVenta: pVenta, tipoIVA, umbralAlerta,
          activo: true, fechaCreacion: new Date().toISOString()
        });
      }

      // Sincronizar variantes sin colisión de índice único &[articuloId+talla+color] ni escrituras innecesarias
      const actuales = await db.variantes.where('articuloId').equals(artId).toArray();
      const prevMap = new Map(actuales.map(o => [o.id, o]));
      const keepIds = new Set(normalizedVars.filter(v => v.id).map(v => v.id));
      const nowIso = new Date().toISOString();

      for (const old of actuales) {
        if (!keepIds.has(old.id)) {
          await db.variantes.delete(old.id);
          if (Number(old.stock || 0) !== 0) {
            await registrarMovimientoStock({
              fecha: nowIso,
              articuloId: artId,
              varianteId: old.id,
              nombreArticulo: nombre,
              descripcionVariante: `${old.talla || 'Única'} / ${old.color || 'Estándar'}`,
              tipo: 'ajuste_manual',
              delta: -Number(old.stock || 0),
              stockResultante: 0,
              nota: 'Combinación eliminada en edición'
            });
          }
        }
      }

      // Detectar si algún cambio de talla/color choca con otra variante existente que también se conserva
      const remainingOldByKey = new Map();
      for (const old of actuales) {
        if (keepIds.has(old.id)) {
          remainingOldByKey.set(`${String(old.talla || '').trim().toLowerCase()}|${String(old.color || '').trim().toLowerCase()}`, old.id);
        }
      }
      const needsTempStaging = normalizedVars.filter(v => {
        if (!v.id) return false;
        const targetKey = `${v.talla.toLowerCase()}|${v.color.toLowerCase()}`;
        const ownerId = remainingOldByKey.get(targetKey);
        return ownerId && ownerId !== v.id;
      });
      if (needsTempStaging.length > 0) {
        for (const old of actuales) {
          if (keepIds.has(old.id)) {
            await db.variantes.update(old.id, { talla: `__tmp_${old.id}__`, color: '__tmp__' });
          }
        }
      }

      for (const v of normalizedVars) {
        const clean = { articuloId: artId, talla: v.talla, color: v.color, stock: v.stock };
        const varLabel = `${clean.talla} / ${clean.color}`;
        if (v.id) {
          const prev = prevMap.get(v.id);
          const prevStock = Number(prev?.stock || 0);
          const keyChanged = !prev || prev.talla !== clean.talla || prev.color !== clean.color || needsTempStaging.length > 0;
          const stockChanged = prevStock !== clean.stock;
          if (keyChanged || stockChanged) {
            await db.variantes.update(v.id, clean);
          }
          const delta = clean.stock - prevStock;
          if (delta !== 0) {
            await registrarMovimientoStock({
              fecha: nowIso,
              articuloId: artId,
              varianteId: v.id,
              nombreArticulo: nombre,
              descripcionVariante: varLabel,
              tipo: 'ajuste_manual',
              delta,
              stockResultante: clean.stock,
              nota: 'Ajuste manual en ficha de artículo'
            });
          }
        } else {
          const newVarId = await db.variantes.add(clean);
          if (clean.stock !== 0) {
            await registrarMovimientoStock({
              fecha: nowIso,
              articuloId: artId,
              varianteId: newVarId,
              nombreArticulo: nombre,
              descripcionVariante: varLabel,
              tipo: 'ajuste_manual',
              delta: clean.stock,
              stockResultante: clean.stock,
              nota: isCreate ? 'Alta inicial de artículo' : 'Nueva combinación añadida'
            });
          }
        }
      }
    });

    document.getElementById('modal-articulo').classList.add('hidden');
    showToast('Artículo guardado correctamente', 'success');
    await refresh();
    await recalcularAlertasStock(false);
  }

  function init() {
    document.querySelectorAll('.stock-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.stockTab;
        ['articulos', 'precios', 'categorias', 'movimientos'].forEach(t => {
          document.getElementById(`stock-tab-${t}`)?.classList.toggle('hidden', t !== activeTab);
        });
        document.querySelectorAll('.stock-tab-btn').forEach(b => {
          const act = b.dataset.stockTab === activeTab;
          b.className = act
            ? 'stock-tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] cursor-pointer'
            : 'stock-tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 cursor-pointer';
        });
        if (activeTab === 'movimientos') renderMovimientos();
      });
    });

    document.getElementById('stock-search').addEventListener('input', refresh);
    document.getElementById('stock-filter-cat').addEventListener('change', refresh);
    document.getElementById('stock-filter-prov').addEventListener('change', refresh);
    document.getElementById('precios-search').addEventListener('input', refresh);
    document.getElementById('mov-search')?.addEventListener('input', renderMovimientos);
    document.getElementById('mov-filter-tipo')?.addEventListener('change', renderMovimientos);
    document.getElementById('mov-desde')?.addEventListener('change', renderMovimientos);
    document.getElementById('mov-hasta')?.addEventListener('change', renderMovimientos);
    document.getElementById('stock-filter-low').addEventListener('click', (e) => {
      filterLowOnly = !filterLowOnly;
      e.target.classList.toggle('bg-amber-100', filterLowOnly);
      e.target.classList.toggle('border-amber-400', filterLowOnly);
      refresh();
    });

    document.getElementById('btn-nuevo-articulo').addEventListener('click', () => openArticuloModal(null));
    document.getElementById('stock-articulos-list').addEventListener('click', e => {
      const card = e.target.closest('[data-open-art]');
      if (card) openArticuloModal(Number(card.dataset.openArt));
    });

    // Modal artículo
    document.getElementById('mart-close').addEventListener('click', () => document.getElementById('modal-articulo').classList.add('hidden'));
    document.getElementById('mart-cancel').addEventListener('click', () => document.getElementById('modal-articulo').classList.add('hidden'));
    document.getElementById('mart-save').addEventListener('click', saveArticulo);

    document.getElementById('mart-alias-add').addEventListener('click', () => {
      const inp = document.getElementById('mart-alias-input');
      const v = inp.value.trim();
      if (v && !modalAliases.includes(v)) { modalAliases.push(v); renderModalAliases(); }
      inp.value = '';
    });
    document.getElementById('mart-alias-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('mart-alias-add').click();
      }
    });
    document.getElementById('mart-aliases-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-del-alias]');
      if (btn) { modalAliases.splice(Number(btn.dataset.delAlias), 1); renderModalAliases(); }
    });
    document.getElementById('mart-cat-quick').addEventListener('click', async () => {
      const nom = document.getElementById('mart-cat-input').value.trim();
      if (!nom) return showToast('Escribe el nombre de la categoría en el campo', 'warning');
      const ex = await db.categorias.where('nombre').equalsIgnoreCase(nom).first();
      if (!ex) { await db.categorias.add({ nombre: nom }); showToast('Categoría creada', 'success'); refresh(); }
    });

    document.getElementById('mart-var-gen-toggle')?.addEventListener('click', () => {
      document.getElementById('mart-var-gen-panel')?.classList.toggle('hidden');
    });
    document.getElementById('mart-gen-apply')?.addEventListener('click', () => {
      const rawTallas = (document.getElementById('mart-gen-tallas')?.value || '').trim();
      const rawColores = (document.getElementById('mart-gen-colores')?.value || '').trim();
      if (!rawTallas && !rawColores) {
        return showToast('Escribe al menos una talla o un color para generar combinaciones', 'warning');
      }
      const parseUnique = (raw, fallback) => {
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return [fallback];
        const seenList = new Set();
        const out = [];
        for (const p of parts) {
          const k = p.toLowerCase();
          if (!seenList.has(k)) { seenList.add(k); out.push(p); }
        }
        return out;
      };
      const tallas = parseUnique(rawTallas, 'Única');
      const colores = parseUnique(rawColores, 'Estándar');
      const initStock = Number.isFinite(Number(document.getElementById('mart-gen-stock')?.value))
        ? Number(document.getElementById('mart-gen-stock').value)
        : 0;

      // Si solo está la fila vacía por defecto (Única / Estándar con stock 0 sin guardar), reemplazarla al generar combinaciones reales
      if (
        modalVars.length === 1 &&
        !modalVars[0].id &&
        (modalVars[0].talla || '').trim().toLowerCase() === 'única' &&
        (modalVars[0].color || '').trim().toLowerCase() === 'estándar' &&
        Number(modalVars[0].stock || 0) === 0 &&
        !(tallas.length === 1 && colores.length === 1 && tallas[0].toLowerCase() === 'única' && colores[0].toLowerCase() === 'estándar')
      ) {
        modalVars = [];
      }

      const existingKeys = new Set(modalVars.map(v => `${(String(v.talla || '').trim() || 'Única').toLowerCase()}|${(String(v.color || '').trim() || 'Estándar').toLowerCase()}`));
      let added = 0;
      let skipped = 0;
      for (const t of tallas) {
        for (const c of colores) {
          const key = `${t.toLowerCase()}|${c.toLowerCase()}`;
          if (existingKeys.has(key)) {
            skipped++;
          } else {
            existingKeys.add(key);
            modalVars.push({ id: null, talla: t, color: c, stock: initStock });
            added++;
          }
        }
      }
      renderModalVars();
      if (added > 0) {
        showToast(`${added} combinación(es) añadida(s)${skipped ? ` (${skipped} ya existían)` : ''}`, 'success');
      } else {
        showToast('Todas esas combinaciones ya estaban en la lista', 'warning');
      }
    });

    document.getElementById('mart-var-add').addEventListener('click', () => {
      modalVars.push({ id: null, talla: '', color: '', stock: 0 });
      renderModalVars();
    });
    document.getElementById('mart-vars-tbody').addEventListener('input', e => {
      if (e.target.dataset.vTalla !== undefined) modalVars[Number(e.target.dataset.vTalla)].talla = e.target.value;
      if (e.target.dataset.vColor !== undefined) modalVars[Number(e.target.dataset.vColor)].color = e.target.value;
      if (e.target.dataset.vStock !== undefined) {
        modalVars[Number(e.target.dataset.vStock)].stock = Number(e.target.value || 0);
        updateVarsSummary();
      }
    });
    document.getElementById('mart-vars-tbody').addEventListener('click', e => {
      if (e.target.dataset.vInc !== undefined) { modalVars[Number(e.target.dataset.vInc)].stock++; renderModalVars(); }
      if (e.target.dataset.vDec !== undefined) { modalVars[Number(e.target.dataset.vDec)].stock--; renderModalVars(); }
      if (e.target.dataset.vDel !== undefined) {
        if (modalVars.length <= 1) {
          return showToast('Debe quedar al menos una combinación en el artículo', 'warning');
        }
        modalVars.splice(Number(e.target.dataset.vDel), 1);
        renderModalVars();
      }
    });

    document.getElementById('mart-delete').addEventListener('click', () => {
      const modal = document.getElementById('modal-pedido-confirm');
      document.getElementById('modal-pconf-title').textContent = 'Eliminar artículo';
      document.getElementById('modal-pconf-desc').textContent = 'Se eliminará este artículo y sus variantes del catálogo.';
      document.getElementById('modal-pconf-label').textContent = 'Escribe ELIMINAR para confirmar:';
      const inp = document.getElementById('modal-pconf-input'); inp.value = '';
      modal.classList.remove('hidden');
      document.getElementById('modal-pconf-ok').onclick = async () => {
        if (inp.value.trim().toUpperCase() !== 'ELIMINAR') return showToast('Escribe ELIMINAR exactamente', 'warning');
        modal.classList.add('hidden');
        await db.transaction('rw', [db.articulos, db.variantes, db.movimientos_stock], async () => {
          const art = await db.articulos.get(editArtId);
          const vars = await db.variantes.where('articuloId').equals(editArtId).toArray();
          const nowIso = new Date().toISOString();
          for (const v of vars) {
            if (Number(v.stock || 0) !== 0) {
              await registrarMovimientoStock({
                fecha: nowIso,
                articuloId: editArtId,
                varianteId: v.id,
                nombreArticulo: art?.nombre || 'Artículo eliminado',
                descripcionVariante: `${v.talla || 'Única'} / ${v.color || 'Estándar'}`,
                tipo: 'baja_articulo',
                delta: -Number(v.stock || 0),
                stockResultante: 0,
                nota: 'Artículo eliminado del catálogo'
              });
            }
          }
          await db.variantes.where('articuloId').equals(editArtId).delete();
          await db.articulos.delete(editArtId);
        });
        document.getElementById('modal-articulo').classList.add('hidden');
        showToast('Artículo eliminado', 'success');
        await refresh();
        await recalcularAlertasStock(false);
      };
    });

    // Edición inline en Precios
    document.getElementById('precios-tbody').addEventListener('change', async e => {
      const id = Number(e.target.dataset.precioCompra || e.target.dataset.precioVenta);
      if (!id) return;
      const pc = Number(document.querySelector(`[data-precio-compra="${id}"]`).value || 0);
      const pv = Number(document.querySelector(`[data-precio-venta="${id}"]`).value || 0);
      await db.articulos.update(id, { precioCompra: pc, precioVenta: pv });
      showToast('Precio actualizado', 'success');
      refresh();
    });

    // Categorías CRUD
    document.getElementById('cat-btn-add').addEventListener('click', async () => {
      const inp = document.getElementById('cat-new-name');
      const nombre = inp.value.trim();
      if (!nombre) return;
      const ex = await db.categorias.where('nombre').equalsIgnoreCase(nombre).first();
      if (ex) return showToast('Esa categoría ya existe', 'warning');
      await db.categorias.add({ nombre });
      inp.value = '';
      showToast('Categoría creada', 'success');
      refresh();
    });
    document.getElementById('categorias-list').addEventListener('click', async e => {
      const delBtn = e.target.closest('[data-cat-del]');
      if (delBtn) {
        const id = Number(delBtn.dataset.catDel);
        const arts = await db.articulos.where('categoriaId').equals(id).toArray();
        if (arts.some(a => a.activo !== false)) return showToast('No se puede eliminar: tiene artículos asignados', 'error');
        await db.categorias.delete(id);
        showToast('Categoría eliminada', 'success');
        refresh();
      }
      const editBtn = e.target.closest('[data-cat-edit]');
      if (editBtn) {
        const id = Number(editBtn.dataset.catEdit);
        const cat = await db.categorias.get(id);
        const modal = document.getElementById('modal-pedido-confirm');
        document.getElementById('modal-pconf-title').textContent = 'Renombrar categoría';
        document.getElementById('modal-pconf-desc').textContent = `Nombre actual: ${cat.nombre}`;
        document.getElementById('modal-pconf-label').textContent = 'Nuevo nombre:';
        const inp = document.getElementById('modal-pconf-input'); inp.value = cat.nombre;
        modal.classList.remove('hidden');
        document.getElementById('modal-pconf-ok').onclick = async () => {
          const nuevo = inp.value.trim();
          if (!nuevo) return showToast('Introduce un nombre', 'warning');
          modal.classList.add('hidden');
          await db.categorias.update(id, { nombre: nuevo });
          showToast('Categoría actualizada', 'success');
          refresh();
        };
      }
    });
  }

  return { init, refresh, openArticuloModal, getFilteredMovimientos };
})();

// ==================== HELPERS DE FACTURAS DE COMPRA Y RECEPCIÓN DE STOCK ====================
const FAC_COMP_PVP_RULE_KEY = 'babyluc_pvp_rule';
const FAC_COMP_EST_META = {
  pendiente_recibir: { label: '📦 Pendiente recibir', short: 'Pendiente', cls: 'bg-amber-100 text-amber-800 border border-amber-200' },
  recibido:          { label: '✅ Recibido',          short: 'Recibido',  cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200' }
};
const getFacturaCompraEstado = (f) => (f?.estado === 'pendiente_recibir' ? 'pendiente_recibir' : 'recibido');

const fcNormKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const fcParseAliasList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

function fcGetPvpRule() {
  try {
    const raw = localStorage.getItem(FAC_COMP_PVP_RULE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        mult: Math.max(1, Number(p.mult || 2)),
        round: ['90', '95', 'int', 'none'].includes(p.round) ? p.round : '90'
      };
    }
  } catch { /* ignore */ }
  return { mult: 2, round: '90' };
}

function fcSavePvpRule(rule) {
  try { localStorage.setItem(FAC_COMP_PVP_RULE_KEY, JSON.stringify(rule)); } catch { /* ignore */ }
}

function fcCalcSuggestedPvp(cost, mult, roundMode) {
  const c = Number(cost || 0);
  const m = Number(mult || 2);
  if (c <= 0 || m <= 0) return 0;
  const raw = c * m;
  if (roundMode === '90') return Math.max(0.90, round2(Math.round(raw + 0.10) - 0.10));
  if (roundMode === '95') return Math.max(0.95, round2(Math.round(raw + 0.05) - 0.05));
  if (roundMode === 'int') return Math.max(1, Math.round(raw));
  return round2(raw);
}

function fcEnsureLineVariants(a) {
  if (!Array.isArray(a.variantes) || a.variantes.length === 0) {
    a.variantes = [{
      talla: String(a.talla || 'Única').trim() || 'Única',
      color: String(a.color || 'Estándar').trim() || 'Estándar',
      cantidad: Number(a.cantidad ?? 1)
    }];
  }
  a.cantidad = a.variantes.reduce((s, v) => s + Number(v.cantidad || 0), 0);
  a.talla = a.variantes[0].talla || 'Única';
  a.color = a.variantes[0].color || 'Estándar';
  return a.variantes;
}

function fcGetScannedFullName(a) {
  const desc = String(a?.descripcion || '').trim();
  const ref = String(a?.referencia || '').trim();
  if (desc && ref) {
    if (fcNormKey(desc).includes(fcNormKey(ref))) return desc;
    if (fcNormKey(ref).includes(fcNormKey(desc))) return ref;
    return `${desc} ${ref}`.trim();
  }
  return desc || ref || '';
}

function fcFindMatchingArticulo(arts, ...inputs) {
  const candidates = inputs
    .flatMap(v => (typeof v === 'string' && v.includes(',')) ? [v, ...fcParseAliasList(v)] : [v])
    .map(fcNormKey)
    .filter(Boolean);
  if (!candidates.length) return null;
  const ordered = [...arts].sort((a, b) => (b.activo !== false ? 1 : 0) - (a.activo !== false ? 1 : 0));
  const matchKey = (key) => ordered.find(x => fcNormKey(x.codigo) === key)
    || ordered.find(x => fcNormKey(x.nombre) === key)
    || ordered.find(x => Array.isArray(x.aliases) && x.aliases.some(al => fcNormKey(al) === key))
    || null;
  for (const key of candidates) {
    const m = matchKey(key);
    if (m) return m;
  }
  return null;
}

function fcResolveMatchForLine(arts, a) {
  if (a._skipStock || a.afectaStock === false) return null;
  const linkMode = a._linkMode ?? a.linkMode;
  const linkedId = a._linkedId ?? a.linkedId;
  if (linkMode === 'new') return null;
  if (linkMode === 'linked' && linkedId) {
    return arts.find(x => Number(x.id) === Number(linkedId)) || null;
  }
  return fcFindMatchingArticulo(
    arts,
    a.descripcion,
    a._scannedFull ?? a.scannedFull,
    a.referencia,
    a._aliasInput ?? a.aliasInput
  );
}

async function aplicarStockFacturaCompra({ articulos = [], provId = null, provNom = 'Proveedor', numFac = '', movNowIso = new Date().toISOString() }) {
  const rule = fcGetPvpRule();
  const allArts = await db.articulos.toArray();
  const allCats = await db.categorias.toArray();
  const catByKey = new Map(allCats.map(c => [fcNormKey(c.nombre), c.id]));
  let lineasAplicadas = 0;
  let unidadesSumadas = 0;
  let articulosCreados = 0;

  for (const a of (Array.isArray(articulos) ? articulos : [])) {
    if (a._skipStock || a.afectaStock === false) continue;
    lineasAplicadas++;
    const fullFallback = String(a._scannedFull ?? a.scannedFull ?? fcGetScannedFullName(a) ?? '').trim();
    const extraAliases = fcParseAliasList(a._aliasInput ?? a.aliasInput ?? '');
    const art = fcResolveMatchForLine(allArts, a);
    const nom = (String(a.descripcion || '').trim() || art?.nombre || fullFallback || String(a.referencia || '').trim() || 'Artículo sin nombre');
    const ref = String(a.referencia || '').trim();

    let resolvedCatId = null;
    const catTrim = String(a._catName ?? a.catName ?? '').trim();
    const catEdited = Boolean(a._catEdited ?? a.catEdited);
    if (catTrim) {
      const ck = fcNormKey(catTrim);
      if (catByKey.has(ck)) {
        resolvedCatId = catByKey.get(ck);
      } else {
        resolvedCatId = await db.categorias.add({ nombre: catTrim });
        catByKey.set(ck, resolvedCatId);
      }
    }

    const rawNuevoPvp = a._nuevoPVenta !== undefined ? a._nuevoPVenta : a.nuevoPVenta;
    const rawUpdateCompra = a._updateCompra !== undefined ? a._updateCompra : a.updateCompra;

    let artId;
    if (art) {
      artId = art.id;
      const existingAliases = Array.isArray(art.aliases) ? [...art.aliases] : [];
      const knownKeys = new Set([fcNormKey(art.nombre), ...existingAliases.map(fcNormKey)]);
      let aliasesChanged = false;
      for (const cand of [ref, fullFallback, nom, ...extraAliases]) {
        const ck = fcNormKey(cand);
        if (cand && cand !== 'Artículo sin nombre' && ck && !knownKeys.has(ck)) {
          existingAliases.push(cand);
          knownKeys.add(ck);
          aliasesChanged = true;
        }
      }
      const updates = {};
      if (ref && !art.codigo) { updates.codigo = ref; art.codigo = ref; }
      if (aliasesChanged) { updates.aliases = existingAliases; art.aliases = existingAliases; }
      if (art.activo === false) { updates.activo = true; art.activo = true; }
      const puCompra = Number(a.precioUnitario || 0);
      const shouldUpdCompra = (rawUpdateCompra !== undefined && rawUpdateCompra !== null)
        ? Boolean(rawUpdateCompra)
        : (!art.precioCompra || Number(art.precioCompra) === 0);
      if (puCompra > 0 && shouldUpdCompra) {
        updates.precioCompra = puCompra;
        art.precioCompra = puCompra;
      }
      if (rawNuevoPvp !== undefined && rawNuevoPvp !== null && rawNuevoPvp !== '' && Number(rawNuevoPvp) > 0) {
        updates.precioVenta = round2(Number(rawNuevoPvp));
        art.precioVenta = updates.precioVenta;
      }
      if (!art.proveedorId && provId) {
        updates.proveedorId = provId;
        art.proveedorId = provId;
      }
      if (resolvedCatId && (!art.categoriaId || catEdited)) {
        updates.categoriaId = resolvedCatId;
        art.categoriaId = resolvedCatId;
      }
      if (Object.keys(updates).length > 0) await db.articulos.update(artId, updates);
    } else {
      const aliasesInit = [];
      const knownKeys = new Set();
      const aliasCands = extraAliases.length > 0
        ? [ref, ...(fcNormKey(fullFallback) !== fcNormKey(nom) ? [fullFallback] : []), ...extraAliases]
        : [ref, fullFallback || nom];
      for (const cand of aliasCands) {
        const ck = fcNormKey(cand);
        if (cand && cand !== 'Artículo sin nombre' && ck && !knownKeys.has(ck)) {
          aliasesInit.push(cand);
          knownKeys.add(ck);
        }
      }
      const puCompra = Number(a.precioUnitario || 0);
      const hasExplicitPvp = rawNuevoPvp !== undefined && rawNuevoPvp !== null && rawNuevoPvp !== '' && Number(rawNuevoPvp) > 0;
      const finalPvp = hasExplicitPvp
        ? round2(Number(rawNuevoPvp))
        : (fcCalcSuggestedPvp(puCompra, rule.mult, rule.round) || round2(puCompra * 2));
      const newArtObj = {
        codigo: ref || '', nombre: nom, aliases: aliasesInit, categoriaId: resolvedCatId, proveedorId: provId,
        precioCompra: puCompra, precioVenta: finalPvp,
        tipoIVA: 21, umbralAlerta: null, activo: true, fechaCreacion: movNowIso
      };
      artId = await db.articulos.add(newArtObj);
      allArts.push({ ...newArtObj, id: artId });
      articulosCreados++;
    }

    const vars = fcEnsureLineVariants({ ...a, variantes: Array.isArray(a.variantes) ? a.variantes.map(v => ({ ...v })) : undefined });
    for (const v of vars) {
      const talla = String(v.talla || 'Única').trim() || 'Única';
      const color = String(v.color || 'Estándar').trim() || 'Estándar';
      const qty = Number(v.cantidad || 0);
      const artVars = await db.variantes.where('articuloId').equals(artId).toArray();
      const vEx = artVars.find(x => fcNormKey(x.talla) === fcNormKey(talla) && fcNormKey(x.color) === fcNormKey(color));
      let varId;
      let stockResultante = qty;
      if (vEx) {
        varId = vEx.id;
        stockResultante = Number(vEx.stock || 0) + qty;
        await db.variantes.update(varId, { stock: stockResultante });
      } else {
        varId = await db.variantes.add({ articuloId: artId, talla, color, stock: qty });
      }
      unidadesSumadas += qty;
      if (qty !== 0) {
        await registrarMovimientoStock({
          fecha: movNowIso,
          articuloId: artId,
          varianteId: varId,
          nombreArticulo: nom,
          descripcionVariante: `${talla} / ${color}`,
          tipo: 'compra',
          delta: qty,
          stockResultante,
          referencia: numFac,
          nota: provNom
        });
      }
    }
  }

  return { lineasAplicadas, unidadesSumadas, articulosCreados };
}

async function revertirStockFacturaCompra({ articulos = [], provNom = 'Proveedor', numFac = '', movNowIso = new Date().toISOString() }) {
  const allArts = await db.articulos.toArray();
  let unidadesRevertidas = 0;

  for (const a of (Array.isArray(articulos) ? articulos : [])) {
    if (a._skipStock || a.afectaStock === false) continue;
    const art = fcResolveMatchForLine(allArts, a);
    if (!art) continue;
    const artVars = await db.variantes.where('articuloId').equals(art.id).toArray();
    const vars = fcEnsureLineVariants({ ...a, variantes: Array.isArray(a.variantes) ? a.variantes.map(v => ({ ...v })) : undefined });
    for (const v of vars) {
      const talla = String(v.talla || 'Única').trim() || 'Única';
      const color = String(v.color || 'Estándar').trim() || 'Estándar';
      const qty = Number(v.cantidad || 0);
      if (qty <= 0) continue;
      const vEx = artVars.find(x => fcNormKey(x.talla) === fcNormKey(talla) && fcNormKey(x.color) === fcNormKey(color));
      if (!vEx) continue;
      const prevStock = Number(vEx.stock || 0);
      const nextStock = Math.max(0, prevStock - qty);
      const deltaReal = nextStock - prevStock;
      await db.variantes.update(vEx.id, { stock: nextStock });
      vEx.stock = nextStock;
      if (deltaReal !== 0) {
        unidadesRevertidas += Math.abs(deltaReal);
        await registrarMovimientoStock({
          fecha: movNowIso,
          articuloId: art.id,
          varianteId: vEx.id,
          nombreArticulo: art.nombre || a.descripcion || 'Artículo',
          descripcionVariante: `${talla} / ${color}`,
          tipo: 'ajuste_manual',
          delta: deltaReal,
          stockResultante: nextStock,
          referencia: numFac,
          nota: `Reversión a pendiente de recibir · ${provNom || 'Proveedor'}`
        });
      }
    }
  }
  return { unidadesRevertidas };
}

// ==================== ESCÁNER DE FACTURAS CON GEMINI ====================
const InvoiceScannerModule = (() => {
  let step = 1;
  let imageBase64 = '';
  let mimeType = 'image/jpeg';
  let pagesImages = [];
  let extracted = null;
  let cachedArts = [];
  let cachedCats = [];

  const normKey = fcNormKey;
  const parseAliasList = fcParseAliasList;
  const getPvpRule = fcGetPvpRule;
  const savePvpRule = fcSavePvpRule;
  const calcSuggestedPvp = fcCalcSuggestedPvp;
  const ensureLineVariants = fcEnsureLineVariants;
  const getScannedFullName = fcGetScannedFullName;
  const resolveMatchForLine = fcResolveMatchForLine;

  function getCategoryNameById(catId) {
    if (!catId) return '';
    const c = cachedCats.find(x => Number(x.id) === Number(catId));
    return c ? c.nombre : '';
  }

  function syncLineDefaultsWithMatch(a, match, idx, allowDomSync = true) {
    const scannedFull = String(a._scannedFull || '').trim();
    if (match) {
      if (!a._customNameEdited) {
        a.descripcion = match.nombre || scannedFull;
      }
      if (!a._customAliasEdited) {
        const known = new Set([normKey(match.nombre), ...(Array.isArray(match.aliases) ? match.aliases : []).map(normKey)]);
        if (scannedFull && !known.has(normKey(scannedFull))) {
          a._aliasInput = scannedFull;
        } else if (a.referencia && !known.has(normKey(a.referencia))) {
          a._aliasInput = String(a.referencia).trim();
        } else {
          a._aliasInput = '';
        }
      }
      if (!a._catEdited) {
        a._catName = getCategoryNameById(match.categoriaId);
      }
    } else {
      if (!a._customNameEdited) {
        a.descripcion = scannedFull;
      }
      if (!a._customAliasEdited) {
        a._aliasInput = (a.referencia && normKey(a.referencia) !== normKey(scannedFull)) ? String(a.referencia).trim() : '';
      }
      if (!a._catEdited && a._catName === undefined) {
        a._catName = '';
      }
      if (!a._pvpEdited && Number(a.precioUnitario || 0) > 0) {
        const rule = getPvpRule();
        const sugg = calcSuggestedPvp(a.precioUnitario, rule.mult, rule.round);
        a._nuevoPVenta = sugg > 0 ? sugg.toFixed(2) : '';
      }
    }

    if (allowDomSync && idx !== undefined) {
      const descEl = document.querySelector(`[data-sc-f="descripcion"][data-sc-i="${idx}"]`);
      if (descEl) {
        descEl.placeholder = match ? match.nombre : (scannedFull || 'Nombre / código completo del artículo');
        if (document.activeElement !== descEl && !a._customNameEdited) {
          descEl.value = a.descripcion || '';
        }
      }
      const aliasEl = document.querySelector(`[data-sc-alias="${idx}"]`);
      if (aliasEl) {
        aliasEl.placeholder = match
          ? (Array.isArray(match.aliases) && match.aliases.length ? `Alias actuales: ${match.aliases.join(', ')}` : 'Añadir alias...')
          : (scannedFull ? `Alias (defecto: ${scannedFull})` : 'Alias (defecto: nombre completo)');
        if (document.activeElement !== aliasEl && !a._customAliasEdited) {
          aliasEl.value = a._aliasInput || '';
        }
      }
      const catEl = document.querySelector(`[data-sc-cat="${idx}"]`);
      if (catEl && document.activeElement !== catEl && !a._catEdited) {
        catEl.value = a._catName || '';
      }
    }
  }

  async function checkDuplicateInvoice() {
    const warnEl = document.getElementById('sc-dup-warning');
    if (!warnEl) return;
    const numFac = document.getElementById('sc-num-factura')?.value.trim() || '';
    const provNom = document.getElementById('sc-prov-nombre')?.value.trim() || '';
    const provCif = document.getElementById('sc-prov-cif')?.value.trim() || '';
    if (!numFac) {
      warnEl.classList.add('hidden');
      warnEl.textContent = '';
      return;
    }
    const [allFacs, allProvs] = await Promise.all([db.facturas_compra.toArray(), db.proveedores.toArray()]);
    const provMap = new Map(allProvs.map(p => [Number(p.id), p]));
    const targetNum = normKey(numFac);
    const targetNom = normKey(provNom);
    const targetCif = normKey(provCif);
    const dup = allFacs.find(f => {
      if (normKey(f.numeroFactura) !== targetNum) return false;
      const p = f.proveedorId ? provMap.get(Number(f.proveedorId)) : null;
      const fNom = normKey(f.nombreProveedor || p?.nombre || '');
      const fCif = normKey(p?.CIF || '');
      if (targetCif && fCif && targetCif === fCif) return true;
      if (targetNom && fNom && targetNom === fNom) return true;
      return !targetNom && !targetCif;
    });
    if (dup) {
      warnEl.textContent = `⚠ Atención: Ya existe una factura registrada con el número "${dup.numeroFactura}" para ${dup.nombreProveedor || provNom || 'este proveedor'} (${fmtFecha(dup.fecha)} · ${fmtEur(dup.total)}). Verifica que no esté duplicada.`;
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
      warnEl.textContent = '';
    }
  }

  function renderPagesPreview(totalPdfPages = null) {
    const infoEl = document.getElementById('scan-preview-info');
    const pagesEl = document.getElementById('scan-preview-pages');
    const imgEl = document.getElementById('scan-preview-img');
    if (!pagesImages.length) {
      document.getElementById('scan-preview-box').classList.add('hidden');
      return;
    }
    imgEl.src = pagesImages[0].dataUrl;
    document.getElementById('scan-preview-box').classList.remove('hidden');
    if (infoEl) {
      if (totalPdfPages && totalPdfPages > pagesImages.length) {
        infoEl.textContent = `PDF de ${totalPdfPages} páginas (se analizarán las ${pagesImages.length} primeras)`;
        infoEl.classList.remove('hidden');
      } else if (pagesImages.length > 1) {
        infoEl.textContent = `PDF de ${pagesImages.length} páginas listas para analizar`;
        infoEl.classList.remove('hidden');
      } else {
        infoEl.classList.add('hidden');
      }
    }
    if (pagesEl) {
      if (pagesImages.length > 1) {
        pagesEl.innerHTML = pagesImages.map((p, idx) => `
          <button type="button" data-scan-page-idx="${idx}" class="p-1 rounded-lg border-2 ${idx === 0 ? 'border-[#727D6E] bg-[#F5F7F4]' : 'border-gray-200 bg-white'} cursor-pointer">
            <img src="${p.dataUrl}" alt="Página ${idx + 1}" class="h-14 w-11 object-cover rounded" />
            <span class="block text-[10px] font-semibold text-gray-600 mt-0.5">Pág. ${idx + 1}</span>
          </button>
        `).join('');
        pagesEl.classList.remove('hidden');
      } else {
        pagesEl.innerHTML = '';
        pagesEl.classList.add('hidden');
      }
    }
  }

  function syncScanEstadoUi() {
    const estadoSel = document.getElementById('sc-estado')?.value || 'pendiente_recibir';
    const isPend = estadoSel === 'pendiente_recibir';
    const bar = document.getElementById('sc-estado-bar');
    const hint = document.getElementById('sc-estado-hint');
    const selEl = document.getElementById('sc-estado');
    if (bar) {
      bar.className = isPend
        ? 'flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-amber-50/70 border border-amber-200 px-3.5 py-2.5 rounded-xl text-xs'
        : 'flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-emerald-50/70 border border-emerald-200 px-3.5 py-2.5 rounded-xl text-xs';
    }
    if (selEl) {
      selEl.className = isPend
        ? 'px-2.5 py-1.5 border border-amber-300 rounded-lg bg-white font-semibold text-gray-900'
        : 'px-2.5 py-1.5 border border-emerald-300 rounded-lg bg-white font-semibold text-gray-900';
    }
    if (hint) {
      hint.className = isPend ? 'text-[11px] text-amber-900' : 'text-[11px] text-emerald-900';
      hint.textContent = isPend
        ? 'El stock se sumará cuando marques la factura como recibida en Proveedores.'
        : 'Los artículos marcados con ✓ Stock se sumarán al inventario ahora mismo.';
    }
    if (step === 3) {
      const nextBtn = document.getElementById('scan-btn-next');
      if (nextBtn) nextBtn.textContent = isPend ? 'Guardar pendiente de recibir' : 'Confirmar y sumar stock';
    }
  }

  function setStep(s) {
    step = s;
    const subs = ['', 'Paso 1 de 4 · Subir documento', 'Paso 2 de 4 · Extracción con Gemini', 'Paso 3 de 4 · Revisión y confirmación'];
    document.getElementById('scan-step-subtitle').textContent = subs[s] || '';
    [1, 2, 3].forEach(n => document.getElementById(`scan-step-${n}`).classList.toggle('hidden', n !== s));
    document.getElementById('scan-btn-back').classList.toggle('hidden', s !== 3);
    const noStockBtn = document.getElementById('scan-btn-save-no-stock');
    if (noStockBtn) noStockBtn.classList.toggle('hidden', s !== 3);
    const nextBtn = document.getElementById('scan-btn-next');
    nextBtn.classList.toggle('hidden', s === 2);
    if (s === 1) { nextBtn.textContent = 'Continuar'; nextBtn.disabled = pagesImages.length === 0; }
    if (s === 3) { nextBtn.disabled = false; syncScanEstadoUi(); }
  }

  async function extractWithGemini() {
    document.getElementById('scan-spinner').classList.remove('hidden');
    document.getElementById('scan-error-box').classList.add('hidden');

    try {
      const pagesPayload = pagesImages.map(p => ({
        imageBase64: p.dataUrl.includes(',') ? p.dataUrl.split(',')[1] : p.dataUrl,
        mimeType: p.mimeType || 'image/jpeg'
      }));
      const resp = await fetch('/api/gemini/scan-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: pagesPayload })
      });
      if (resp.status === 404 || resp.status === 405) {
        throw new Error('El escaneo automático con IA requiere el servidor activo (Node/AI Studio). En un despliegue estático como GitHub Pages puedes registrar la factura manualmente en Proveedores.');
      }
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
      extracted = json;
      await populateStep3();
      setStep(3);
    } catch (err) {
      document.getElementById('scan-spinner').classList.add('hidden');
      document.getElementById('scan-error-text').textContent = 'No se pudo extraer la factura: ' + (err?.message || err);
      document.getElementById('scan-error-box').classList.remove('hidden');
    }
  }

  async function populateStep3() {
    document.getElementById('sc-prov-nombre').value = extracted?.proveedor?.nombre || '';
    document.getElementById('sc-prov-cif').value = extracted?.proveedor?.cif || '';
    document.getElementById('sc-num-factura').value = extracted?.numeroFactura || '';
    document.getElementById('sc-fecha').value = extracted?.fecha || new Date().toISOString().slice(0, 10);
    const scEstadoEl = document.getElementById('sc-estado');
    if (scEstadoEl) scEstadoEl.value = 'pendiente_recibir';
    syncScanEstadoUi();
    if (!Array.isArray(extracted.articulos)) extracted.articulos = [];

    const rule = getPvpRule();
    const multEl = document.getElementById('sc-pvp-mult');
    const roundEl = document.getElementById('sc-pvp-round');
    if (multEl) multEl.value = String(rule.mult);
    if (roundEl) roundEl.value = rule.round;

    [cachedArts, cachedCats] = await Promise.all([db.articulos.toArray(), db.categorias.toArray(), VariantComboModule.refreshCatalog()]);
    extracted.articulos.forEach(a => {
      ensureLineVariants(a);
      if (a._scannedFull === undefined) {
        a._scannedFull = getScannedFullName(a);
      }
      if (a._linkMode === undefined) a._linkMode = 'auto';
      if (a._linkedId === undefined) a._linkedId = null;
      if (a._skipStock === undefined) a._skipStock = false;
      if (a._customNameEdited === undefined) a._customNameEdited = false;
      if (a._customAliasEdited === undefined) a._customAliasEdited = false;
      if (a._catEdited === undefined) a._catEdited = false;
      if (a._pvpEdited === undefined) a._pvpEdited = false;
      const match = resolveMatchForLine(cachedArts, a);
      syncLineDefaultsWithMatch(a, match, undefined, false);
    });

    const dl = document.getElementById('dl-scan-articulos');
    const dlAl = document.getElementById('dl-scan-aliases');
    const dlCat = document.getElementById('dl-scan-categorias');
    const opts = new Set();
    const aliasOpts = new Set();
    cachedArts.filter(a => a.activo !== false).forEach(a => {
      if (a.nombre) opts.add(a.nombre);
      if (Array.isArray(a.aliases)) a.aliases.forEach(al => { if (al) { opts.add(al); aliasOpts.add(al); } });
    });
    if (dl) dl.innerHTML = Array.from(opts).map(v => `<option value="${esc(v)}"></option>`).join('');
    if (dlAl) dlAl.innerHTML = Array.from(aliasOpts).map(v => `<option value="${esc(v)}"></option>`).join('');
    if (dlCat) {
      const catNames = [...cachedCats].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
      dlCat.innerHTML = catNames.map(c => `<option value="${esc(c.nombre)}"></option>`).join('');
    }
    renderScanLines();
    await checkDuplicateInvoice();
  }

  function buildLinkSelectHtml(a, idx) {
    const activeArts = cachedArts
      .filter(p => p.activo !== false)
      .sort((x, y) => String(x.nombre || '').localeCompare(String(y.nombre || ''), 'es'));
    const optsHtml = activeArts.map(p => {
      const als = Array.isArray(p.aliases) && p.aliases.length ? ` · Alias: ${p.aliases.join(', ')}` : '';
      const sel = a._linkMode === 'linked' && Number(a._linkedId) === Number(p.id) ? 'selected' : '';
      return `<option value="${p.id}" ${sel}>${esc(p.nombre)}${esc(als)}</option>`;
    }).join('');
    return `
      <select data-sc-link="${idx}" class="flex-1 min-w-0 px-1.5 py-1 border border-gray-200 rounded bg-white text-[11px] text-gray-700" title="Asociar manualmente con un artículo del catálogo">
        <option value="" ${a._linkMode === 'auto' ? 'selected' : ''}>Auto (nombre/alias)</option>
        <option value="__new__" ${a._linkMode === 'new' ? 'selected' : ''}>✨ Crear artículo nuevo</option>
        ${optsHtml}
      </select>`;
  }

  function buildMatchInfoHtml(a, idx, match) {
    if (a._skipStock) {
      return `<div data-sc-badge="${idx}" class="text-[11px] mt-1 text-slate-600 font-medium">📄 Solo factura (no modificará stock ni catálogo)</div>`;
    }
    const pu = Number(a.precioUnitario || 0);
    if (!match) {
      const alPreview = parseAliasList(a._aliasInput);
      const effectiveAl = alPreview.length ? alPreview.join(', ') : (a._scannedFull || String(a.descripcion || '').trim());
      const alTag = effectiveAl ? ` · Alias: ${esc(effectiveAl)}` : '';
      const rule = getPvpRule();
      const suggPvp = calcSuggestedPvp(pu, rule.mult, rule.round);
      const pvpInputHtml = `
        <label class="inline-flex items-center gap-1 text-gray-600">
          <span>PVP:</span>
          <input type="number" step="0.01" min="0" data-sc-pventa="${idx}" value="${esc(a._nuevoPVenta !== undefined ? a._nuevoPVenta : (suggPvp > 0 ? suggPvp.toFixed(2) : ''))}" placeholder="${suggPvp > 0 ? suggPvp.toFixed(2) + ' €' : '0.00 €'}" class="w-20 px-1.5 py-0.5 border border-gray-200 rounded bg-white text-right text-[11px]" />
        </label>`;
      return `<div data-sc-badge="${idx}" class="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-gray-500"><span>✨ Artículo nuevo${alTag}</span><span class="text-gray-300">·</span>${pvpInputHtml}</div>`;
    }
    const prevCompra = Number(match.precioCompra || 0);
    const pvActual = Number(match.precioVenta || 0);
    const pvSinIva = pvActual / 1.21;
    const margenPct = pu > 0 ? ((pvSinIva - pu) / pu) * 100 : 0;
    const changed = prevCompra > 0 && pu > 0 && Math.abs(pu - prevCompra) >= 0.01;
    if (a._updateCompra === undefined) a._updateCompra = changed || prevCompra === 0;
    let deltaHtml = '';
    if (changed) {
      deltaHtml = pu > prevCompra
        ? `<div class="text-[11px] text-amber-700 font-semibold mt-0.5">⚠ Coste sube: ${fmtEur(prevCompra)} → ${fmtEur(pu)} (margen actual s/IVA: ${margenPct.toFixed(1)}%)</div>`
        : `<div class="text-[11px] text-blue-700 font-semibold mt-0.5">📉 Coste baja: ${fmtEur(prevCompra)} → ${fmtEur(pu)} (margen s/IVA: ${margenPct.toFixed(1)}%)</div>`;
    }
    const existingAl = Array.isArray(match.aliases) && match.aliases.length
      ? `<span class="text-gray-500 font-normal"> (alias: ${esc(match.aliases.join(', '))})</span>`
      : '';
    const controlsHtml = `
      <div class="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-gray-600">
        ${pu > 0 ? `<label class="inline-flex items-center gap-1 cursor-pointer">
          <input type="checkbox" data-sc-upd-pc="${idx}" ${a._updateCompra ? 'checked' : ''} class="accent-[#B6BEB2]" />
          Actualizar P.Compra
        </label>
        <span class="text-gray-400">·</span>` : ''}
        <label class="inline-flex items-center gap-1">
          <span>PVP:</span>
          <input type="number" step="0.01" min="0" data-sc-pventa="${idx}" value="${esc(a._nuevoPVenta !== undefined ? a._nuevoPVenta : '')}" placeholder="${pvActual.toFixed(2)} €" class="w-20 px-1.5 py-0.5 border border-gray-200 rounded bg-white text-right text-[11px]" />
        </label>
      </div>`;
    const scannedLineNote = a._scannedFull && normKey(a._scannedFull) !== normKey(match.nombre)
      ? `<div class="text-[11px] text-gray-500 mt-0.5">📄 En factura: ${esc(a._scannedFull)}</div>`
      : '';
    return `<div data-sc-badge="${idx}" class="mt-1"><div class="text-[11px] text-emerald-700 font-medium">🔗 Sincroniza con: ${esc(match.nombre)}${existingAl}</div>${scannedLineNote}${deltaHtml}${controlsHtml}</div>`;
  }

  function updateScanTotalsAndBadge(idx) {
    let base = 0, ivaSum = 0, reSum = 0;
    extracted.articulos.forEach(a => {
      const sub = Number(a.cantidad || 0) * Number(a.precioUnitario || 0);
      base += sub;
      ivaSum += sub * (Number(a.tipoIVA || 21) / 100);
      reSum += sub * (Number(a.recargoeEquivalencia ?? 5.2) / 100);
    });
    document.getElementById('sc-totales').textContent = `Base: ${fmtEur(base)} · IVA: ${fmtEur(ivaSum)} · RE: ${fmtEur(reSum)} · Total: ${fmtEur(base + ivaSum + reSum)}`;
    if (idx !== undefined && extracted.articulos[idx]) {
      const a = extracted.articulos[idx];
      const match = resolveMatchForLine(cachedArts, a);
      syncLineDefaultsWithMatch(a, match, idx, true);
      const badge = document.querySelector(`[data-sc-badge="${idx}"]`);
      if (badge) {
        badge.outerHTML = buildMatchInfoHtml(a, idx, match);
      }
    }
  }

  function renderVariantsCell(a, idx) {
    const vars = ensureLineVariants(a);
    const multi = vars.length > 1;
    const rowsHtml = vars.map((v, vi) => `
      <div class="flex items-center gap-1">
        <div class="relative flex items-center w-24">
          <input type="text" autocomplete="off" data-combo-kind="talla" data-sc-vtalla="${idx}:${vi}" value="${esc(v.talla)}" placeholder="Talla" class="w-full pl-1.5 pr-5 py-1 border border-gray-200 rounded text-xs bg-white" />
          <button type="button" data-combo-btn="talla" tabindex="-1" class="absolute right-0.5 px-1 py-0.5 text-gray-400 hover:text-gray-700 text-[11px] cursor-pointer" title="Elegir talla">▾</button>
        </div>
        <div class="relative flex items-center w-28">
          <input type="text" autocomplete="off" data-combo-kind="color" data-sc-vcolor="${idx}:${vi}" value="${esc(v.color)}" placeholder="Color" class="w-full pl-1.5 pr-5 py-1 border border-gray-200 rounded text-xs bg-white" />
          <button type="button" data-combo-btn="color" tabindex="-1" class="absolute right-0.5 px-1 py-0.5 text-gray-400 hover:text-gray-700 text-[11px] cursor-pointer" title="Elegir color">▾</button>
        </div>
        ${multi ? `<input type="number" min="0" data-sc-vcant="${idx}:${vi}" value="${Number(v.cantidad || 0)}" title="Unidades de esta talla/color" class="w-12 text-center px-1 py-1 border border-gray-200 rounded text-xs bg-white font-medium" />
          <button type="button" data-sc-vdel="${idx}:${vi}" class="text-gray-400 hover:text-red-500 text-xs font-bold px-1 cursor-pointer" title="Quitar variante">✕</button>` : ''}
      </div>
    `).join('');
    return `
      <div class="space-y-1">
        ${rowsHtml}
        <button type="button" data-sc-vadd="${idx}" class="text-[11px] font-semibold text-gray-600 hover:text-gray-900 underline cursor-pointer">+ Talla/Color</button>
      </div>`;
  }

  function renderScanLines() {
    document.getElementById('sc-lineas-tbody').innerHTML = extracted.articulos.map((a, idx) => {
      const vars = ensureLineVariants(a);
      const cant = Number(a.cantidad || 0);
      const pu = Number(a.precioUnitario || 0);
      const iva = Number(a.tipoIVA || 21);
      const re = Number(a.recargoeEquivalencia ?? 5.2);
      const match = resolveMatchForLine(cachedArts, a);
      const multiVar = vars.length > 1;
      const cantCell = multiVar
        ? `<div class="flex flex-col items-center"><div data-sc-totalcant="${idx}" class="w-14 text-center px-1 py-1 bg-gray-100 border border-gray-200 rounded text-xs font-bold text-gray-800" title="Suma automática de las variantes">${cant}</div><span class="text-[10px] text-gray-400">${vars.length} var.</span></div>`
        : `<input type="number" min="0" data-sc-f="cantidad" data-sc-i="${idx}" value="${cant}" class="w-14 text-center px-1 py-1 border border-gray-200 rounded bg-white" />`;
      return `
        <tr class="${a._skipStock ? 'bg-gray-50/70' : ''}">
          <td class="p-1.5 align-top">
            <input type="text" list="dl-scan-articulos" data-sc-f="descripcion" data-sc-i="${idx}" value="${esc(a.descripcion || '')}" placeholder="${esc(match ? match.nombre : (a._scannedFull || 'Nombre / código completo del artículo'))}" class="w-full px-2 py-1 border border-gray-200 rounded bg-white font-medium" />
            <div class="flex flex-wrap sm:flex-nowrap gap-1 mt-1">
              ${buildLinkSelectHtml(a, idx)}
              <input type="text" list="dl-scan-categorias" data-sc-cat="${idx}" value="${esc(a._catName || '')}" placeholder="Categoría..." title="Asigna o crea categoría del artículo" class="w-full sm:w-32 px-1.5 py-1 border border-gray-200 rounded bg-white text-[11px]" />
              <input type="text" list="dl-scan-aliases" data-sc-alias="${idx}" value="${esc(a._aliasInput || '')}" placeholder="${esc(match ? (Array.isArray(match.aliases) && match.aliases.length ? `Alias actuales: ${match.aliases.join(', ')}` : 'Añadir alias...') : (a._scannedFull ? `Alias (defecto: ${a._scannedFull})` : 'Alias (defecto: nombre completo)'))}" title="Si lo dejas vacío, se usará el nombre/código completo del artículo (o el del producto asociado)" class="w-full sm:w-40 px-1.5 py-1 border border-gray-200 rounded bg-white text-[11px]" />
            </div>
            ${buildMatchInfoHtml(a, idx, match)}
          </td>
          <td class="p-1.5 align-top">${renderVariantsCell(a, idx)}</td>
          <td class="p-1.5 align-top">${cantCell}</td>
          <td class="p-1.5 align-top"><input type="number" step="0.01" data-sc-f="precioUnitario" data-sc-i="${idx}" value="${pu}" class="w-18 text-right px-1 py-1 border border-gray-200 rounded bg-white" /></td>
          <td class="p-1.5 align-top"><input type="number" data-sc-f="tipoIVA" data-sc-i="${idx}" value="${iva}" class="w-12 text-center px-1 py-1 border border-gray-200 rounded bg-white" /></td>
          <td class="p-1.5 align-top"><input type="number" step="0.1" data-sc-f="recargoeEquivalencia" data-sc-i="${idx}" value="${re}" class="w-12 text-center px-1 py-1 border border-gray-200 rounded bg-white" /></td>
          <td class="p-1.5 align-top text-center">
            <button type="button" data-sc-stock-toggle="${idx}" class="px-2 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer whitespace-nowrap ${a._skipStock ? 'bg-gray-100 text-gray-500 border-gray-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}" title="${a._skipStock ? 'Suma en factura pero NO afecta al stock' : 'Sumará al stock al confirmar'}">
              ${a._skipStock ? 'No stock' : '✓ Stock'}
            </button>
          </td>
          <td class="p-1.5 align-top text-center"><button type="button" data-sc-del="${idx}" class="text-red-500 font-bold cursor-pointer">✕</button></td>
        </tr>`;
    }).join('');
    updateScanTotalsAndBadge();
  }

  async function saveScannedInvoice(affectStock = true) {
    const provNom = document.getElementById('sc-prov-nombre').value.trim() || 'Proveedor';
    const provCif = document.getElementById('sc-prov-cif').value.trim();
    const numFac = document.getElementById('sc-num-factura').value.trim() || `S/N-${Date.now()}`;
    const fecha = document.getElementById('sc-fecha').value || new Date().toISOString().slice(0, 10);
    const estadoSel = !affectStock
      ? 'recibido'
      : (document.getElementById('sc-estado')?.value === 'recibido' ? 'recibido' : 'pendiente_recibir');
    const applyStockNow = Boolean(affectStock && estadoSel === 'recibido');

    let baseImponible = 0, cuotaIVA = 0, recargoEquivalencia = 0;
    const cleanArts = extracted.articulos.map(a => {
      const vars = ensureLineVariants(a).map(v => ({
        talla: String(v.talla || 'Única').trim() || 'Única',
        color: String(v.color || 'Estándar').trim() || 'Estándar',
        cantidad: Number(v.cantidad || 0)
      }));
      const matchedPreview = resolveMatchForLine(cachedArts, a);
      const {
        _updateCompra, _nuevoPVenta, _aliasInput, _linkedId, _linkMode, _skipStock, _scannedFull,
        _customNameEdited, _customAliasEdited, _catName, _catEdited, _pvpEdited, variantes, ...rest
      } = a;
      const fullFallback = String(_scannedFull || getScannedFullName(a) || '').trim();
      const defaultDesc = matchedPreview?.nombre || fullFallback || rest.referencia || '';
      const finalDesc = String(rest.descripcion || '').trim() || String(defaultDesc).trim();
      const explicitPvp = (_nuevoPVenta !== undefined && _nuevoPVenta !== '' && Number(_nuevoPVenta) > 0)
        ? round2(Number(_nuevoPVenta))
        : null;
      return {
        ...rest,
        descripcion: finalDesc,
        referencia: String(rest.referencia || (fullFallback && normKey(fullFallback) !== normKey(finalDesc) ? fullFallback : '')).trim(),
        talla: vars.length === 1 ? vars[0].talla : vars.map(v => `${v.talla}/${v.color}×${v.cantidad}`).join(', '),
        color: vars.length === 1 ? vars[0].color : 'Varias',
        cantidad: vars.reduce((s, v) => s + v.cantidad, 0),
        variantes: vars,
        afectaStock: Boolean(affectStock && !_skipStock),
        scannedFull: fullFallback,
        aliasInput: String(_aliasInput || '').trim(),
        catName: String(_catName || '').trim(),
        catEdited: Boolean(_catEdited),
        linkedId: _linkedId ? Number(_linkedId) : null,
        linkMode: _linkMode || 'auto',
        updateCompra: _updateCompra === undefined ? null : Boolean(_updateCompra),
        nuevoPVenta: explicitPvp
      };
    });

    extracted.articulos.forEach(a => {
      ensureLineVariants(a);
      const sub = Number(a.cantidad || 0) * Number(a.precioUnitario || 0);
      baseImponible += sub;
      cuotaIVA += sub * (Number(a.tipoIVA || 21) / 100);
      recargoEquivalencia += sub * (Number(a.recargoeEquivalencia ?? 5.2) / 100);
    });

    const movNowIso = new Date().toISOString();
    const hasStockAffectingLines = cleanArts.some(a => a.afectaStock !== false);

    await db.transaction('rw', [db.proveedores, db.facturas_compra, db.articulos, db.variantes, db.categorias, db.movimientos_stock], async () => {
      const provs = await db.proveedores.toArray();
      const prov = provs.find(p => (provCif && p.CIF === provCif) || (p.nombre || '').toLowerCase() === provNom.toLowerCase());
      const provId = prov ? prov.id : await db.proveedores.add({ nombre: provNom, CIF: provCif, telefono: '', email: '', notas: '', fechaCreacion: movNowIso });

      await db.facturas_compra.add({
        proveedorId: provId, nombreProveedor: provNom, fecha, numeroFactura: numFac,
        baseImponible: round2(baseImponible), cuotaIVA: round2(cuotaIVA),
        recargoEquivalencia: round2(recargoEquivalencia),
        total: round2(baseImponible + cuotaIVA + recargoEquivalencia),
        estado: estadoSel,
        fechaRecepcion: applyStockNow ? movNowIso : null,
        stockAplicado: Boolean(applyStockNow && hasStockAffectingLines),
        articulos: cleanArts
      });

      if (!applyStockNow) return;

      await aplicarStockFacturaCompra({
        articulos: extracted.articulos,
        provId,
        provNom,
        numFac,
        movNowIso
      });
    });

    const anyStockUpdated = applyStockNow && hasStockAffectingLines;
    document.getElementById('modal-scan-factura').classList.add('hidden');
    if (!affectStock) {
      showToast('Factura registrada sin afectar al stock', 'success');
    } else if (estadoSel === 'pendiente_recibir') {
      showToast('Factura guardada como pendiente de recibir (stock sin modificar)', 'success');
    } else {
      showToast(anyStockUpdated ? 'Factura guardada como recibida y stock actualizado' : 'Factura guardada como recibida', 'success');
    }
    await StockModule.refresh();
    await ProveedoresModule.refreshActive();
    await recalcularAlertasStock(false);
  }

  function init() {
    const openScanner = () => {
      imageBase64 = '';
      pagesImages = [];
      extracted = null;
      document.getElementById('scan-preview-box').classList.add('hidden');
      document.getElementById('scan-preview-info')?.classList.add('hidden');
      document.getElementById('scan-preview-pages')?.classList.add('hidden');
      document.getElementById('sc-dup-warning')?.classList.add('hidden');
      document.getElementById('scan-input-img').value = '';
      document.getElementById('scan-input-pdf').value = '';
      setStep(1);
      document.getElementById('modal-scan-factura').classList.remove('hidden');
    };
    document.getElementById('btn-escanear-factura')?.addEventListener('click', openScanner);
    document.getElementById('btn-prov-escanear-factura')?.addEventListener('click', openScanner);
    document.getElementById('scan-close').addEventListener('click', () => document.getElementById('modal-scan-factura').classList.add('hidden'));

    document.getElementById('scan-input-img').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      mimeType = f.type || 'image/jpeg';
      const r = new FileReader();
      r.onload = () => {
        imageBase64 = r.result;
        pagesImages = [{ dataUrl: imageBase64, mimeType }];
        renderPagesPreview();
        setStep(1);
      };
      r.readAsDataURL(f);
    });

    document.getElementById('scan-input-pdf').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f || !window.pdfjsLib) return;
      showGlobalSpinner('Renderizando páginas del PDF...');
      try {
        const buf = await f.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const maxPages = Math.min(pdf.numPages, 10);
        const rendered = [];
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const vp = page.getViewport({ scale: 1.65 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          rendered.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.86), mimeType: 'image/jpeg' });
        }
        mimeType = 'image/jpeg';
        pagesImages = rendered;
        imageBase64 = rendered[0]?.dataUrl || '';
        renderPagesPreview(pdf.numPages);
        setStep(1);
      } catch (err) {
        showToast('Error al leer el PDF: ' + err.message, 'error');
      } finally { hideGlobalSpinner(); }
    });

    document.getElementById('scan-preview-pages')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scan-page-idx]');
      if (!btn) return;
      const idx = Number(btn.dataset.scanPageIdx);
      const target = pagesImages[idx];
      if (!target) return;
      document.getElementById('scan-preview-img').src = target.dataUrl;
      document.querySelectorAll('[data-scan-page-idx]').forEach(el => {
        const active = Number(el.dataset.scanPageIdx) === idx;
        el.classList.toggle('border-[#727D6E]', active);
        el.classList.toggle('bg-[#F5F7F4]', active);
        el.classList.toggle('border-gray-200', !active);
        el.classList.toggle('bg-white', !active);
      });
    });

    ['sc-prov-nombre', 'sc-prov-cif', 'sc-num-factura'].forEach(fid => {
      document.getElementById(fid)?.addEventListener('input', checkDuplicateInvoice);
    });

    const onRuleChanged = () => {
      const mult = Math.max(1, Number(document.getElementById('sc-pvp-mult')?.value || 2));
      const round = document.getElementById('sc-pvp-round')?.value || '90';
      savePvpRule({ mult, round });
    };
    document.getElementById('sc-pvp-mult')?.addEventListener('input', onRuleChanged);
    document.getElementById('sc-pvp-round')?.addEventListener('change', onRuleChanged);
    document.getElementById('sc-apply-pvp-rule')?.addEventListener('click', () => {
      if (!extracted?.articulos) return;
      onRuleChanged();
      const rule = getPvpRule();
      let updatedCount = 0;
      extracted.articulos.forEach(a => {
        if (a._skipStock) return;
        const match = resolveMatchForLine(cachedArts, a);
        const pu = Number(a.precioUnitario || 0);
        if (!match && pu > 0) {
          const sugg = calcSuggestedPvp(pu, rule.mult, rule.round);
          if (sugg > 0) {
            a._nuevoPVenta = sugg.toFixed(2);
            a._pvpEdited = false;
            updatedCount++;
          }
        }
      });
      renderScanLines();
      showToast(updatedCount ? `PVP recalculado en ${updatedCount} artículo(s) nuevo(s)` : 'No hay artículos nuevos con coste para recalcular', 'success');
    });

    document.getElementById('sc-estado')?.addEventListener('change', syncScanEstadoUi);
    document.getElementById('scan-btn-next').addEventListener('click', () => {
      if (step === 1) { setStep(2); extractWithGemini(); }
      else if (step === 3) saveScannedInvoice(true);
    });
    document.getElementById('scan-btn-save-no-stock')?.addEventListener('click', () => {
      if (step === 3) saveScannedInvoice(false);
    });
    document.getElementById('scan-btn-back').addEventListener('click', () => setStep(1));
    document.getElementById('scan-btn-retry').addEventListener('click', extractWithGemini);
    document.getElementById('sc-add-linea').addEventListener('click', () => {
      extracted.articulos.push({
        descripcion: '',
        referencia: '',
        talla: 'Única',
        color: 'Estándar',
        cantidad: 1,
        variantes: [{ talla: 'Única', color: 'Estándar', cantidad: 1 }],
        precioUnitario: 0,
        tipoIVA: 21,
        recargoeEquivalencia: 5.2,
        _scannedFull: '',
        _aliasInput: '',
        _catName: '',
        _catEdited: false,
        _pvpEdited: false,
        _linkMode: 'auto',
        _linkedId: null,
        _skipStock: false,
        _customNameEdited: false,
        _customAliasEdited: false
      });
      renderScanLines();
    });
    document.getElementById('sc-lineas-tbody').addEventListener('change', e => {
      if (e.target.dataset.scUpdPc !== undefined) {
        const idx = Number(e.target.dataset.scUpdPc);
        if (extracted.articulos[idx]) extracted.articulos[idx]._updateCompra = e.target.checked;
        return;
      }
      if (e.target.dataset.scLink !== undefined) {
        const idx = Number(e.target.dataset.scLink);
        const a = extracted.articulos[idx];
        if (!a) return;
        const val = e.target.value;
        if (val === '__new__') {
          a._linkMode = 'new';
          a._linkedId = null;
        } else if (val === '') {
          a._linkMode = 'auto';
          a._linkedId = null;
        } else {
          a._linkMode = 'linked';
          a._linkedId = Number(val);
        }
        a._customNameEdited = false;
        a._customAliasEdited = false;
        a._catEdited = false;
        a._pvpEdited = false;
        delete a._nuevoPVenta;
        delete a._updateCompra;
        updateScanTotalsAndBadge(idx);
      }
    });
    document.getElementById('sc-lineas-tbody').addEventListener('input', e => {
      if (e.target.dataset.scPventa !== undefined) {
        const idx = Number(e.target.dataset.scPventa);
        if (extracted.articulos[idx]) {
          extracted.articulos[idx]._nuevoPVenta = e.target.value;
          extracted.articulos[idx]._pvpEdited = e.target.value.trim() !== '';
        }
        return;
      }
      if (e.target.dataset.scCat !== undefined) {
        const idx = Number(e.target.dataset.scCat);
        const a = extracted.articulos[idx];
        if (a) {
          a._catName = e.target.value;
          a._catEdited = true;
        }
        return;
      }
      if (e.target.dataset.scAlias !== undefined) {
        const idx = Number(e.target.dataset.scAlias);
        const a = extracted.articulos[idx];
        if (a) {
          a._aliasInput = e.target.value;
          a._customAliasEdited = e.target.value.trim() !== '';
          updateScanTotalsAndBadge(idx);
        }
        return;
      }
      if (e.target.dataset.scVtalla !== undefined || e.target.dataset.scVcolor !== undefined || e.target.dataset.scVcant !== undefined) {
        const raw = e.target.dataset.scVtalla ?? e.target.dataset.scVcolor ?? e.target.dataset.scVcant;
        const [idxStr, viStr] = raw.split(':');
        const idx = Number(idxStr), vi = Number(viStr);
        const a = extracted.articulos[idx];
        if (!a) return;
        const vars = ensureLineVariants(a);
        if (!vars[vi]) return;
        if (e.target.dataset.scVtalla !== undefined) vars[vi].talla = e.target.value;
        if (e.target.dataset.scVcolor !== undefined) vars[vi].color = e.target.value;
        if (e.target.dataset.scVcant !== undefined) vars[vi].cantidad = Number(e.target.value || 0);
        ensureLineVariants(a);
        const totEl = document.querySelector(`[data-sc-totalcant="${idx}"]`);
        if (totEl) totEl.textContent = String(a.cantidad);
        updateScanTotalsAndBadge(idx);
        return;
      }
      const i = Number(e.target.dataset.scI); const f = e.target.dataset.scF;
      if (f && extracted.articulos[i]) {
        const a = extracted.articulos[i];
        a[f] = ['cantidad', 'precioUnitario', 'tipoIVA', 'recargoeEquivalencia'].includes(f) ? Number(e.target.value) : e.target.value;
        if (f === 'descripcion') {
          a._customNameEdited = String(e.target.value || '').trim() !== '';
        }
        if (f === 'precioUnitario' && !a._pvpEdited) {
          const match = resolveMatchForLine(cachedArts, a);
          if (!match) {
            const rule = getPvpRule();
            const sugg = calcSuggestedPvp(a.precioUnitario, rule.mult, rule.round);
            a._nuevoPVenta = sugg > 0 ? sugg.toFixed(2) : '';
          }
        }
        if (f === 'cantidad') {
          const vars = ensureLineVariants(a);
          if (vars.length === 1) vars[0].cantidad = Number(e.target.value || 0);
          ensureLineVariants(a);
        }
        updateScanTotalsAndBadge(i);
      }
    });
    document.getElementById('sc-lineas-tbody').addEventListener('click', e => {
      const addVarBtn = e.target.closest('[data-sc-vadd]');
      if (addVarBtn) {
        const idx = Number(addVarBtn.dataset.scVadd);
        const a = extracted.articulos[idx];
        if (!a) return;
        const vars = ensureLineVariants(a);
        vars.push({ talla: '', color: vars[0]?.color || 'Estándar', cantidad: 1 });
        ensureLineVariants(a);
        renderScanLines();
        return;
      }
      const delVarBtn = e.target.closest('[data-sc-vdel]');
      if (delVarBtn) {
        const [idxStr, viStr] = delVarBtn.dataset.scVdel.split(':');
        const idx = Number(idxStr), vi = Number(viStr);
        const a = extracted.articulos[idx];
        if (!a) return;
        const vars = ensureLineVariants(a);
        if (vars.length > 1) {
          vars.splice(vi, 1);
          ensureLineVariants(a);
          renderScanLines();
        }
        return;
      }
      const stockBtn = e.target.closest('[data-sc-stock-toggle]');
      if (stockBtn) {
        const idx = Number(stockBtn.dataset.scStockToggle);
        const a = extracted.articulos[idx];
        if (!a) return;
        a._skipStock = !a._skipStock;
        renderScanLines();
        return;
      }
      const delRowBtn = e.target.closest('[data-sc-del]');
      if (delRowBtn) {
        extracted.articulos.splice(Number(delRowBtn.dataset.scDel), 1);
        renderScanLines();
      }
    });
  }
  return { init };
})();

// ==================== 6. MÓDULO CLIENTES ====================
const ClientesModule = (() => {
  const ESTADOS_FACT = new Set(['pagado', 'enviado', 'completado']);
  const EST_META = {
    pendiente_pago: { label: 'Pendiente', cls: 'bg-gray-100 text-gray-700' },
    pagado: { label: 'Pagado', cls: 'bg-orange-100 text-orange-800' },
    enviado: { label: 'Enviado', cls: 'bg-blue-100 text-blue-800' },
    completado: { label: 'Completado', cls: 'bg-green-100 text-green-800' },
    cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' }
  };
  let page = 1, sortBy = 'nombre', sortDir = 'asc', currentCliId = null;
  let modalEditId = null, modalOnSaved = null;

  async function renderList() {
    const [clis, peds, lineas] = await Promise.all([db.clientes.toArray(), db.pedidos.toArray(), db.lineasPedido.toArray()]);
    const lByP = new Map();
    lineas.forEach(l => { if (!lByP.has(l.pedidoId)) lByP.set(l.pedidoId, []); lByP.get(l.pedidoId).push(l); });

    const q = document.getElementById('clientes-search').value.trim().toLowerCase();
    let list = clis.map(c => {
      const sus = peds.filter(p => p.clienteId === c.id);
      const totalGastado = sus.filter(p => ESTADOS_FACT.has(p.estado)).reduce((acc, p) => acc + calcPedidoTotales(p, lByP.get(p.id) || []).totalNeto, 0);
      const ult = sus.length ? sus.map(p => p.fecha).sort().reverse()[0] : '';
      return { ...c, totalGastado, numPedidos: sus.length, ultimoPedido: ult };
    }).filter(c => !q || (c.nombre || '').toLowerCase().includes(q) || (c.telefono || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q));

    list.sort((a, b) => {
      const m = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'totalGastado') return (a.totalGastado - b.totalGastado) * m;
      if (sortBy === 'numPedidos') return (a.numPedidos - b.numPedidos) * m;
      if (sortBy === 'ultimoPedido') return String(a.ultimoPedido).localeCompare(String(b.ultimoPedido)) * m;
      return String(a.nombre || '').localeCompare(String(b.nombre || '')) * m;
    });

    const perPage = 20;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    if (page > totalPages) page = totalPages;
    const slice = list.slice((page - 1) * perPage, page * perPage);

    const tbody = document.getElementById('clientes-tbody');
    document.getElementById('clientes-empty').classList.toggle('hidden', slice.length > 0);
    tbody.innerHTML = slice.map(c => `
      <tr class="hover:bg-gray-50 cursor-pointer" data-cli-open="${c.id}">
        <td class="px-4 py-3 font-semibold text-gray-900">${esc(c.nombre || 'Sin nombre')}</td>
        <td class="px-4 py-3 text-gray-600">${esc(c.telefono || '—')}</td>
        <td class="px-4 py-3 text-gray-500 text-xs">${esc(c.email || '—')}</td>
        <td class="px-4 py-3 text-right font-semibold">${fmtEur(c.totalGastado)}</td>
        <td class="px-4 py-3 text-center">${c.numPedidos}</td>
        <td class="px-4 py-3 text-gray-500 text-xs">${fmtFecha(c.ultimoPedido)}</td>
        <td class="px-4 py-3 text-right whitespace-nowrap" onclick="event.stopPropagation()">
          <button type="button" data-cli-open="${c.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-100 cursor-pointer mr-1">Ver</button>
          <button type="button" data-cli-edit="${c.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-100 cursor-pointer mr-1">Editar</button>
          <button type="button" data-cli-del="${c.id}" class="px-2 py-1 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 cursor-pointer">✕</button>
        </td>
      </tr>
    `).join('');

    document.getElementById('clientes-page-info').textContent = `${list.length} cliente(s)`;
    document.getElementById('clientes-page-num').textContent = `${page} / ${totalPages}`;
    document.getElementById('clientes-prev').disabled = page <= 1;
    document.getElementById('clientes-next').disabled = page >= totalPages;
  }

  async function openModal({ clienteId = null, onSaved = null } = {}) {
    modalEditId = clienteId;
    modalOnSaved = onSaved;
    const c = clienteId ? await db.clientes.get(clienteId) : null;
    document.getElementById('mcli-title').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
    document.getElementById('mcli-nombre').value = c?.nombre || '';
    document.getElementById('mcli-tel').value = c?.telefono || '';
    document.getElementById('mcli-email').value = c?.email || '';
    document.getElementById('mcli-nif').value = c?.nif || '';
    document.getElementById('mcli-calle').value = c?.calle || '';
    document.getElementById('mcli-ciudad').value = c?.ciudad || '';
    document.getElementById('mcli-cp').value = c?.cp || '';
    document.getElementById('mcli-notas').value = c?.notas || '';
    document.getElementById('modal-cliente').classList.remove('hidden');
  }

  async function openFicha(id) {
    currentCliId = Number(id);
    const [c, peds, lineas] = await Promise.all([
      db.clientes.get(currentCliId),
      db.pedidos.where('clienteId').equals(currentCliId).toArray(),
      db.lineasPedido.toArray()
    ]);
    if (!c) return;

    document.getElementById('clientes-subview-lista').classList.add('hidden');
    document.getElementById('clientes-subview-ficha').classList.remove('hidden');

    document.getElementById('cf-nombre').textContent = c.nombre || c.telefono || 'Cliente';
    document.getElementById('cf-contacto').textContent = [c.telefono, c.email, c.nif ? `NIF: ${c.nif}` : ''].filter(Boolean).join(' · ') || 'Sin datos de contacto';
    document.getElementById('cf-direccion').textContent = c.direccion || [c.calle, c.cp, c.ciudad].filter(Boolean).join(', ') || 'Sin dirección';
    document.getElementById('cf-notas').value = c.notas || '';
    const waCliBtn = document.getElementById('cli-ficha-whatsapp');
    if (waCliBtn) {
      const waUrl = buildWhatsAppUrl(c.telefono, `¡Hola ${c.nombre || ''}! Te escribimos desde babyluc.`);
      waCliBtn.classList.toggle('hidden', !waUrl);
      if (waUrl) waCliBtn.href = waUrl;
    }

    const lByP = new Map();
    lineas.forEach(l => { if (!lByP.has(l.pedidoId)) lByP.set(l.pedidoId, []); lByP.get(l.pedidoId).push(l); });

    const enriched = peds.map(p => {
      const ls = lByP.get(p.id) || [];
      const total = calcPedidoTotales(p, ls).totalNeto;
      return { ...p, total, ls, resumen: ls.map(l => `${l.cantidad}× ${l.nombreArticulo}`).join(', ') || '—' };
    }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const pagados = enriched.filter(p => ESTADOS_FACT.has(p.estado));
    const totalGastado = pagados.reduce((acc, p) => acc + p.total, 0);
    const pendientes = enriched.filter(p => p.estado === 'pendiente_pago').length;
    const ticketMedio = pagados.length ? totalGastado / pagados.length : 0;
    const mayor = pagados.length ? Math.max(...pagados.map(p => p.total)) : 0;
    const fechas = enriched.map(p => p.fecha).sort();

    const bolsaPeds = enriched.filter(p => p.enBolsa && (p.estado === 'pendiente_pago' || p.estado === 'pagado'))
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const cfBolsaBanner = document.getElementById('cf-bolsa-banner');
    if (cfBolsaBanner) {
      if (bolsaPeds.length) {
        const bKey = bolsaPeds[0].bolsaId || `cli_${c.id}`;
        const bArts = bolsaPeds.reduce((s, p) => s + (p.ls || []).reduce((la, l) => (Number(l.precioUnitario || 0) >= 0 && l.descripcionVariante !== 'Portes' ? la + Math.max(0, Number(l.cantidad || 0)) : la), 0), 0);
        const bTot = round2(bolsaPeds.reduce((s, p) => s + p.total, 0));
        const bPend = round2(bolsaPeds.filter(p => p.estado === 'pendiente_pago').reduce((s, p) => s + p.total, 0));
        const bPag = round2(bTot - bPend);
        const bHasPorte = bolsaPeds.some(p => Number(p.gastosEnvio || 0) > 0 || (p.ls || []).some(l => l.descripcionVariante === 'Portes'));
        cfBolsaBanner.classList.remove('hidden');
        cfBolsaBanner.className = 'bg-amber-50/80 border border-amber-200 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3';
        cfBolsaBanner.innerHTML = `
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-bold text-amber-950">🛍️ Bolsa abierta en tienda</span>
              <span class="px-2 py-0.5 rounded-lg bg-white border border-amber-200 text-[11px] font-semibold text-amber-900">${bolsaPeds.length} pedido(s) · ${bArts} art.</span>
              <span class="px-2 py-0.5 rounded-lg text-[11px] font-semibold ${bHasPorte ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-200/70 text-amber-900'}">${bHasPorte ? '🚚 Con porte' : '⚠️ Sin porte aún'}</span>
            </div>
            <p class="text-xs text-amber-900 mt-1">Acumulado: <strong>${fmtEur(bTot)}</strong> · Pagado: <strong>${fmtEur(bPag)}</strong> · Pendiente: <strong>${fmtEur(bPend)}</strong></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" id="cf-bolsa-ver-btn" class="px-3 py-1.5 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-xs font-semibold text-amber-950 cursor-pointer">Ver en bolsas</button>
            <button type="button" id="cf-bolsa-add-btn" class="px-3 py-1.5 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 text-xs font-semibold text-gray-800 cursor-pointer">+ Añadir pedido</button>
            <button type="button" id="cf-bolsa-alb-btn" class="px-3 py-1.5 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 text-xs font-semibold text-gray-800 cursor-pointer">📄 Albarán bolsa</button>
            <button type="button" id="cf-bolsa-close-btn" class="px-3.5 py-1.5 rounded-xl bg-[#B6BEB2] hover:bg-[#A3ADA0] text-xs font-bold text-gray-900 cursor-pointer">📦 Cerrar y enviar</button>
          </div>`;
        document.getElementById('cf-bolsa-ver-btn').onclick = () => window.openPedidosBolsasTab(bKey);
        document.getElementById('cf-bolsa-add-btn').onclick = () => window.openWizardBolsaForCliente(c.id);
        document.getElementById('cf-bolsa-alb-btn').onclick = () => window.openAlbaranBolsa(bolsaPeds.map(p => p.id));
        document.getElementById('cf-bolsa-close-btn').onclick = () => window.openCerrarBolsaModal(bKey);
      } else {
        cfBolsaBanner.classList.add('hidden');
        cfBolsaBanner.innerHTML = '';
      }
    }

    document.getElementById('cf-kpis').innerHTML = [
      ['💰 Total gastado', fmtEur(totalGastado)],
      ['🛍️ Pedidos', `${enriched.length} (${pagados.length} pag. / ${pendientes} pend.)`],
      ['🎫 Ticket medio', fmtEur(ticketMedio)],
      ['🏆 Mayor pedido', fmtEur(mayor)],
      ['📅 Primer / Último', fechas.length ? `${fmtFecha(fechas[0])} · ${fmtFecha(fechas[fechas.length - 1])}` : '—']
    ].map(([t, v]) => `<div class="bg-white border border-gray-200 rounded-2xl p-3.5 shadow-xs"><p class="text-[11px] font-semibold text-gray-500">${t}</p><p class="text-sm font-bold text-gray-900 mt-1">${v}</p></div>`).join('');

    const estFilter = document.getElementById('cf-filter-estado').value;
    const filtPeds = enriched.filter(p => !estFilter || p.estado === estFilter);
    document.getElementById('cf-pedidos-tbody').innerHTML = filtPeds.length ? filtPeds.map(p => {
      const em = EST_META[p.estado] || EST_META.pendiente_pago;
      const enBolsaAct = Boolean(p.enBolsa && (p.estado === 'pendiente_pago' || p.estado === 'pagado'));
      return `
        <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.openPedidoDetalle(${p.id}, { returnToClienteId: ${c.id} })">
          <td class="px-3 py-2.5 font-bold text-[#727D6E]">${esc(p.numero)}${enBolsaAct ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold">🛍️ Bolsa</span>' : ''}</td>
          <td class="px-3 py-2.5 text-xs text-gray-500">${fmtFecha(p.fecha)}</td>
          <td class="px-3 py-2.5 text-xs text-gray-600 max-w-xs truncate">${esc(p.resumen)}</td>
          <td class="px-3 py-2.5 text-right font-semibold">${fmtEur(p.total)}</td>
          <td class="px-3 py-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-semibold ${em.cls}">${em.label}</span></td>
        </tr>`;
    }).join('') : '<tr><td colspan="5" class="py-6 text-center text-xs text-gray-400">Sin pedidos registrados.</td></tr>';

    const topMap = new Map();
    pagados.forEach(p => p.ls.forEach(l => topMap.set(l.nombreArticulo, (topMap.get(l.nombreArticulo) || 0) + Number(l.cantidad))));
    const topArr = [...topMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    document.getElementById('cf-top-articulos').innerHTML = topArr.length
      ? topArr.map(([nom, u]) => `<li class="py-2 flex justify-between"><span class="text-gray-800">${esc(nom)}</span><strong class="text-gray-900">${u} ud.</strong></li>`).join('')
      : '<li class="py-6 text-center text-xs text-gray-400">Sin compras aún.</li>';
  }

  async function deleteCliente(id) {
    const peds = await db.pedidos.where('clienteId').equals(id).toArray();
    if (!peds.length) {
      await db.clientes.delete(id);
      showToast('Cliente eliminado', 'success');
      document.getElementById('clientes-subview-ficha').classList.add('hidden');
      document.getElementById('clientes-subview-lista').classList.remove('hidden');
      return renderList();
    }
    const modal = document.getElementById('modal-pedido-confirm');
    document.getElementById('modal-pconf-title').textContent = 'Eliminar cliente con pedidos';
    document.getElementById('modal-pconf-desc').textContent = `Tiene ${peds.length} pedido(s). Se conservará su nombre en los pedidos pero se desvinculará su ficha.`;
    document.getElementById('modal-pconf-label').textContent = 'Escribe ELIMINAR para confirmar:';
    const inp = document.getElementById('modal-pconf-input'); inp.value = '';
    modal.classList.remove('hidden');
    document.getElementById('modal-pconf-ok').onclick = async () => {
      if (inp.value.trim().toUpperCase() !== 'ELIMINAR') return showToast('Escribe ELIMINAR exactamente', 'warning');
      modal.classList.add('hidden');
      await db.transaction('rw', [db.clientes, db.pedidos], async () => {
        for (const p of peds) await db.pedidos.update(p.id, { clienteId: null });
        await db.clientes.delete(id);
      });
      showToast('Cliente eliminado', 'success');
      document.getElementById('clientes-subview-ficha').classList.add('hidden');
      document.getElementById('clientes-subview-lista').classList.remove('hidden');
      renderList();
    };
  }

  function init() {
    document.getElementById('btn-nuevo-cliente').addEventListener('click', () => openModal());
    document.getElementById('clientes-search').addEventListener('input', () => { page = 1; renderList(); });
    document.querySelectorAll('[data-sort-cli]').forEach(b => b.addEventListener('click', () => {
      const col = b.dataset.sortCli;
      if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortBy = col; sortDir = 'asc'; }
      renderList();
    }));
    document.getElementById('clientes-prev').addEventListener('click', () => { if (page > 1) { page--; renderList(); } });
    document.getElementById('clientes-next').addEventListener('click', () => { page++; renderList(); });
    document.getElementById('clientes-tbody').addEventListener('click', e => {
      const bDel = e.target.closest('[data-cli-del]'); if (bDel) return deleteCliente(Number(bDel.dataset.cliDel));
      const bEdit = e.target.closest('[data-cli-edit]'); if (bEdit) return openModal({ clienteId: Number(bEdit.dataset.cliEdit), onSaved: () => renderList() });
      const bOpen = e.target.closest('[data-cli-open]'); if (bOpen) openFicha(Number(bOpen.dataset.cliOpen));
    });

    document.getElementById('cli-ficha-volver').addEventListener('click', () => {
      document.getElementById('clientes-subview-ficha').classList.add('hidden');
      document.getElementById('clientes-subview-lista').classList.remove('hidden');
      renderList();
    });
    document.getElementById('cli-ficha-editar').addEventListener('click', () => openModal({ clienteId: currentCliId, onSaved: () => openFicha(currentCliId) }));
    document.getElementById('cli-ficha-eliminar').addEventListener('click', () => deleteCliente(currentCliId));
    document.getElementById('cf-save-notas').addEventListener('click', async () => {
      await db.clientes.update(currentCliId, { notas: document.getElementById('cf-notas').value.trim() });
      showToast('Notas guardadas', 'success');
    });
    document.getElementById('cf-filter-estado').addEventListener('change', () => openFicha(currentCliId));

    const closeM = () => document.getElementById('modal-cliente').classList.add('hidden');
    document.getElementById('mcli-close').addEventListener('click', closeM);
    document.getElementById('mcli-cancel').addEventListener('click', closeM);
    document.getElementById('mcli-save').addEventListener('click', async () => {
      const nombre = document.getElementById('mcli-nombre').value.trim();
      const telefono = document.getElementById('mcli-tel').value.trim();
      if (!nombre && !telefono) return showToast('Introduce al menos el nombre o el teléfono', 'warning');
      const calle = document.getElementById('mcli-calle').value.trim();
      const ciudad = document.getElementById('mcli-ciudad').value.trim();
      const cp = document.getElementById('mcli-cp').value.trim();
      const data = {
        nombre, telefono,
        email: document.getElementById('mcli-email').value.trim(),
        nif: document.getElementById('mcli-nif').value.trim(),
        calle, ciudad, cp, direccion: [calle, cp, ciudad].filter(Boolean).join(', '),
        notas: document.getElementById('mcli-notas').value.trim()
      };
      let savedId = modalEditId;
      if (modalEditId) await db.clientes.update(modalEditId, data);
      else savedId = await db.clientes.add({ ...data, fechaCreacion: new Date().toISOString() });
      const savedObj = await db.clientes.get(savedId);
      closeM();
      showToast('Cliente guardado', 'success');
      if (modalOnSaved) modalOnSaved(savedObj);
      else renderList();
    });
  }

  function onEnterView() {
    document.getElementById('clientes-subview-ficha').classList.add('hidden');
    document.getElementById('clientes-subview-lista').classList.remove('hidden');
    renderList();
  }

  return { init, onEnterView, openModal, openFicha };
})();

window.openClienteModal = (opts) => ClientesModule.openModal(opts);
window.openClienteFicha = (id) => {
  navigateTo('clientes', { skipEnter: true });
  ClientesModule.openFicha(id);
};

// ==================== 6B. MÓDULO PROVEEDORES + FACTURAS DE COMPRA ====================
const ProveedoresModule = (() => {
  let activeTab = 'directorio';
  let sortBy = 'nombre';
  let sortDir = 'asc';
  let currentProvId = null;
  let editProvId = null;
  let curFacCompId = null;

  const matchFacturaProveedor = (f, p) => {
    if (f.proveedorId && Number(f.proveedorId) === Number(p.id)) return true;
    if (!f.proveedorId && f.nombreProveedor && p.nombre) {
      return String(f.nombreProveedor).trim().toLowerCase() === String(p.nombre).trim().toLowerCase();
    }
    return false;
  };

  function setTab(tab) {
    activeTab = tab === 'facturas' ? 'facturas' : 'directorio';
    document.getElementById('prov-tab-directorio').classList.toggle('hidden', activeTab !== 'directorio');
    document.getElementById('prov-tab-facturas').classList.toggle('hidden', activeTab !== 'facturas');
    document.querySelectorAll('.prov-tab-btn').forEach(b => {
      const act = b.dataset.provTab === activeTab;
      b.className = act
        ? 'prov-tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] cursor-pointer'
        : 'prov-tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 cursor-pointer';
    });
    if (activeTab === 'facturas') renderFacturas();
    else renderList();
  }

  function updatePendientesBadge(facs) {
    const badge = document.getElementById('prov-fac-pend-badge');
    if (!badge) return;
    const count = (facs || []).filter(f => getFacturaCompraEstado(f) === 'pendiente_recibir').length;
    badge.classList.toggle('hidden', count === 0);
    if (count > 0) badge.textContent = `${count} pend.`;
  }

  async function renderList() {
    const [provs, facs] = await Promise.all([db.proveedores.toArray(), db.facturas_compra.toArray()]);
    updatePendientesBadge(facs);
    const q = (document.getElementById('prov-search')?.value || '').trim().toLowerCase();

    let list = provs.map(p => {
      const sus = facs.filter(f => matchFacturaProveedor(f, p));
      const totalComprado = sus.reduce((acc, f) => acc + Number(f.total || 0), 0);
      const ult = sus.length ? sus.map(f => String(f.fecha || '')).sort().reverse()[0] : '';
      return { ...p, totalComprado, numFacturas: sus.length, ultimaFactura: ult };
    }).filter(p => !q ||
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.CIF || '').toLowerCase().includes(q) ||
      (p.telefono || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q)
    );

    list.sort((a, b) => {
      const m = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'totalComprado') return (a.totalComprado - b.totalComprado) * m;
      if (sortBy === 'numFacturas') return (a.numFacturas - b.numFacturas) * m;
      if (sortBy === 'ultimaFactura') return String(a.ultimaFactura).localeCompare(String(b.ultimaFactura)) * m;
      return String(a.nombre || '').localeCompare(String(b.nombre || '')) * m;
    });

    const tbody = document.getElementById('prov-tbody');
    document.getElementById('prov-empty').classList.toggle('hidden', list.length > 0);
    tbody.innerHTML = list.map(p => {
      const contacto = [p.telefono, p.email].filter(Boolean).join(' · ') || '—';
      return `
        <tr class="hover:bg-gray-50 cursor-pointer" data-prov-open="${p.id}">
          <td class="px-4 py-3 font-semibold text-gray-900">${esc(p.nombre || 'Sin nombre')}</td>
          <td class="px-4 py-3 text-xs text-gray-600">${esc(p.CIF || '—')}</td>
          <td class="px-4 py-3 text-xs text-gray-500">${esc(contacto)}</td>
          <td class="px-4 py-3 text-right font-semibold">${fmtEur(p.totalComprado)}</td>
          <td class="px-4 py-3 text-center">${p.numFacturas}</td>
          <td class="px-4 py-3 text-gray-500 text-xs">${p.ultimaFactura ? fmtFecha(p.ultimaFactura) : '—'}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap" onclick="event.stopPropagation()">
            <button type="button" data-prov-open="${p.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-100 cursor-pointer mr-1">Ver</button>
            <button type="button" data-prov-edit="${p.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-100 cursor-pointer mr-1">Editar</button>
            <button type="button" data-prov-del="${p.id}" class="px-2 py-1 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 cursor-pointer">✕</button>
          </td>
        </tr>`;
    }).join('');
  }

  async function renderFacturas() {
    const [allFacs, provs] = await Promise.all([db.facturas_compra.toArray(), db.proveedores.toArray()]);
    updatePendientesBadge(allFacs);
    const provMap = new Map(provs.map(p => [p.id, p.nombre]));
    const fq = (document.getElementById('faccomp-search')?.value || '').trim().toLowerCase();
    const fEst = document.getElementById('faccomp-filter-estado')?.value || '';
    const fDesde = document.getElementById('faccomp-desde')?.value || '';
    const fHasta = document.getElementById('faccomp-hasta')?.value || '';

    const facs = allFacs
      .filter(f => {
        const est = getFacturaCompraEstado(f);
        if (fEst && est !== fEst) return false;
        const ymd = String(f.fecha || '').slice(0, 10);
        if (fDesde && ymd < fDesde) return false;
        if (fHasta && ymd > fHasta) return false;
        const pNom = f.nombreProveedor || provMap.get(f.proveedorId) || '';
        if (fq && !(f.numeroFactura || '').toLowerCase().includes(fq) && !pNom.toLowerCase().includes(fq)) return false;
        return true;
      })
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (Number(b.id) - Number(a.id)));

    const fEmpty = document.getElementById('faccomp-empty');
    const fTbody = document.getElementById('faccomp-tbody');
    if (!fEmpty || !fTbody) return;
    fEmpty.classList.toggle('hidden', facs.length > 0);
    fTbody.innerHTML = facs.map(f => {
      const ivaRe = Number(f.cuotaIVA || 0) + Number(f.recargoEquivalencia || 0);
      const est = getFacturaCompraEstado(f);
      const estMeta = FAC_COMP_EST_META[est] || FAC_COMP_EST_META.recibido;
      const recibirBtn = est === 'pendiente_recibir'
        ? `<button type="button" data-fc-recibir="${f.id}" class="px-2.5 py-1 text-xs font-semibold rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 mr-1 cursor-pointer">✓ Recibir</button>`
        : '';
      return `
        <tr class="hover:bg-gray-50 cursor-pointer" data-fc-open="${f.id}">
          <td class="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">${fmtFecha(f.fecha)}</td>
          <td class="px-4 py-3 font-bold text-gray-900">${esc(f.numeroFactura)}</td>
          <td class="px-4 py-3 text-gray-700">${esc(f.nombreProveedor || provMap.get(f.proveedorId) || 'Proveedor')}</td>
          <td class="px-4 py-3 whitespace-nowrap"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${estMeta.cls}">${estMeta.label}</span></td>
          <td class="px-4 py-3 text-right">${fmtEur(f.baseImponible)}</td>
          <td class="px-4 py-3 text-right text-xs text-gray-500">${fmtEur(ivaRe)}</td>
          <td class="px-4 py-3 text-right font-semibold">${fmtEur(f.total)}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap" onclick="event.stopPropagation()">
            ${recibirBtn}
            <button type="button" data-fc-open="${f.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-100 mr-1 cursor-pointer">Ver / Editar</button>
            <button type="button" data-fc-del="${f.id}" class="px-2 py-1 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 cursor-pointer">✕</button>
          </td>
        </tr>`;
    }).join('');
  }

  async function openFicha(id) {
    currentProvId = Number(id);
    const [p, allFacs, allArts] = await Promise.all([
      db.proveedores.get(currentProvId),
      db.facturas_compra.toArray(),
      db.articulos.toArray()
    ]);
    if (!p) return;

    activeTab = 'directorio';
    document.getElementById('prov-tab-directorio').classList.remove('hidden');
    document.getElementById('prov-tab-facturas').classList.add('hidden');
    document.querySelectorAll('.prov-tab-btn').forEach(b => {
      const act = b.dataset.provTab === 'directorio';
      b.className = act
        ? 'prov-tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] cursor-pointer'
        : 'prov-tab-btn px-4 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 cursor-pointer';
    });

    document.getElementById('prov-subview-lista').classList.add('hidden');
    document.getElementById('prov-subview-ficha').classList.remove('hidden');

    document.getElementById('pf-nombre').textContent = p.nombre || 'Proveedor';
    document.getElementById('pf-contacto').textContent = [p.CIF ? `CIF: ${p.CIF}` : '', p.telefono, p.email].filter(Boolean).join(' · ') || 'Sin datos de contacto';
    document.getElementById('pf-notas').value = p.notas || '';

    const waBtn = document.getElementById('prov-ficha-whatsapp');
    if (waBtn) {
      const waUrl = buildWhatsAppUrl(p.telefono, `Hola ${p.nombre || ''}, te escribimos desde babyluc.`);
      waBtn.classList.toggle('hidden', !waUrl);
      if (waUrl) waBtn.href = waUrl;
    }

    updatePendientesBadge(allFacs);
    const susFacs = allFacs
      .filter(f => matchFacturaProveedor(f, p))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || (Number(b.id) - Number(a.id)));
    const susArts = allArts
      .filter(a => a.activo !== false && Number(a.proveedorId) === currentProvId)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));

    const totalComprado = susFacs.reduce((acc, f) => acc + Number(f.total || 0), 0);
    const mediaFac = susFacs.length ? totalComprado / susFacs.length : 0;
    const ultimaFecha = susFacs.length ? susFacs[0].fecha : '';

    document.getElementById('pf-kpis').innerHTML = [
      ['💰 Total comprado', fmtEur(totalComprado)],
      ['🧾 Facturas', String(susFacs.length)],
      ['📊 Media factura', fmtEur(mediaFac)],
      ['📅 Última compra', ultimaFecha ? fmtFecha(ultimaFecha) : '—'],
      ['📦 Artículos catálogo', String(susArts.length)]
    ].map(([t, v]) => `<div class="bg-white border border-gray-200 rounded-2xl p-3.5 shadow-xs"><p class="text-[11px] font-semibold text-gray-500">${t}</p><p class="text-sm font-bold text-gray-900 mt-1">${v}</p></div>`).join('');

    document.getElementById('pf-facturas-tbody').innerHTML = susFacs.length
      ? susFacs.map(f => {
          const ivaRe = Number(f.cuotaIVA || 0) + Number(f.recargoEquivalencia || 0);
          const est = getFacturaCompraEstado(f);
          const estMeta = FAC_COMP_EST_META[est] || FAC_COMP_EST_META.recibido;
          const recibirBtn = est === 'pendiente_recibir'
            ? `<button type="button" data-fc-recibir="${f.id}" class="px-2 py-1 text-[11px] font-semibold rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 cursor-pointer whitespace-nowrap">✓ Recibir</button>`
            : '';
          return `
            <tr class="hover:bg-gray-50 cursor-pointer" data-fc-open="${f.id}">
              <td class="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">${fmtFecha(f.fecha)}</td>
              <td class="px-3 py-2.5 font-bold text-[#727D6E]">${esc(f.numeroFactura)}</td>
              <td class="px-3 py-2.5 whitespace-nowrap"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${estMeta.cls}">${estMeta.label}</span></td>
              <td class="px-3 py-2.5 text-right">${fmtEur(f.baseImponible)}</td>
              <td class="px-3 py-2.5 text-right text-xs text-gray-500">${fmtEur(ivaRe)}</td>
              <td class="px-3 py-2.5 text-right font-semibold">${fmtEur(f.total)}</td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap" onclick="event.stopPropagation()">${recibirBtn}</td>
            </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="py-6 text-center text-xs text-gray-400">Sin facturas registradas para este proveedor.</td></tr>';

    document.getElementById('pf-articulos-list').innerHTML = susArts.length
      ? susArts.map(a => `
          <li class="py-2 flex items-center justify-between gap-2">
            <button type="button" data-open-prov-art="${a.id}" class="text-left font-medium text-gray-800 hover:text-[#727D6E] hover:underline truncate cursor-pointer">${esc(a.nombre)}</button>
            <span class="text-xs text-gray-500 whitespace-nowrap">Coste ${fmtEur(a.precioCompra)}</span>
          </li>`).join('')
      : '<li class="py-6 text-center text-xs text-gray-400">Sin artículos vinculados en catálogo.</li>';
  }

  async function openModal(id = null) {
    editProvId = id;
    const p = id ? await db.proveedores.get(id) : null;
    document.getElementById('mprov-title').textContent = p ? 'Editar proveedor' : 'Nuevo proveedor';
    document.getElementById('mprov-nombre').value = p?.nombre || '';
    document.getElementById('mprov-cif').value = p?.CIF || '';
    document.getElementById('mprov-tel').value = p?.telefono || '';
    document.getElementById('mprov-email').value = p?.email || '';
    document.getElementById('mprov-notas').value = p?.notas || '';
    document.getElementById('modal-ajustes-proveedor').classList.remove('hidden');
  }

  async function deleteProveedor(id) {
    const p = await db.proveedores.get(id);
    if (!p) return;
    const [allFacs, allArts] = await Promise.all([db.facturas_compra.toArray(), db.articulos.toArray()]);
    const susFacs = allFacs.filter(f => matchFacturaProveedor(f, p));
    const susArts = allArts.filter(a => Number(a.proveedorId) === Number(id));
    if (!susFacs.length && !susArts.length) {
      await db.proveedores.delete(id);
      showToast('Proveedor eliminado', 'success');
      document.getElementById('prov-subview-ficha').classList.add('hidden');
      document.getElementById('prov-subview-lista').classList.remove('hidden');
      return renderList();
    }
    const modal = document.getElementById('modal-pedido-confirm');
    document.getElementById('modal-pconf-title').textContent = 'Eliminar proveedor';
    document.getElementById('modal-pconf-desc').textContent = `Tiene ${susFacs.length} factura(s) y ${susArts.length} artículo(s). Se conservarán los registros pero se desvinculará su ficha.`;
    document.getElementById('modal-pconf-label').textContent = 'Escribe ELIMINAR para confirmar:';
    const inp = document.getElementById('modal-pconf-input'); inp.value = '';
    modal.classList.remove('hidden');
    document.getElementById('modal-pconf-ok').onclick = async () => {
      if (inp.value.trim().toUpperCase() !== 'ELIMINAR') return showToast('Escribe ELIMINAR exactamente', 'warning');
      modal.classList.add('hidden');
      await db.transaction('rw', [db.proveedores, db.facturas_compra, db.articulos], async () => {
        for (const f of susFacs) await db.facturas_compra.update(f.id, { proveedorId: null });
        for (const a of susArts) await db.articulos.update(a.id, { proveedorId: null });
        await db.proveedores.delete(id);
      });
      showToast('Proveedor eliminado', 'success');
      document.getElementById('prov-subview-ficha').classList.add('hidden');
      document.getElementById('prov-subview-lista').classList.remove('hidden');
      renderList();
    };
  }

  async function marcarFacturaRecibida(id) {
    const f = await db.facturas_compra.get(Number(id));
    if (!f) return;
    const movNowIso = new Date().toISOString();
    const arts = Array.isArray(f.articulos) ? f.articulos : [];
    const hasStockLines = arts.some(a => a.afectaStock !== false && !a._skipStock);
    let stats = { lineasAplicadas: 0, unidadesSumadas: 0, articulosCreados: 0 };

    await db.transaction('rw', [db.facturas_compra, db.articulos, db.variantes, db.categorias, db.movimientos_stock], async () => {
      if (f.stockAplicado !== true && hasStockLines) {
        stats = await aplicarStockFacturaCompra({
          articulos: arts,
          provId: f.proveedorId || null,
          provNom: f.nombreProveedor || 'Proveedor',
          numFac: f.numeroFactura || '',
          movNowIso
        });
      }
      await db.facturas_compra.update(f.id, {
        estado: 'recibido',
        fechaRecepcion: movNowIso,
        stockAplicado: hasStockLines ? true : Boolean(f.stockAplicado)
      });
    });

    if (stats.unidadesSumadas > 0 || stats.lineasAplicadas > 0) {
      const extraNew = stats.articulosCreados > 0 ? ` · ${stats.articulosCreados} art. nuevo(s)` : '';
      showToast(`Factura ${f.numeroFactura} recibida · +${stats.unidadesSumadas} ud(s) añadidas al stock${extraNew}`, 'success');
    } else {
      showToast(`Factura ${f.numeroFactura} marcada como recibida`, 'success');
    }
    await StockModule.refresh();
    await refreshActive();
    await recalcularAlertasStock(false);
  }

  function syncModalFacEstadoBanner(facObj = null) {
    const estEl = document.getElementById('mfc-estado');
    const banner = document.getElementById('mfc-recepcion-banner');
    const statusText = document.getElementById('mfc-stock-status');
    const infoRow = document.getElementById('mfc-stock-info-row');
    if (!estEl || !banner || !infoRow) return;
    const est = estEl.value === 'pendiente_recibir' ? 'pendiente_recibir' : 'recibido';
    const arts = Array.isArray(facObj?.articulos) ? facObj.articulos : [];
    const totalUds = arts.filter(a => a.afectaStock !== false).reduce((s, a) => s + Number(a.cantidad || 0), 0);

    if (curFacCompId && est === 'pendiente_recibir') {
      banner.classList.remove('hidden');
      if (statusText) {
        statusText.textContent = totalUds > 0
          ? `Al marcar como recibido se sumarán ${totalUds} unidad(es) al inventario.`
          : 'Sin líneas de stock detalladas; solo actualizará el estado de recepción.';
      }
      infoRow.classList.add('hidden');
    } else {
      banner.classList.add('hidden');
      if (curFacCompId) {
        const applied = facObj?.stockAplicado === true || (facObj?.stockAplicado === undefined && getFacturaCompraEstado(facObj) === 'recibido');
        const fechaRec = facObj?.fechaRecepcion ? ` (${fmtFechaHora(facObj.fechaRecepcion)})` : '';
        infoRow.textContent = applied
          ? `✅ Stock ya sumado al inventario${fechaRec}. Si cambias a "Pendiente de recibir" y guardas, se revertirá ese stock.`
          : '📄 Factura marcada como recibida (sin movimientos de stock pendientes).';
        infoRow.classList.remove('hidden');
      } else {
        infoRow.classList.add('hidden');
      }
    }
  }

  async function openFacModal(id = null) {
    if (!id) {
      curFacCompId = null;
      document.getElementById('mfc-title').textContent = 'Nueva factura de compra';
      document.getElementById('mfc-subtitle').textContent = 'Registra manualmente una factura de proveedor para Balances y Modelo 303.';
      document.getElementById('mfc-proveedor').value = '';
      document.getElementById('mfc-fecha').value = new Date().toISOString().slice(0, 10);
      document.getElementById('mfc-numero').value = '';
      const estEl = document.getElementById('mfc-estado');
      if (estEl) estEl.value = 'pendiente_recibir';
      document.getElementById('mfc-base').value = '';
      document.getElementById('mfc-iva').value = '';
      document.getElementById('mfc-re').value = '';
      document.getElementById('mfc-total').value = '';
      document.getElementById('mfc-articulos-tbody').innerHTML = '';
      document.getElementById('mfc-articulos-wrap')?.classList.add('hidden');
      document.getElementById('mfc-delete')?.classList.add('hidden');
      syncModalFacEstadoBanner(null);
      const saveBtn = document.getElementById('mfc-save');
      if (saveBtn) saveBtn.textContent = 'Crear factura';
      document.getElementById('modal-factura-compra').classList.remove('hidden');
      return;
    }

    const f = await db.facturas_compra.get(id);
    if (!f) return;
    curFacCompId = id;
    document.getElementById('mfc-title').textContent = `Factura ${f.numeroFactura || ''}`;
    document.getElementById('mfc-subtitle').textContent = 'Consulta o corrige los importes registrados para Balances y RE.';
    document.getElementById('mfc-proveedor').value = f.nombreProveedor || '';
    document.getElementById('mfc-fecha').value = String(f.fecha || '').slice(0, 10);
    document.getElementById('mfc-numero').value = f.numeroFactura || '';
    const estEl = document.getElementById('mfc-estado');
    if (estEl) estEl.value = getFacturaCompraEstado(f);
    document.getElementById('mfc-base').value = Number(f.baseImponible || 0).toFixed(2);
    document.getElementById('mfc-iva').value = Number(f.cuotaIVA || 0).toFixed(2);
    document.getElementById('mfc-re').value = Number(f.recargoEquivalencia || 0).toFixed(2);
    document.getElementById('mfc-total').value = Number(f.total || 0).toFixed(2);
    const arts = Array.isArray(f.articulos) ? f.articulos : [];
    document.getElementById('mfc-articulos-tbody').innerHTML = arts.length
      ? arts.map(a => {
        const varLabel = Array.isArray(a.variantes) && a.variantes.length > 1
          ? a.variantes.map(v => `${v.talla || 'Única'}/${v.color || 'Estándar'} (${v.cantidad || 0})`).join(', ')
          : `${a.talla || 'Única'} / ${a.color || 'Estándar'}`;
        const noStockBadge = a.afectaStock === false ? ' <span class="text-[10px] text-gray-400 font-normal">(sin stock)</span>' : '';
        return `<tr><td class="px-3 py-2 font-medium">${esc(a.descripcion || a.referencia || 'Artículo')}${noStockBadge}</td><td class="px-3 py-2 text-gray-500">${esc(varLabel)}</td><td class="px-3 py-2 text-center">${Number(a.cantidad || 0)}</td><td class="px-3 py-2 text-right">${fmtEur(a.precioUnitario)}</td></tr>`;
      }).join('')
      : '<tr><td colspan="4" class="py-4 text-center text-gray-400">Sin líneas detalladas.</td></tr>';
    document.getElementById('mfc-articulos-wrap')?.classList.remove('hidden');
    document.getElementById('mfc-delete')?.classList.remove('hidden');
    syncModalFacEstadoBanner(f);
    const saveBtn = document.getElementById('mfc-save');
    if (saveBtn) saveBtn.textContent = 'Guardar cambios';
    document.getElementById('modal-factura-compra').classList.remove('hidden');
  }

  function deleteFacModal(id) {
    const modal = document.getElementById('modal-pedido-confirm');
    document.getElementById('modal-pconf-title').textContent = 'Eliminar factura de compra';
    document.getElementById('modal-pconf-desc').textContent = 'Se eliminará este registro de compra (el stock actual no se modificará).';
    document.getElementById('modal-pconf-label').textContent = 'Escribe ELIMINAR para confirmar:';
    const inp = document.getElementById('modal-pconf-input'); inp.value = '';
    modal.classList.remove('hidden');
    document.getElementById('modal-pconf-ok').onclick = async () => {
      if (inp.value.trim().toUpperCase() !== 'ELIMINAR') return showToast('Escribe ELIMINAR exactamente', 'warning');
      modal.classList.add('hidden');
      await db.facturas_compra.delete(id);
      document.getElementById('modal-factura-compra').classList.add('hidden');
      showToast('Factura de compra eliminada', 'success');
      await refreshActive();
    };
  }

  async function refreshActive() {
    if (activeTab === 'facturas') return renderFacturas();
    const fichaEl = document.getElementById('prov-subview-ficha');
    if (fichaEl && !fichaEl.classList.contains('hidden') && currentProvId) return openFicha(currentProvId);
    return renderList();
  }

  function init() {
    document.querySelectorAll('.prov-tab-btn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.provTab)));
    document.getElementById('btn-nuevo-proveedor').addEventListener('click', () => openModal(null));
    document.getElementById('prov-search').addEventListener('input', renderList);
    document.querySelectorAll('[data-sort-prov]').forEach(b => b.addEventListener('click', () => {
      const col = b.dataset.sortProv;
      if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortBy = col; sortDir = 'asc'; }
      renderList();
    }));

    document.getElementById('prov-tbody').addEventListener('click', e => {
      const bDel = e.target.closest('[data-prov-del]'); if (bDel) return deleteProveedor(Number(bDel.dataset.provDel));
      const bEdit = e.target.closest('[data-prov-edit]'); if (bEdit) return openModal(Number(bEdit.dataset.provEdit));
      const bOpen = e.target.closest('[data-prov-open]'); if (bOpen) openFicha(Number(bOpen.dataset.provOpen));
    });

    document.getElementById('prov-ficha-volver').addEventListener('click', () => {
      document.getElementById('prov-subview-ficha').classList.add('hidden');
      document.getElementById('prov-subview-lista').classList.remove('hidden');
      renderList();
    });
    document.getElementById('prov-ficha-editar').addEventListener('click', () => openModal(currentProvId));
    document.getElementById('prov-ficha-eliminar').addEventListener('click', () => deleteProveedor(currentProvId));
    document.getElementById('pf-save-notas').addEventListener('click', async () => {
      if (!currentProvId) return;
      await db.proveedores.update(currentProvId, { notas: document.getElementById('pf-notas').value.trim() });
      showToast('Notas del proveedor guardadas', 'success');
    });
    document.getElementById('pf-facturas-tbody').addEventListener('click', e => {
      const bRec = e.target.closest('[data-fc-recibir]'); if (bRec) return marcarFacturaRecibida(Number(bRec.dataset.fcRecibir));
      const r = e.target.closest('[data-fc-open]');
      if (r) openFacModal(Number(r.dataset.fcOpen));
    });
    document.getElementById('pf-articulos-list').addEventListener('click', e => {
      const b = e.target.closest('[data-open-prov-art]');
      if (b) { navigateTo('stock'); StockModule.openArticuloModal(Number(b.dataset.openProvArt)); }
    });

    // Modal Proveedor
    const closeProvM = () => document.getElementById('modal-ajustes-proveedor').classList.add('hidden');
    document.getElementById('mprov-close').addEventListener('click', closeProvM);
    document.getElementById('mprov-cancel')?.addEventListener('click', closeProvM);
    document.getElementById('mprov-save').addEventListener('click', async () => {
      const nombre = document.getElementById('mprov-nombre').value.trim();
      if (!nombre) return showToast('El nombre del proveedor es obligatorio', 'warning');
      const d = {
        nombre,
        CIF: document.getElementById('mprov-cif').value.trim(),
        telefono: document.getElementById('mprov-tel').value.trim(),
        email: document.getElementById('mprov-email').value.trim(),
        notas: document.getElementById('mprov-notas').value.trim()
      };
      if (editProvId) await db.proveedores.update(editProvId, d);
      else await db.proveedores.add({ ...d, fechaCreacion: new Date().toISOString() });
      closeProvM();
      showToast('Proveedor guardado', 'success');
      await refreshActive();
    });

    // Pestaña y modal Facturas de compra
    document.getElementById('btn-nueva-faccomp')?.addEventListener('click', () => openFacModal(null));
    document.getElementById('faccomp-search')?.addEventListener('input', renderFacturas);
    document.getElementById('faccomp-filter-estado')?.addEventListener('change', renderFacturas);
    document.getElementById('faccomp-desde')?.addEventListener('change', renderFacturas);
    document.getElementById('faccomp-hasta')?.addEventListener('change', renderFacturas);
    document.getElementById('faccomp-tbody')?.addEventListener('click', e => {
      const bRec = e.target.closest('[data-fc-recibir]'); if (bRec) return marcarFacturaRecibida(Number(bRec.dataset.fcRecibir));
      const bDel = e.target.closest('[data-fc-del]'); if (bDel) return deleteFacModal(Number(bDel.dataset.fcDel));
      const bOpen = e.target.closest('[data-fc-open]'); if (bOpen) openFacModal(Number(bOpen.dataset.fcOpen));
    });
    ['mfc-base', 'mfc-iva', 'mfc-re'].forEach(fid => document.getElementById(fid)?.addEventListener('input', () => {
      const s = Number(document.getElementById('mfc-base').value || 0) + Number(document.getElementById('mfc-iva').value || 0) + Number(document.getElementById('mfc-re').value || 0);
      document.getElementById('mfc-total').value = s.toFixed(2);
    }));
    document.getElementById('mfc-calc-imp')?.addEventListener('click', () => {
      const base = round2(document.getElementById('mfc-base').value || 0);
      const iva = round2(base * 0.21);
      const re = round2(base * 0.052);
      document.getElementById('mfc-iva').value = iva.toFixed(2);
      document.getElementById('mfc-re').value = re.toFixed(2);
      document.getElementById('mfc-total').value = (base + iva + re).toFixed(2);
    });
    document.getElementById('mfc-estado')?.addEventListener('change', async () => {
      const f = curFacCompId ? await db.facturas_compra.get(curFacCompId) : null;
      syncModalFacEstadoBanner(f);
    });
    document.getElementById('mfc-btn-recibir-ahora')?.addEventListener('click', async () => {
      if (!curFacCompId) return;
      document.getElementById('modal-factura-compra').classList.add('hidden');
      await marcarFacturaRecibida(curFacCompId);
    });
    document.getElementById('mfc-close')?.addEventListener('click', () => document.getElementById('modal-factura-compra').classList.add('hidden'));
    document.getElementById('mfc-cancel')?.addEventListener('click', () => document.getElementById('modal-factura-compra').classList.add('hidden'));
    document.getElementById('mfc-delete')?.addEventListener('click', () => curFacCompId && deleteFacModal(curFacCompId));
    document.getElementById('mfc-save')?.addEventListener('click', async () => {
      const num = document.getElementById('mfc-numero').value.trim();
      if (!num) return showToast('Introduce el número de factura', 'warning');
      const nombreProv = document.getElementById('mfc-proveedor').value.trim() || 'Proveedor';
      const fecha = document.getElementById('mfc-fecha').value || new Date().toISOString().slice(0, 10);
      const nuevoEstado = document.getElementById('mfc-estado')?.value === 'pendiente_recibir' ? 'pendiente_recibir' : 'recibido';
      const movNowIso = new Date().toISOString();
      const payload = {
        nombreProveedor: nombreProv,
        fecha,
        numeroFactura: num,
        baseImponible: round2(document.getElementById('mfc-base').value),
        cuotaIVA: round2(document.getElementById('mfc-iva').value),
        recargoEquivalencia: round2(document.getElementById('mfc-re').value),
        total: round2(document.getElementById('mfc-total').value),
        estado: nuevoEstado
      };

      let stockMsg = '';
      await db.transaction('rw', [db.proveedores, db.facturas_compra, db.articulos, db.variantes, db.categorias, db.movimientos_stock], async () => {
        const allProvs = await db.proveedores.toArray();
        const matchedProv = allProvs.find(p => (p.nombre || '').trim().toLowerCase() === nombreProv.toLowerCase());
        if (curFacCompId) {
          const prev = await db.facturas_compra.get(curFacCompId);
          const arts = Array.isArray(prev?.articulos) ? prev.articulos : [];
          const hasStockLines = arts.some(a => a.afectaStock !== false && !a._skipStock);
          const prevAplicado = Boolean(prev?.stockAplicado);
          if (matchedProv) payload.proveedorId = matchedProv.id;

          if (nuevoEstado === 'recibido' && !prevAplicado) {
            if (hasStockLines) {
              const st = await aplicarStockFacturaCompra({
                articulos: arts,
                provId: payload.proveedorId || prev?.proveedorId || null,
                provNom: nombreProv,
                numFac: num,
                movNowIso
              });
              if (st.unidadesSumadas > 0) stockMsg = ` · +${st.unidadesSumadas} ud(s) al stock`;
              payload.stockAplicado = true;
            } else {
              payload.stockAplicado = false;
            }
            payload.fechaRecepcion = prev?.fechaRecepcion || movNowIso;
          } else if (nuevoEstado === 'pendiente_recibir' && prevAplicado) {
            if (hasStockLines) {
              const rev = await revertirStockFacturaCompra({
                articulos: arts,
                provNom: nombreProv,
                numFac: num,
                movNowIso
              });
              if (rev.unidadesRevertidas > 0) stockMsg = ` · -${rev.unidadesRevertidas} ud(s) revertidas de stock`;
            }
            payload.stockAplicado = false;
            payload.fechaRecepcion = null;
          }
          await db.facturas_compra.update(curFacCompId, payload);
        } else {
          const provId = matchedProv
            ? matchedProv.id
            : await db.proveedores.add({ nombre: nombreProv, CIF: '', telefono: '', email: '', notas: '', fechaCreacion: movNowIso });
          await db.facturas_compra.add({
            ...payload,
            proveedorId: provId,
            fechaRecepcion: nuevoEstado === 'recibido' ? movNowIso : null,
            stockAplicado: false,
            articulos: []
          });
        }
      });

      document.getElementById('modal-factura-compra').classList.add('hidden');
      showToast((curFacCompId ? 'Factura de compra actualizada' : 'Factura de compra registrada') + stockMsg, 'success');
      if (stockMsg) {
        await StockModule.refresh();
        await recalcularAlertasStock(false);
      }
      await refreshActive();
    });
  }

  function onEnterView() {
    document.getElementById('prov-subview-ficha').classList.add('hidden');
    document.getElementById('prov-subview-lista').classList.remove('hidden');
    setTab(activeTab);
  }

  return { init, onEnterView, openFicha, refreshActive };
})();

window.openProveedorFicha = (id) => {
  navigateTo('proveedores');
  ProveedoresModule.openFicha(id);
};

// ==================== 7. MÓDULO PEDIDOS ====================
const PedidosModule = (() => {
  const ESTADOS_META = {
    pendiente_pago: { label: 'Pendiente pago', cls: 'bg-gray-100 text-gray-700 border border-gray-200' },
    pagado:         { label: 'Pagado',         cls: 'bg-orange-100 text-orange-800 border border-orange-200' },
    enviado:        { label: 'Enviado',        cls: 'bg-blue-100 text-blue-800 border border-blue-200' },
    completado:     { label: 'Completado',     cls: 'bg-green-100 text-green-800 border border-green-200' },
    cancelado:      { label: 'Cancelado',      cls: 'bg-red-100 text-red-700 border border-red-200' }
  };
  const METODO_LABELS = { bizum: 'Bizum', transferencia: 'Transferencia', efectivo: 'Efectivo' };

  const state = {
    pedidos: [], lineasByPedido: new Map(), page: 1, perPage: 10, sortBy: 'fecha', sortDir: 'desc',
    activeTab: 'todos', expandedBolsas: new Set(), bolsasSearch: '',
    filters: { search: '', estado: '', metodo: '', desde: '', hasta: '' },
    currentPedidoId: null, returnToClienteId: null, currentWhatsAppMsg: '',
    wizStep: 1, wizCliente: null, wizLineas: [], wizSelectedArt: null, wizActiveBolsa: null,
    wizCatalogo: [], wizVariantesMap: new Map(), wizCreatedPedidoId: null,
    pagoPedidoId: null, pagoMethod: null, detSelectedArt: null,
    cerrarBolsaKey: null, bolsaPayMethod: null
  };

  function isPedidoEnBolsaActiva(p) {
    return Boolean(p && p.enBolsa && (p.estado === 'pendiente_pago' || p.estado === 'pagado'));
  }

  function getBolsaKey(p) {
    if (p?.bolsaId) return String(p.bolsaId);
    if (p?.clienteId) return `cli_${p.clienteId}`;
    return `ped_${p?.id}`;
  }

  function buildBolsasAbiertas(pedsList = state.pedidos, lMap = state.lineasByPedido) {
    const groups = new Map();
    for (const p of pedsList) {
      if (!isPedidoEnBolsaActiva(p)) continue;
      const key = getBolsaKey(p);
      if (!groups.has(key)) groups.set(key, []);
      const ls = p.lineas || lMap.get(p.id) || [];
      const total = typeof p.total === 'number' ? p.total : calcPedidoTotales(p, ls).totalNeto;
      groups.get(key).push({ ...p, lineas: ls, total });
    }
    const result = [];
    for (const [key, arr] of groups.entries()) {
      const pedidos = [...arr].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      const firstFecha = pedidos[0].fecha;
      const lastFecha = pedidos[pedidos.length - 1].fecha;
      const diasAbierta = Math.max(0, Math.floor((Date.now() - new Date(firstFecha).getTime()) / 86400000));
      let totalArticulos = 0;
      let porteInfo = '';
      for (const ped of pedidos) {
        if (!porteInfo && Number(ped.gastosEnvio || 0) > 0) porteInfo = `Envío (${fmtEur(ped.gastosEnvio)})`;
        for (const l of ped.lineas || []) {
          if (l.descripcionVariante === 'Portes') {
            if (!porteInfo) porteInfo = `${l.nombreArticulo || 'Portes'} (${fmtEur(Number(l.cantidad || 1) * Number(l.precioUnitario || 0))})`;
          } else if (Number(l.precioUnitario || 0) >= 0) {
            totalArticulos += Math.max(0, Number(l.cantidad || 0));
          }
        }
      }
      const totalImporte = round2(pedidos.reduce((s, x) => s + Number(x.total || 0), 0));
      const pagadoImporte = round2(pedidos.filter(x => x.estado === 'pagado').reduce((s, x) => s + Number(x.total || 0), 0));
      const pendienteImporte = round2(pedidos.filter(x => x.estado === 'pendiente_pago').reduce((s, x) => s + Number(x.total || 0), 0));
      const pendientes = pedidos.filter(x => x.estado === 'pendiente_pago');
      const pendienteEditable = pendientes.length ? pendientes[pendientes.length - 1] : null;
      result.push({
        key,
        bolsaId: pedidos.find(x => x.bolsaId)?.bolsaId || null,
        clienteId: pedidos.find(x => x.clienteId)?.clienteId || null,
        nombreCliente: pedidos.find(x => x.nombreCliente)?.nombreCliente || 'Sin cliente',
        telefonoCliente: pedidos.find(x => x.telefonoCliente)?.telefonoCliente || '',
        pedidos,
        firstFecha,
        lastFecha,
        diasAbierta,
        totalArticulos,
        totalImporte,
        pagadoImporte,
        pendienteImporte,
        hasPorte: Boolean(porteInfo),
        porteInfo,
        pendienteEditable
      });
    }
    return result.sort((a, b) => new Date(b.lastFecha) - new Date(a.lastFecha));
  }

  function updateBolsasBadge() {
    const bolsas = buildBolsasAbiertas();
    const badge = document.getElementById('pedidos-bolsas-badge');
    if (badge) {
      badge.textContent = String(bolsas.length);
      badge.className = bolsas.length
        ? 'px-1.5 py-0.5 text-[11px] rounded-full bg-amber-100 text-amber-900 font-bold'
        : 'px-1.5 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 font-bold';
    }
    return bolsas;
  }

  async function autoCompletarPedidosEnviados() {
    try {
      const enviados = await db.pedidos.where('estado').equals('enviado').toArray();
      const ahora = Date.now();
      const DIEZ = 10 * 24 * 60 * 60 * 1000;
      const aComp = enviados.filter(p => p.fechaEnvio && (ahora - new Date(p.fechaEnvio).getTime()) > DIEZ);
      if (!aComp.length) return 0;
      const fechaIso = new Date().toISOString();
      await db.transaction('rw', db.pedidos, async () => {
        for (const p of aComp) {
          const hist = Array.isArray(p.historialEstados) ? [...p.historialEstados] : [];
          hist.push({ estado: 'completado', fecha: fechaIso, nota: 'Completado automáticamente tras 10 días desde el envío' });
          await db.pedidos.update(p.id, { estado: 'completado', fechaCompletado: fechaIso, historialEstados: hist });
        }
      });
      showToast(`${aComp.length} pedido(s) enviado(s) pasaron automáticamente a Completado`, 'success');
      return aComp.length;
    } catch { return 0; }
  }

  function showSubview(name) {
    ['lista', 'wizard', 'detalle'].forEach(v => document.getElementById(`pedidos-subview-${v}`).classList.toggle('hidden', v !== name));
  }

  function setPedTab(tab) {
    state.activeTab = tab === 'bolsas' ? 'bolsas' : 'todos';
    document.querySelectorAll('.ped-tab-btn').forEach(btn => {
      const act = btn.dataset.pedTab === state.activeTab;
      btn.className = act
        ? 'ped-tab-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] cursor-pointer'
        : 'ped-tab-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 cursor-pointer';
    });
    document.getElementById('pedidos-todos-panel')?.classList.toggle('hidden', state.activeTab !== 'todos');
    document.getElementById('pedidos-bolsas-panel')?.classList.toggle('hidden', state.activeTab !== 'bolsas');
    if (state.activeTab === 'bolsas') renderBolsas();
    else renderListado();
  }

  async function loadListado() {
    const emp = await db.empresa.get(1);
    state.perPage = Number(emp?.pedidosPorPagina) || 10;
    const [peds, lineas] = await Promise.all([db.pedidos.toArray(), db.lineasPedido.toArray()]);
    const mapa = new Map();
    lineas.forEach(l => { if (!mapa.has(l.pedidoId)) mapa.set(l.pedidoId, []); mapa.get(l.pedidoId).push(l); });
    state.lineasByPedido = mapa;
    state.pedidos = peds.map(p => {
      const ls = mapa.get(p.id) || [];
      const tots = calcPedidoTotales(p, ls);
      return {
        ...p,
        lineas: ls,
        total: tots.totalNeto,
        resumen: ls.length ? ls.map(l => `${l.cantidad}× ${l.nombreArticulo}`).join(', ') : 'Sin artículos'
      };
    });
    updateBolsasBadge();
    renderListado();
    if (state.activeTab === 'bolsas') renderBolsas();
  }

  function renderListado() {
    const { search, estado, metodo, desde, hasta } = state.filters;
    const q = search.trim().toLowerCase();
    const lista = state.pedidos.filter(p => {
      if (estado && p.estado !== estado) return false;
      if (metodo && p.metodoPago !== metodo) return false;
      if (desde && (p.fecha || '').slice(0, 10) < desde) return false;
      if (hasta && (p.fecha || '').slice(0, 10) > hasta) return false;
      if (q) {
        const fl = fmtFecha(p.fecha).toLowerCase();
        const t1 = p.total.toFixed(2), t2 = t1.replace('.', ',');
        if (!(p.numero || '').toLowerCase().includes(q) && !(p.nombreCliente || '').toLowerCase().includes(q) && !fl.includes(q) && !t1.includes(q) && !t2.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const m = state.sortDir === 'asc' ? 1 : -1;
      return state.sortBy === 'total' ? (a.total - b.total) * m : (new Date(a.fecha) - new Date(b.fecha)) * m;
    });

    const totalPages = Math.max(1, Math.ceil(lista.length / state.perPage));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.perPage;
    const pageItems = lista.slice(start, start + state.perPage);

    const tbody = document.getElementById('pedidos-tbody');
    document.getElementById('pedidos-empty').classList.toggle('hidden', pageItems.length > 0);
    tbody.innerHTML = pageItems.map(p => {
      const est = ESTADOS_META[p.estado] || ESTADOS_META.pendiente_pago;
      const enBolsaAct = isPedidoEnBolsaActiva(p);
      const qBtn = p.estado === 'pendiente_pago' ? `<button type="button" data-action="quick-pay" data-id="${p.id}" class="px-2 py-1 text-xs rounded-lg bg-orange-50 text-orange-700 border border-orange-200 cursor-pointer">Pagar</button>`
        : p.estado === 'pagado' ? `<button type="button" data-action="quick-send" data-id="${p.id}" class="px-2 py-1 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 cursor-pointer">Enviar</button>`
        : p.estado === 'enviado' ? `<button type="button" data-action="quick-complete" data-id="${p.id}" class="px-2 py-1 text-xs rounded-lg bg-green-50 text-green-700 border border-green-200 cursor-pointer">Completar</button>` : '';
      return `
        <tr class="hover:bg-gray-50">
          <td class="px-4 py-3 font-bold"><button type="button" data-action="ver" data-id="${p.id}" class="hover:text-[#727D6E] hover:underline cursor-pointer">${esc(p.numero)}</button></td>
          <td class="px-4 py-3"><div class="font-medium text-gray-800">${esc(p.nombreCliente || 'Sin cliente')}</div>${p.telefonoCliente ? `<div class="text-xs text-gray-400">${esc(p.telefonoCliente)}</div>` : ''}</td>
          <td class="px-4 py-3 text-gray-600 whitespace-nowrap">${fmtFecha(p.fecha)}</td>
          <td class="px-4 py-3 text-gray-600 max-w-xs truncate">${esc(p.resumen)}</td>
          <td class="px-4 py-3 text-right font-semibold whitespace-nowrap">${fmtEur(p.total)}</td>
          <td class="px-4 py-3 whitespace-nowrap"><span class="px-2.5 py-1 rounded-lg text-xs font-semibold ${est.cls}">${est.label}</span>${enBolsaAct ? '<span class="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">🛍️ Bolsa</span>' : ''}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap"><div class="inline-flex gap-1.5">${qBtn}<button type="button" data-action="ver" data-id="${p.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 bg-white cursor-pointer">Ver</button><button type="button" data-action="eliminar" data-id="${p.id}" class="px-2 py-1 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 cursor-pointer">✕</button></div></td>
        </tr>`;
    }).join('');
    document.getElementById('pedidos-page-info').textContent = lista.length ? `Mostrando ${start + 1}–${Math.min(start + state.perPage, lista.length)} de ${lista.length}` : '0 pedidos';
    document.getElementById('pedidos-page-num').textContent = `Página ${state.page} de ${totalPages}`;
    document.getElementById('pedidos-prev-page').disabled = state.page <= 1;
    document.getElementById('pedidos-next-page').disabled = state.page >= totalPages;
  }

  function buildBolsaWhatsAppResumen(b, porteExtra = null) {
    const nombre = (b.nombreCliente || '').trim() || 'hola';
    const lines = [`¡Hola ${nombre}! 😊 Aquí tienes el resumen completo de tu bolsa acumulada en *babyluc*:`, ''];
    for (const p of b.pedidos) {
      lines.push(`*${p.numero}* (${fmtFecha(p.fecha)} · ${ESTADOS_META[p.estado]?.label || p.estado}):`);
      for (const l of p.lineas || []) {
        const lt = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
        lines.push(`• ${l.cantidad}× ${l.nombreArticulo}${l.descripcionVariante ? ` (${l.descripcionVariante})` : ''} — ${fmtEur(lt)}`);
      }
      if (Number(p.descuentoValor || 0) > 0) lines.push(`• Descuento pedido: -${p.descuentoTipo === 'pct' ? `${p.descuentoValor}%` : fmtEur(p.descuentoValor)}`);
      if (Number(p.gastosEnvio || 0) > 0) lines.push(`• Envío pedido: ${fmtEur(p.gastosEnvio)}`);
    }
    if (porteExtra && porteExtra.nombre) {
      lines.push(`• 1× ${porteExtra.nombre} (Portes) — ${fmtEur(porteExtra.precio)}`);
    }
    const extraP = porteExtra ? Number(porteExtra.precio || 0) : 0;
    const tot = round2(b.totalImporte + extraP);
    const pend = round2(b.pendienteImporte + extraP);
    lines.push('', `*Total acumulado: ${fmtEur(tot)}*`);
    if (b.pagadoImporte > 0) lines.push(`Ya pagado: ${fmtEur(b.pagadoImporte)}`);
    if (pend > 0) lines.push(`*Pendiente de pago: ${fmtEur(pend)}*`);
    lines.push('¡Avísanos cuando quieras que te hagamos el envío! 💕');
    return lines.join('\n');
  }

  function renderBolsas() {
    const allBolsas = updateBolsasBadge();
    const q = (state.bolsasSearch || '').trim().toLowerCase();
    const bolsas = q ? allBolsas.filter(b => {
      if ((b.nombreCliente || '').toLowerCase().includes(q) || (b.telefonoCliente || '').toLowerCase().includes(q)) return true;
      return b.pedidos.some(p => (p.numero || '').toLowerCase().includes(q) || (p.lineas || []).some(l => (l.nombreArticulo || '').toLowerCase().includes(q)));
    }) : allBolsas;

    const listEl = document.getElementById('pedidos-bolsas-list');
    const emptyEl = document.getElementById('pedidos-bolsas-empty');
    if (!listEl || !emptyEl) return;
    emptyEl.classList.toggle('hidden', bolsas.length > 0);
    if (!bolsas.length) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = bolsas.map(b => {
      const isExp = state.expandedBolsas.has(b.key);
      const waUrl = buildWhatsAppUrl(b.telefonoCliente, buildBolsaWhatsAppResumen(b));
      const idsAttr = b.pedidos.map(x => x.id).join(',');
      return `
        <div class="bg-white border ${isExp ? 'border-[#727D6E] shadow-sm' : 'border-gray-200 shadow-xs'} rounded-2xl overflow-hidden transition">
          <div data-bolsa-toggle="${esc(b.key)}" class="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/70 select-none">
            <div class="space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#F5F7F4] border border-[#B6BEB2] text-gray-700 text-xs font-bold">${isExp ? '▾' : '▸'}</span>
                <h3 class="text-base font-bold text-gray-900">${esc(b.nombreCliente)}</h3>
                ${b.telefonoCliente ? `<span class="text-xs text-gray-500">${esc(b.telefonoCliente)}</span>` : ''}
                ${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" data-bolsa-stop="1" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 text-[11px] font-semibold">💬 WhatsApp</a>` : ''}
              </div>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold pl-8">
                <span class="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">${b.pedidos.length} pedido(s)</span>
                <span class="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">${b.totalArticulos} art.</span>
                <span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">Abierta ${b.diasAbierta === 0 ? 'hoy' : `hace ${b.diasAbierta} d.`}</span>
                <span class="px-2 py-0.5 rounded-md ${b.hasPorte ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">${b.hasPorte ? `🚚 ${esc(b.porteInfo)}` : '⚠️ Sin porte aún'}</span>
                ${b.pagadoImporte > 0 ? `<span class="px-2 py-0.5 rounded-md bg-orange-50 text-orange-800 border border-orange-200">Pagado: ${fmtEur(b.pagadoImporte)}</span>` : ''}
                ${b.pendienteImporte > 0 ? `<span class="px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200">Pendiente: ${fmtEur(b.pendienteImporte)}</span>` : ''}
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-between lg:justify-end gap-3 pl-8 lg:pl-0">
              <div class="text-left lg:text-right">
                <p class="text-[11px] uppercase font-semibold text-gray-400">Total bolsa</p>
                <p class="text-xl font-bold text-gray-900">${fmtEur(b.totalImporte)}</p>
              </div>
              <div class="flex flex-wrap gap-1.5" data-bolsa-stop="1">
                ${b.clienteId ? `<button type="button" data-bolsa-add="${b.clienteId}" class="px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer">+ Añadir</button>` : ''}
                <button type="button" data-bolsa-alb="${idsAttr}" class="px-3 py-1.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer">📄 Albarán</button>
                <button type="button" data-bolsa-close="${esc(b.key)}" class="px-3.5 py-1.5 rounded-xl bg-[#B6BEB2] hover:bg-[#A3ADA0] text-gray-900 text-xs font-bold cursor-pointer">📦 Cerrar y enviar</button>
              </div>
            </div>
          </div>
          ${isExp ? `
            <div class="border-t border-gray-200 bg-gray-50/70 p-4 sm:p-5 space-y-3">
              ${b.pedidos.map(p => {
                const est = ESTADOS_META[p.estado] || ESTADOS_META.pendiente_pago;
                const ls = p.lineas || [];
                const tots = calcPedidoTotales(p, ls);
                return `
                  <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div class="px-4 py-2.5 bg-gray-50/90 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div class="flex flex-wrap items-center gap-2">
                        <button type="button" data-bolsa-ver="${p.id}" class="font-bold text-sm text-[#727D6E] hover:underline cursor-pointer">${esc(p.numero)}</button>
                        <span class="text-gray-500">${fmtFechaHora(p.fecha)}</span>
                        <span class="px-2 py-0.5 rounded-md font-semibold ${est.cls}">${est.label}</span>
                        ${p.numeroFactura ? `<span class="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-medium">${esc(p.numeroFactura)}${p.metodoPago ? ` · ${esc(METODO_LABELS[p.metodoPago] || p.metodoPago)}` : ''}</span>` : ''}
                      </div>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="font-bold text-sm text-gray-900 mr-1">${fmtEur(p.total)}</span>
                        ${p.estado === 'pendiente_pago' ? `<button type="button" data-bolsa-pay-ped="${p.id}" class="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 font-semibold cursor-pointer">Pagar</button>` : ''}
                        <button type="button" data-bolsa-alb-ped="${p.id}" class="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium cursor-pointer">Albarán</button>
                        <button type="button" data-bolsa-ver="${p.id}" class="px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium cursor-pointer">Ver / Editar</button>
                        <button type="button" data-bolsa-remove-ped="${p.id}" class="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 font-medium cursor-pointer" title="Sacar este pedido de la bolsa">Sacar</button>
                      </div>
                    </div>
                    <div class="overflow-x-auto">
                      <table class="min-w-full divide-y divide-gray-100 text-xs">
                        <tbody class="divide-y divide-gray-100">
                          ${ls.length ? ls.map(l => {
                            const lt = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
                            const isDesc = Number(l.precioUnitario || 0) < 0 || String(l.descripcionVariante || '').startsWith('Descuento');
                            const isPorte = l.descripcionVariante === 'Portes';
                            return `
                              <tr class="${isDesc ? 'bg-emerald-50/30' : ''}">
                                <td class="px-4 py-2 font-medium ${isDesc ? 'text-emerald-800' : 'text-gray-800'}">${esc(l.nombreArticulo)}</td>
                                <td class="px-4 py-2 text-gray-500">${isPorte ? '<span class="px-1.5 py-0.5 rounded bg-[#EAEEE9] text-gray-800 font-medium">Portes</span>' : isDesc ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">${esc(l.descripcionVariante)}</span>` : esc(l.descripcionVariante || '—')}</td>
                                <td class="px-4 py-2 text-center text-gray-700">${l.cantidad} × ${fmtEur(l.precioUnitario)}</td>
                                <td class="px-4 py-2 text-right font-semibold ${lt < 0 ? 'text-emerald-700' : 'text-gray-900'}">${fmtEur(lt)}</td>
                              </tr>`;
                          }).join('') : '<tr><td colspan="4" class="px-4 py-2 text-gray-400">Sin líneas</td></tr>'}
                          ${tots.descuentoEur > 0 ? `<tr class="bg-emerald-50/30"><td colspan="3" class="px-4 py-1.5 text-emerald-700 font-medium">Descuento aplicado</td><td class="px-4 py-1.5 text-right text-emerald-700 font-semibold">-${fmtEur(tots.descuentoEur)}</td></tr>` : ''}
                          ${tots.envio > 0 ? `<tr><td colspan="3" class="px-4 py-1.5 text-gray-600">Gastos de envío</td><td class="px-4 py-1.5 text-right font-semibold">${fmtEur(tots.envio)}</td></tr>` : ''}
                        </tbody>
                      </table>
                    </div>
                    ${p.notas ? `<div class="px-4 py-2 bg-gray-50/50 border-t border-gray-100 text-[11px] text-gray-500">📝 ${esc(p.notas)}</div>` : ''}
                  </div>`;
              }).join('')}
            </div>` : ''}
        </div>`;
    }).join('');
  }

  async function populatePorteSelector(selectId, nombreId, precioId) {
    const sel = document.getElementById(selectId);
    const nom = document.getElementById(nombreId);
    const pre = document.getElementById(precioId);
    if (!sel || !nom || !pre) return;
    const emp = await db.empresa.get(1);
    const portes = Array.isArray(emp?.tiposPortes) ? emp.tiposPortes : [];
    sel.innerHTML = portes.map(pt => `<option value="${pt.id}" data-nombre="${esc(pt.nombre)}" data-precio="${Number(pt.precio || 0).toFixed(2)}">${esc(pt.nombre)} (${fmtEur(pt.precio)})</option>`).join('') +
      '<option value="">Porte personalizado...</option>';
    if (portes.length) {
      sel.value = String(portes[0].id);
      nom.value = portes[0].nombre || '';
      pre.value = Number(portes[0].precio || 0).toFixed(2);
    } else {
      sel.value = '';
      nom.value = 'Portes';
      pre.value = '';
    }
  }

  async function checkWizClienteBolsa() {
    const banner = document.getElementById('wiz-bolsa-banner');
    const infoEl = document.getElementById('wiz-bolsa-banner-info');
    const btnPend = document.getElementById('wiz-bolsa-btn-ir-pendiente');
    const chk = document.getElementById('wiz-dejar-en-bolsa');
    if (!state.wizCliente) {
      state.wizActiveBolsa = null;
      banner?.classList.add('hidden');
      if (chk) chk.checked = false;
      return;
    }
    if (!state.pedidos.length) await loadListado();
    const bolsas = buildBolsasAbiertas();
    const bag = bolsas.find(b => Number(b.clienteId) === Number(state.wizCliente.id)) || null;
    state.wizActiveBolsa = bag;
    if (bag && banner && infoEl) {
      infoEl.textContent = `${bag.pedidos.length} pedido(s) · ${bag.totalArticulos} artículo(s) · Total acumulado ${fmtEur(bag.totalImporte)}${bag.pendienteEditable ? ` (pendiente editable: ${bag.pendienteEditable.numero})` : ''}.`;
      banner.classList.remove('hidden');
      if (btnPend) {
        btnPend.classList.toggle('hidden', !bag.pendienteEditable);
        btnPend.dataset.pendId = bag.pendienteEditable ? String(bag.pendienteEditable.id) : '';
      }
      if (chk) chk.checked = true;
    } else {
      banner?.classList.add('hidden');
      if (chk) chk.checked = false;
    }
  }

  async function openWizard(opts = {}) {
    state.wizStep = 1; state.wizCliente = null; state.wizLineas = []; state.wizSelectedArt = null; state.wizCreatedPedidoId = null; state.wizActiveBolsa = null;
    const [arts, vars] = await Promise.all([db.articulos.toArray(), db.variantes.toArray()]);
    state.wizCatalogo = arts.filter(a => a.activo !== false);
    state.wizVariantesMap = new Map();
    vars.forEach(v => { if (!state.wizVariantesMap.has(v.articuloId)) state.wizVariantesMap.set(v.articuloId, []); state.wizVariantesMap.get(v.articuloId).push(v); });
    document.getElementById('wiz-cliente-search').value = '';
    document.getElementById('wiz-cliente-seleccionado').classList.add('hidden');
    document.getElementById('wiz-bolsa-banner')?.classList.add('hidden');
    const chk = document.getElementById('wiz-dejar-en-bolsa'); if (chk) chk.checked = false;
    document.getElementById('wiz-notas').value = '';
    document.getElementById('wiz-desc-nombre').value = 'Descuento';
    document.getElementById('wiz-desc-tipo').value = 'eur';
    document.getElementById('wiz-desc-valor').value = '';
    await populatePorteSelector('wiz-porte-select', 'wiz-porte-nombre', 'wiz-porte-precio');
    document.getElementById('wiz-confirm-body').classList.remove('hidden');
    document.getElementById('wiz-success-body').classList.add('hidden');
    resetWizArtInputs(); renderWizLineas(); setWizStep(1); showSubview('wizard');

    if (opts.clienteId) {
      const cli = await db.clientes.get(Number(opts.clienteId));
      if (cli) {
        state.wizCliente = cli;
        document.getElementById('wiz-cliente-sel-nombre').textContent = cli.nombre || cli.telefono;
        document.getElementById('wiz-cliente-sel-info').textContent = [cli.telefono, cli.email].filter(Boolean).join(' · ');
        document.getElementById('wiz-cliente-seleccionado').classList.remove('hidden');
        await checkWizClienteBolsa();
        if (opts.jumpStep2) setWizStep(2);
      }
    }
  }

  function updateWizTotalesLive() {
    const posSum = round2(state.wizLineas.reduce((acc, l) => {
      const sub = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
      return sub >= 0 ? acc + sub : acc;
    }, 0));
    const descSum = round2(state.wizLineas.reduce((acc, l) => {
      const sub = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
      return sub < 0 ? acc + Math.abs(sub) : acc;
    }, 0));
    const tots = calcPedidoTotales({}, state.wizLineas);
    document.getElementById('wiz-subtotal-live').textContent = fmtEur(posSum);
    document.getElementById('wiz-desc-live-row').classList.toggle('hidden', descSum <= 0);
    document.getElementById('wiz-desc-live').textContent = `-${fmtEur(descSum)}`;
    document.getElementById('wiz-total-live').textContent = fmtEur(tots.totalNeto);
  }

  function setWizStep(n) {
    state.wizStep = n;
    [1, 2, 3].forEach(i => {
      document.getElementById(`wiz-panel-${i}`).classList.toggle('hidden', i !== n);
      document.getElementById(`wiz-step-ind-${i}`).className = i === n ? 'py-2 px-3 rounded-xl bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] font-semibold'
        : i < n ? 'py-2 px-3 rounded-xl bg-green-50 text-green-700 border border-green-200' : 'py-2 px-3 rounded-xl bg-gray-50 text-gray-400 border border-gray-200';
    });
    if (n === 3) {
      const tots = calcPedidoTotales({}, state.wizLineas);
      const hintEl = document.getElementById('wiz-bolsa-hint');
      if (hintEl) {
        hintEl.textContent = state.wizActiveBolsa
          ? `Se unirá automáticamente a la bolsa abierta existente (${state.wizActiveBolsa.pedidos.length} pedido(s) previos).`
          : 'El pedido queda apartado en tienda sin enviar todavía hasta que la clienta pida el envío.';
      }
      document.getElementById('wiz-resumen-content').innerHTML = `
        <div class="p-4 rounded-xl bg-gray-50 border border-gray-200 flex justify-between">
          <div><p class="text-xs text-gray-400 uppercase font-semibold">Cliente</p><p class="font-bold">${esc(state.wizCliente.nombre)}</p></div>
          <div class="text-right"><p class="text-xs text-gray-400 uppercase font-semibold">Total</p><p class="text-xl font-bold">${fmtEur(tots.totalNeto)}</p></div>
        </div>
        <div class="text-xs text-gray-600 space-y-1">${state.wizLineas.map(l => {
          const lt = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
          return `<div class="${lt < 0 ? 'text-emerald-700 font-medium' : ''}">${l.cantidad}× ${esc(l.nombreArticulo)} (${esc(l.descripcionVariante || '—')}) — ${fmtEur(lt)}</div>`;
        }).join('')}</div>`;
    }
  }

  function resetWizArtInputs() {
    state.wizSelectedArt = null;
    document.getElementById('wiz-art-search').value = '';
    document.getElementById('wiz-art-dropdown').classList.add('hidden');
    const vs = document.getElementById('wiz-var-select');
    vs.innerHTML = '<option value="">Selecciona artículo</option>'; vs.disabled = true; vs.classList.remove('hidden');
    document.getElementById('wiz-nuevo-var-box').classList.add('hidden');
    document.getElementById('wiz-art-cantidad').value = 1;
    document.getElementById('wiz-art-precio').value = '';
    document.getElementById('wiz-stock-warning').textContent = '';
  }

  function renderWizLineas() {
    const tbody = document.getElementById('wiz-lineas-tbody');
    document.getElementById('wiz-lineas-empty').classList.toggle('hidden', state.wizLineas.length > 0);
    tbody.innerHTML = state.wizLineas.map(l => {
      const lt = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
      const isDesc = Number(l.precioUnitario || 0) < 0 || String(l.descripcionVariante || '').startsWith('Descuento');
      const isPorte = l.descripcionVariante === 'Portes';
      return `
      <tr class="${isDesc ? 'bg-emerald-50/40' : ''}">
        <td class="px-3 py-2">
          <div class="flex items-center gap-1.5">
            <input type="text" data-wiz-nombre="${l.tempId}" value="${esc(l.nombreArticulo)}" class="w-full min-w-[140px] px-2 py-1 text-xs font-medium border border-gray-200 rounded-lg bg-white ${isDesc ? 'text-emerald-800' : ''}" />
            ${l.esNuevo ? '<span class="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded shrink-0">Nuevo</span>' : ''}
          </div>
        </td>
        <td class="px-3 py-2 text-xs">
          ${isDesc ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">${esc(l.descripcionVariante)}</span>`
            : isPorte ? `<span class="px-1.5 py-0.5 rounded bg-[#EAEEE9] text-gray-800 font-medium">Portes</span>`
            : `<span class="text-gray-500">${esc(l.descripcionVariante)}</span>`}
        </td>
        <td class="px-3 py-2 text-center">
          <input type="number" min="1" data-wiz-cant="${l.tempId}" value="${l.cantidad}" class="w-16 text-center px-1.5 py-1 text-xs font-semibold border border-gray-200 rounded-lg bg-white" />
        </td>
        <td class="px-3 py-2 text-right">
          <input type="number" step="0.01" data-wiz-precio="${l.tempId}" value="${Number(l.precioUnitario || 0).toFixed(2)}" class="w-24 text-right px-2 py-1 text-xs font-medium border border-gray-200 rounded-lg bg-white ${isDesc ? 'text-emerald-700' : ''}" />
        </td>
        <td data-wiz-lt="${l.tempId}" class="px-3 py-2 text-right font-semibold ${lt < 0 ? 'text-emerald-700' : ''}">${fmtEur(lt)}</td>
        <td class="px-3 py-2 text-center"><button type="button" data-wiz-del="${l.tempId}" class="text-red-500 font-bold cursor-pointer">✕</button></td>
      </tr>`;
    }).join('');
    updateWizTotalesLive();
  }

  async function saveWizardPedido() {
    const nowIso = new Date().toISOString();
    const año = new Date().getFullYear();
    const añoC = String(año).slice(-2);
    const notas = document.getElementById('wiz-notas').value.trim();
    const dejarEnBolsa = Boolean(document.getElementById('wiz-dejar-en-bolsa')?.checked);
    const bolsaId = dejarEnBolsa
      ? (state.wizActiveBolsa?.bolsaId || `BOLSA-${state.wizCliente?.id || 'C'}-${Date.now()}`)
      : null;
    let newId = null, numGen = '';

    await db.transaction('rw', [db.empresa, db.pedidos, db.lineasPedido, db.articulos, db.variantes, db.movimientos_stock], async () => {
      const emp = (await db.empresa.get(1)) || { id: 1, ivaDefecto: 21 };
      const ult = emp.ultimoNumeroPedido || { año, numero: 0 };
      const sig = (ult.año === año ? Number(ult.numero || 0) : 0) + 1;
      numGen = `BLC-${añoC}${String(sig).padStart(4, '0')}`;
      await db.empresa.put({ ...emp, id: 1, ultimoNumeroPedido: { año, numero: sig } });

      newId = await db.pedidos.add({
        numero: numGen, clienteId: state.wizCliente.id, nombreCliente: state.wizCliente.nombre || '',
        telefonoCliente: state.wizCliente.telefono || '', fecha: nowIso, estado: 'pendiente_pago',
        enBolsa: dejarEnBolsa, bolsaId,
        metodoPago: null, numeroFactura: null, fechaPago: null, fechaEnvio: null, fechaCompletado: null,
        notas,
        descuentoTipo: null,
        descuentoValor: 0,
        gastosEnvio: 0,
        devoluciones: [],
        historialEstados: [{ estado: 'pendiente_pago', fecha: nowIso, nota: dejarEnBolsa ? 'Pedido creado y guardado en bolsa abierta' : 'Pedido creado' }]
      });

      for (const l of state.wizLineas) {
        let artId = l.articuloId, varId = l.varianteId;
        let stockRes = null;
        if (l.esNuevo) {
          stockRes = -Math.abs(l.cantidad);
          artId = await db.articulos.add({ nombre: l.nombreArticulo, aliases: [], categoriaId: null, proveedorId: null, precioCompra: 0, precioVenta: l.precioUnitario, tipoIVA: l.tipoIVA, umbralAlerta: null, activo: true, fechaCreacion: nowIso });
          varId = await db.variantes.add({ articuloId: artId, talla: l.talla, color: l.color, stock: stockRes });
        } else if (varId) {
          const v = await db.variantes.get(varId);
          if (v) {
            stockRes = Number(v.stock || 0) - l.cantidad;
            await db.variantes.update(varId, { stock: stockRes });
          }
        }
        await db.lineasPedido.add({ pedidoId: newId, articuloId: artId, varianteId: varId, nombreArticulo: l.nombreArticulo, descripcionVariante: l.descripcionVariante, cantidad: l.cantidad, precioUnitario: l.precioUnitario, tipoIVA: l.tipoIVA });
        if (artId || varId) {
          await registrarMovimientoStock({
            fecha: nowIso,
            articuloId: artId,
            varianteId: varId,
            nombreArticulo: l.nombreArticulo,
            descripcionVariante: l.descripcionVariante || '',
            tipo: 'venta',
            delta: -Math.abs(l.cantidad),
            stockResultante: stockRes,
            referencia: numGen,
            nota: state.wizCliente?.nombre || ''
          });
        }
      }
    });

    state.wizCreatedPedidoId = newId;
    document.getElementById('wiz-created-numero').textContent = numGen;
    const msgEl = document.getElementById('wiz-success-bolsa-msg');
    if (msgEl) {
      msgEl.textContent = dejarEnBolsa
        ? 'Stock descontado. Guardado en bolsa abierta (Pendiente de pago).'
        : 'Stock descontado y guardado como Pendiente de pago.';
    }
    document.getElementById('wiz-confirm-body').classList.add('hidden');
    document.getElementById('wiz-success-body').classList.remove('hidden');
    showToast(`Pedido ${numGen} creado${dejarEnBolsa ? ' en bolsa abierta' : ''}`, 'success');
    await recalcularAlertasStock(false);
    await loadListado();
  }

  function buildPedidoWhatsAppResumen(p, lineas, tots, shopName = 'babyluc') {
    const nombre = (p.nombreCliente || '').trim() || 'hola';
    const greetings = {
      pendiente_pago: `¡Hola ${nombre}! 😊 Te enviamos el resumen de tu pedido *${p.numero}* en *${shopName}*:`,
      pagado: `¡Hola ${nombre}! ✅ Confirmamos el pago de tu pedido *${p.numero}* en *${shopName}*:`,
      enviado: `¡Hola ${nombre}! 📦 ¡Tu pedido *${p.numero}* de *${shopName}* ya está en camino!`,
      completado: `¡Hola ${nombre}! 🎉 Tu pedido *${p.numero}* de *${shopName}* ha sido completado:`,
      cancelado: `Hola ${nombre}, tu pedido *${p.numero}* en *${shopName}* figura como cancelado:`
    };
    const rows = [
      greetings[p.estado] || greetings.pendiente_pago,
      '',
      ...(lineas || []).map(l => `• ${l.cantidad}× ${l.nombreArticulo}${l.descripcionVariante ? ` (${l.descripcionVariante})` : ''} — ${fmtEur(Number(l.cantidad || 0) * Number(l.precioUnitario || 0))}`)
    ];
    if (tots.descuentoEur > 0) rows.push(`Descuento: -${fmtEur(tots.descuentoEur)}`);
    if (tots.envio > 0) rows.push(`Gastos de envío: ${fmtEur(tots.envio)}`);
    if (tots.totalDevuelto > 0) rows.push(`Devoluciones: -${fmtEur(tots.totalDevuelto)}`);
    rows.push('', `*Total: ${fmtEur(tots.totalNeto)}*`, `¡Muchas gracias por confiar en ${shopName}! 💕`);
    return rows.join('\n');
  }

  async function openDetalle(id, opts = {}) {
    state.currentPedidoId = Number(id);
    state.returnToClienteId = opts.returnToClienteId || null;
    document.getElementById('det-btn-volver').textContent = state.returnToClienteId ? '← Volver a la ficha del cliente' : '← Volver a pedidos';
    await renderDetalle();
    showSubview('detalle');
  }

  async function renderDetalle() {
    const p = await db.pedidos.get(state.currentPedidoId);
    if (!p) return showSubview('lista');
    const [lineas, emp] = await Promise.all([
      db.lineasPedido.where('pedidoId').equals(p.id).toArray(),
      db.empresa.get(1)
    ]);
    const est = ESTADOS_META[p.estado] || ESTADOS_META.pendiente_pago;
    document.getElementById('det-numero').textContent = p.numero;
    const badge = document.getElementById('det-estado-badge');
    badge.textContent = est.label; badge.className = `px-2.5 py-1 rounded-lg text-xs font-semibold ${est.cls}`;
    let bolsaPill = document.getElementById('det-bolsa-pill');
    if (!bolsaPill && badge.parentElement) {
      bolsaPill = document.createElement('span');
      bolsaPill.id = 'det-bolsa-pill';
      badge.insertAdjacentElement('afterend', bolsaPill);
    }
    if (bolsaPill) {
      const enBolsaAct = isPedidoEnBolsaActiva(p);
      bolsaPill.className = enBolsaAct
        ? 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200'
        : 'hidden';
      bolsaPill.textContent = enBolsaAct ? '🛍️ En bolsa abierta' : '';
    }
    document.getElementById('det-fecha-sub').textContent = `Creado el ${fmtFechaHora(p.fecha)}`;

    const cliEl = document.getElementById('det-cliente-nombre');
    if (p.clienteId) {
      cliEl.innerHTML = `<button type="button" id="det-link-cli" class="hover:text-[#727D6E] hover:underline cursor-pointer">${esc(p.nombreCliente || 'Cliente')}</button>`;
      document.getElementById('det-link-cli').onclick = () => window.openClienteFicha(p.clienteId);
    } else cliEl.textContent = p.nombreCliente || 'Sin cliente';

    const cliObj = p.clienteId ? await db.clientes.get(p.clienteId) : null;
    const cliTel = p.telefonoCliente || cliObj?.telefono || '';
    document.getElementById('det-cliente-tel').textContent = cliTel || '—';
    const tots = calcPedidoTotales(p, lineas);
    const waMsg = buildPedidoWhatsAppResumen(p, lineas, tots, emp?.nombre || 'babyluc');
    state.currentWhatsAppMsg = waMsg;
    const waPedBtn = document.getElementById('det-btn-whatsapp');
    if (waPedBtn) {
      const waUrl = buildWhatsAppUrl(cliTel, waMsg);
      waPedBtn.classList.toggle('hidden', !waUrl);
      if (waUrl) waPedBtn.href = waUrl;
    }
    document.getElementById('det-metodo-pago').textContent = p.metodoPago ? (METODO_LABELS[p.metodoPago] || p.metodoPago) : '—';
    document.getElementById('det-numero-factura').textContent = p.numeroFactura || 'Sin factura emitida';
    document.getElementById('det-notas').value = p.notas || '';

    const autoInfo = document.getElementById('det-auto-info');
    if (p.estado === 'enviado' && p.fechaEnvio) {
      const rest = Math.max(0, 10 - Math.floor((Date.now() - new Date(p.fechaEnvio).getTime()) / 86400000));
      autoInfo.textContent = `ℹ Se completará automáticamente en ${rest} día(s).`;
      autoInfo.classList.remove('hidden');
    } else autoInfo.classList.add('hidden');

    const accEl = document.getElementById('det-acciones-estado');
    const bAlb = `<button type="button" data-doc="albaran" class="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium text-sm cursor-pointer">Albarán</button>`;
    const bFac = `<button type="button" data-doc="factura" class="px-3.5 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium text-sm cursor-pointer">Factura PDF</button>`;
    const enBolsaAct = isPedidoEnBolsaActiva(p);
    const bBolsa = (p.estado === 'pendiente_pago' || p.estado === 'pagado')
      ? (enBolsaAct
        ? `<button type="button" id="det-btn-cerrar-bolsa" class="px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 font-semibold text-sm cursor-pointer">📦 Cerrar bolsa</button> <button type="button" id="det-btn-sacar-bolsa" class="px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium cursor-pointer">Sacar de bolsa</button>`
        : `<button type="button" id="det-btn-meter-bolsa" class="px-3.5 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 font-semibold text-sm cursor-pointer">🛍️ Dejar en bolsa</button>`)
      : '';

    if (p.estado === 'pendiente_pago') {
      accEl.innerHTML = `<button type="button" id="det-btn-pagar" class="px-4 py-2 rounded-xl bg-[#B6BEB2] hover:bg-[#A3ADA0] text-gray-900 font-semibold text-sm cursor-pointer">Marcar como pagado</button> ${bBolsa} ${bAlb}`;
      document.getElementById('det-btn-pagar').onclick = () => { state.pagoPedidoId = p.id; state.pagoMethod = null; document.getElementById('modal-pedido-pago').classList.remove('hidden'); };
    } else if (p.estado === 'pagado') {
      accEl.innerHTML = `<button type="button" id="det-btn-enviar" class="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold text-sm cursor-pointer">Marcar como enviado</button> ${bBolsa} ${bAlb} ${bFac}`;
      document.getElementById('det-btn-enviar').onclick = () => cambiarEstadoSimple(p.id, 'enviado', 'Pedido marcado como enviado');
    } else if (p.estado === 'enviado') {
      accEl.innerHTML = `<button type="button" id="det-btn-comp" class="px-4 py-2 rounded-xl bg-green-600 text-white font-semibold text-sm cursor-pointer">Marcar como completado</button> ${bAlb} ${bFac}`;
      document.getElementById('det-btn-comp').onclick = () => cambiarEstadoSimple(p.id, 'completado', 'Pedido completado manualmente');
    } else if (p.estado === 'completado') {
      accEl.innerHTML = `${bAlb} ${bFac}`;
    } else accEl.innerHTML = '';

    document.getElementById('det-btn-cerrar-bolsa')?.addEventListener('click', () => openCerrarBolsaModal(getBolsaKey(p)));
    document.getElementById('det-btn-sacar-bolsa')?.addEventListener('click', async () => {
      await sacarPedidoDeBolsa(p.id);
    });
    document.getElementById('det-btn-meter-bolsa')?.addEventListener('click', async () => {
      await meterPedidoEnBolsa(p.id);
    });

    accEl.querySelectorAll('[data-doc="albaran"]').forEach(b => b.onclick = () => DocumentosModule.abrirAlbaran(p.id));
    accEl.querySelectorAll('[data-doc="factura"]').forEach(b => b.onclick = () => DocumentosModule.abrirFactura(p.id));
    document.getElementById('det-btn-cancelar-pedido').classList.toggle('hidden', p.estado === 'cancelado');

    const devMap = new Map();
    (p.devoluciones || []).forEach(d => (d.items || []).forEach(it => devMap.set(it.lineaId, (devMap.get(it.lineaId) || 0) + Number(it.cantidad || 0))));
    const puedeDevParcial = ['pagado', 'enviado', 'completado'].includes(p.estado) && lineas.some(l => Number(l.precioUnitario || 0) > 0 && l.descripcionVariante !== 'Portes' && (Number(l.cantidad || 0) - (devMap.get(l.id) || 0)) > 0);
    const devParcialBtn = document.getElementById('det-btn-devolucion-parcial');
    if (devParcialBtn) devParcialBtn.classList.toggle('hidden', !puedeDevParcial);

    const edit = p.estado === 'pendiente_pago';
    document.getElementById('det-add-articulo-box').classList.toggle('hidden', !edit);
    document.getElementById('det-col-quitar-th').classList.toggle('hidden', !edit);
    document.getElementById('det-edit-hint').textContent = edit ? 'Edición activa (precios y líneas editables)' : 'Solo lectura';
    const impEdit = document.getElementById('det-importes-edit');
    const tieneImportesLegacy = Number(p.descuentoValor || 0) > 0 || Number(p.gastosEnvio || 0) > 0;
    if (impEdit) {
      impEdit.classList.toggle('hidden', !(edit && tieneImportesLegacy));
      if (edit && tieneImportesLegacy) {
        document.getElementById('det-desc-tipo').value = p.descuentoTipo === 'pct' ? 'pct' : 'eur';
        document.getElementById('det-desc-valor').value = p.descuentoValor ? Number(p.descuentoValor) : '';
        document.getElementById('det-envio').value = p.gastosEnvio ? Number(p.gastosEnvio) : '';
      }
    }
    if (edit) {
      const [arts, vars] = await Promise.all([db.articulos.toArray(), db.variantes.toArray()]);
      state.wizCatalogo = arts.filter(a => a.activo !== false);
      state.wizVariantesMap = new Map();
      vars.forEach(v => { if (!state.wizVariantesMap.has(v.articuloId)) state.wizVariantesMap.set(v.articuloId, []); state.wizVariantesMap.get(v.articuloId).push(v); });
      state.detSelectedArt = null;
      const dSearch = document.getElementById('det-add-search'); if (dSearch) dSearch.value = '';
      const dPrice = document.getElementById('det-add-precio'); if (dPrice) dPrice.value = '';
      const dCant = document.getElementById('det-add-cantidad'); if (dCant) dCant.value = 1;
      const dVar = document.getElementById('det-add-variante'); if (dVar) { dVar.innerHTML = '<option value="">Variante</option>'; dVar.disabled = true; }
      const dDescN = document.getElementById('det-add-desc-nombre'); if (dDescN) dDescN.value = 'Descuento';
      const dDescV = document.getElementById('det-add-desc-valor'); if (dDescV) dDescV.value = '';
      await populatePorteSelector('det-porte-select', 'det-porte-nombre', 'det-porte-precio');
    }

    document.getElementById('det-lineas-tbody').innerHTML = lineas.map(l => {
      const devCant = devMap.get(l.id) || 0;
      const lt = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
      const isDesc = Number(l.precioUnitario || 0) < 0 || String(l.descripcionVariante || '').startsWith('Descuento');
      const isPorte = l.descripcionVariante === 'Portes';
      const varBadge = isDesc
        ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs font-medium">${esc(l.descripcionVariante)}</span>`
        : isPorte
          ? `<span class="px-1.5 py-0.5 rounded bg-[#EAEEE9] text-gray-800 text-xs font-medium">Portes</span>`
          : `<span class="text-gray-500">${esc(l.descripcionVariante)}</span>`;
      if (edit) {
        return `
        <tr class="${isDesc ? 'bg-emerald-50/40' : ''}">
          <td class="px-4 py-2">
            <input type="text" data-det-nombre="${l.id}" value="${esc(l.nombreArticulo)}" class="w-full min-w-[140px] px-2 py-1 text-xs font-medium border border-gray-200 rounded-lg bg-white ${isDesc ? 'text-emerald-800' : ''}" />
          </td>
          <td class="px-4 py-2">${varBadge}</td>
          <td class="px-4 py-2 text-center">
            <input type="number" min="1" data-det-cant="${l.id}" value="${l.cantidad}" class="w-16 text-center px-1.5 py-1 text-xs font-semibold border border-gray-200 rounded-lg bg-white" />
          </td>
          <td class="px-4 py-2 text-right">
            <input type="number" step="0.01" data-det-precio="${l.id}" value="${Number(l.precioUnitario || 0).toFixed(2)}" class="w-24 text-right px-2 py-1 text-xs font-medium border border-gray-200 rounded-lg bg-white ${isDesc ? 'text-emerald-700' : ''}" />
          </td>
          <td class="px-4 py-2 text-right font-semibold ${lt < 0 ? 'text-emerald-700' : ''}">${fmtEur(lt)}</td>
          <td class="px-3 py-2 text-center"><button type="button" data-det-del="${l.id}" class="text-red-500 font-bold cursor-pointer">✕</button></td>
        </tr>`;
      }
      return `
      <tr class="${isDesc ? 'bg-emerald-50/30' : ''}">
        <td class="px-4 py-2.5 font-medium ${isDesc ? 'text-emerald-800' : ''}">${esc(l.nombreArticulo)}${devCant > 0 ? `<span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">-${devCant} dev.</span>` : ''}</td>
        <td class="px-4 py-2.5">${varBadge}</td>
        <td class="px-4 py-2.5 text-center font-semibold">${l.cantidad}</td>
        <td class="px-4 py-2.5 text-right ${isDesc ? 'text-emerald-700' : ''}">${fmtEur(l.precioUnitario)}</td>
        <td class="px-4 py-2.5 text-right font-semibold ${lt < 0 ? 'text-emerald-700' : ''}">${fmtEur(lt)}</td>
      </tr>`;
    }).join('');

    const posLineas = round2(lineas.reduce((acc, l) => {
      const s = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
      return s >= 0 ? acc + s : acc;
    }, 0));
    const descLineas = round2(lineas.reduce((acc, l) => {
      const s = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
      return s < 0 ? acc + Math.abs(s) : acc;
    }, 0));
    const extraBox = document.getElementById('det-desglose-extra');
    if (extraBox) {
      const rows = [];
      if (descLineas > 0 && tots.descuentoEur === 0 && tots.envio === 0) {
        rows.push(`<div class="flex justify-between"><span>Artículos y portes</span><span>${fmtEur(posLineas)}</span></div>`);
        rows.push(`<div class="flex justify-between text-emerald-700 font-medium"><span>Descuentos aplicados</span><span>-${fmtEur(descLineas)}</span></div>`);
      } else if (tots.descuentoEur > 0 || tots.envio > 0 || tots.totalDevuelto > 0) {
        rows.push(`<div class="flex justify-between"><span>Subtotal artículos</span><span>${fmtEur(tots.brutoLineas)}</span></div>`);
      }
      if (tots.descuentoEur > 0) {
        rows.push(`<div class="flex justify-between text-emerald-700"><span>Descuento${tots.descTipo === 'pct' ? ` (${tots.descVal}%)` : ''}</span><span>-${fmtEur(tots.descuentoEur)}</span></div>`);
      }
      if (tots.envio > 0) {
        rows.push(`<div class="flex justify-between"><span>Gastos de envío</span><span>${fmtEur(tots.envio)}</span></div>`);
      }
      if (tots.totalDevuelto > 0) {
        rows.push(`<div class="flex justify-between text-red-700 font-medium"><span>Devoluciones parciales</span><span>-${fmtEur(tots.totalDevuelto)}</span></div>`);
      }
      extraBox.innerHTML = rows.join('');
    }
    document.getElementById('det-total').textContent = fmtEur(tots.totalNeto);

    const devBox = document.getElementById('det-devoluciones-box');
    const devs = Array.isArray(p.devoluciones) ? p.devoluciones : [];
    if (devBox) {
      devBox.classList.toggle('hidden', devs.length === 0);
      if (devs.length) {
        document.getElementById('det-devoluciones-total').textContent = `-${fmtEur(tots.totalDevuelto)}`;
        document.getElementById('det-devoluciones-list').innerHTML = devs.map(d => `
          <div class="p-3 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="font-semibold text-gray-900">${fmtFechaHora(d.fecha)} · <span class="text-red-700">-${fmtEur(d.totalDevuelto)}</span></div>
              <div class="text-gray-600">${(d.items || []).map(it => `${it.cantidad}× ${esc(it.nombreArticulo)} (${esc(it.descripcionVariante || '')})`).join(', ')}${d.nota ? ` · <em>${esc(d.nota)}</em>` : ''}</div>
            </div>
            ${d.numeroRectificativa ? `<button type="button" data-doc-rect="${d.id}" class="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-semibold cursor-pointer whitespace-nowrap">📄 ${esc(d.numeroRectificativa)}</button>` : ''}
          </div>`).join('');
        document.querySelectorAll('[data-doc-rect]').forEach(b => b.onclick = () => DocumentosModule.abrirRectificativa(p.id, Number(b.dataset.docRect)));
      }
    }

    document.getElementById('det-historial-list').innerHTML = (p.historialEstados || []).map(h => `
      <li class="ml-4"><div class="absolute w-2.5 h-2.5 bg-[#B6BEB2] rounded-full -left-1.5 mt-1 border border-white"></div><p class="text-xs font-semibold">${esc(ESTADOS_META[h.estado]?.label || h.estado)}</p><p class="text-[11px] text-gray-400">${fmtFechaHora(h.fecha)}</p>${h.nota ? `<p class="text-xs text-gray-600">${esc(h.nota)}</p>` : ''}</li>
    `).join('');
  }

  async function confirmarPago() {
    if (!state.pagoMethod) return showToast('Elige un método de pago', 'warning');
    const p = await db.pedidos.get(state.pagoPedidoId);
    if (!p) return;
    const nowIso = new Date().toISOString();
    const año = new Date().getFullYear();
    let numFac = p.numeroFactura || null;
    await db.transaction('rw', [db.empresa, db.pedidos], async () => {
      if (!numFac) {
        const emp = (await db.empresa.get(1)) || { id: 1 };
        const ult = emp.ultimoNumeroFactura || { año, numero: 0 };
        const sig = (ult.año === año ? Number(ult.numero || 0) : 0) + 1;
        numFac = `FAC-${año}-${String(sig).padStart(4, '0')}`;
        await db.empresa.put({ ...emp, id: 1, ultimoNumeroFactura: { año, numero: sig } });
      }
      const hist = Array.isArray(p.historialEstados) ? [...p.historialEstados] : [];
      hist.push({ estado: 'pagado', fecha: nowIso, nota: `Pago (${METODO_LABELS[state.pagoMethod]}) · Factura ${numFac}` });
      await db.pedidos.update(p.id, { estado: 'pagado', metodoPago: state.pagoMethod, fechaPago: nowIso, numeroFactura: numFac, historialEstados: hist });
    });
    document.getElementById('modal-pedido-pago').classList.add('hidden');
    showToast(`Pagado · Factura ${numFac}`, 'success');
    await loadListado();
    if (state.currentPedidoId === p.id) await renderDetalle();
  }

  async function cambiarEstadoSimple(id, est, nota) {
    const p = await db.pedidos.get(id); if (!p) return;
    const nowIso = new Date().toISOString();
    const hist = [...(p.historialEstados || []), { estado: est, fecha: nowIso, nota }];
    const patch = { estado: est, historialEstados: hist };
    if (est === 'enviado') patch.fechaEnvio = nowIso;
    if (est === 'completado') patch.fechaCompletado = nowIso;
    await db.pedidos.update(id, patch);
    showToast(`Pedido ${p.numero} actualizado`, 'success');
    await loadListado();
    if (state.currentPedidoId === id) await renderDetalle();
  }

  function cancelarPedido(id) {
    const modal = document.getElementById('modal-pedido-confirm');
    document.getElementById('modal-pconf-title').textContent = 'Cancelar pedido';
    document.getElementById('modal-pconf-desc').textContent = 'Pasará a Cancelado y se restaurará el stock de todas sus variantes.';
    document.getElementById('modal-pconf-label').textContent = 'Escribe CANCELAR para confirmar:';
    const inp = document.getElementById('modal-pconf-input'); inp.value = '';
    modal.classList.remove('hidden');
    document.getElementById('modal-pconf-ok').onclick = async () => {
      if (inp.value.trim().toUpperCase() !== 'CANCELAR') return showToast('Escribe CANCELAR exactamente', 'warning');
      modal.classList.add('hidden');
      const nowIso = new Date().toISOString();
      await db.transaction('rw', [db.pedidos, db.lineasPedido, db.variantes, db.movimientos_stock], async () => {
        const p = await db.pedidos.get(id);
        const ls = await db.lineasPedido.where('pedidoId').equals(id).toArray();
        for (const l of ls) {
          if (l.varianteId) {
            const v = await db.variantes.get(l.varianteId);
            if (v) {
              const qty = Number(l.cantidad || 0);
              const stockRes = Number(v.stock || 0) + qty;
              await db.variantes.update(v.id, { stock: stockRes });
              await registrarMovimientoStock({
                fecha: nowIso,
                articuloId: l.articuloId || null,
                varianteId: v.id,
                nombreArticulo: l.nombreArticulo,
                descripcionVariante: l.descripcionVariante || '',
                tipo: 'cancelacion',
                delta: qty,
                stockResultante: stockRes,
                referencia: p?.numero || '',
                nota: 'Pedido cancelado'
              });
            }
          }
        }
        await db.pedidos.update(id, { estado: 'cancelado', historialEstados: [...(p.historialEstados || []), { estado: 'cancelado', fecha: nowIso, nota: 'Cancelado y stock restaurado' }] });
      });
      showToast('Pedido cancelado y stock restaurado', 'success');
      await recalcularAlertasStock(false); await loadListado();
      if (state.currentPedidoId === id) await renderDetalle();
    };
  }

  function eliminarPedido(id) {
    const modal = document.getElementById('modal-pedido-confirm');
    document.getElementById('modal-pconf-title').textContent = 'Eliminar pedido';
    document.getElementById('modal-pconf-desc').textContent = 'Se eliminará definitivamente y restaurará stock si no estaba cancelado.';
    document.getElementById('modal-pconf-label').textContent = 'Escribe ELIMINAR para confirmar:';
    const inp = document.getElementById('modal-pconf-input'); inp.value = '';
    modal.classList.remove('hidden');
    document.getElementById('modal-pconf-ok').onclick = async () => {
      if (inp.value.trim().toUpperCase() !== 'ELIMINAR') return showToast('Escribe ELIMINAR exactamente', 'warning');
      modal.classList.add('hidden');
      const nowIso = new Date().toISOString();
      await db.transaction('rw', [db.pedidos, db.lineasPedido, db.variantes, db.movimientos_stock], async () => {
        const p = await db.pedidos.get(id);
        if (p && p.estado !== 'cancelado') {
          const ls = await db.lineasPedido.where('pedidoId').equals(id).toArray();
          for (const l of ls) {
            if (l.varianteId) {
              const v = await db.variantes.get(l.varianteId);
              if (v) {
                const qty = Number(l.cantidad || 0);
                const stockRes = Number(v.stock || 0) + qty;
                await db.variantes.update(v.id, { stock: stockRes });
                await registrarMovimientoStock({
                  fecha: nowIso,
                  articuloId: l.articuloId || null,
                  varianteId: v.id,
                  nombreArticulo: l.nombreArticulo,
                  descripcionVariante: l.descripcionVariante || '',
                  tipo: 'eliminacion_pedido',
                  delta: qty,
                  stockResultante: stockRes,
                  referencia: p.numero || '',
                  nota: 'Pedido eliminado'
                });
              }
            }
          }
        }
        await db.lineasPedido.where('pedidoId').equals(id).delete();
        await db.pedidos.delete(id);
      });
      showToast('Pedido eliminado', 'success');
      state.currentPedidoId = null; showSubview('lista');
      await recalcularAlertasStock(false); await loadListado();
    };
  }

  function bindEvents() {
    document.getElementById('det-btn-copy-wa')?.addEventListener('click', async () => {
      if (!state.currentWhatsAppMsg) return;
      const ok = await copyTextToClipboard(state.currentWhatsAppMsg);
      showToast(ok ? 'Resumen copiado para WhatsApp' : 'No se pudo copiar al portapapeles', ok ? 'success' : 'error');
    });
    document.getElementById('pedidos-search').addEventListener('input', e => { state.filters.search = e.target.value; state.page = 1; renderListado(); });
    document.getElementById('pedidos-filter-estado').addEventListener('change', e => { state.filters.estado = e.target.value; state.page = 1; renderListado(); });
    document.getElementById('pedidos-filter-metodo').addEventListener('change', e => { state.filters.metodo = e.target.value; state.page = 1; renderListado(); });
    document.getElementById('pedidos-filter-desde').addEventListener('change', e => { state.filters.desde = e.target.value; state.page = 1; renderListado(); });
    document.getElementById('pedidos-filter-hasta').addEventListener('change', e => { state.filters.hasta = e.target.value; state.page = 1; renderListado(); });
    document.getElementById('pedidos-filter-clear').addEventListener('click', () => {
      state.filters = { search: '', estado: '', metodo: '', desde: '', hasta: '' };
      ['pedidos-search', 'pedidos-filter-estado', 'pedidos-filter-metodo', 'pedidos-filter-desde', 'pedidos-filter-hasta'].forEach(id => document.getElementById(id).value = '');
      state.page = 1; renderListado();
    });
    document.querySelectorAll('[data-sort-pedido]').forEach(b => b.addEventListener('click', () => {
      const col = b.dataset.sortPedido;
      if (state.sortBy === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortBy = col; state.sortDir = 'desc'; }
      renderListado();
    }));
    document.getElementById('pedidos-prev-page').addEventListener('click', () => { if (state.page > 1) { state.page--; renderListado(); } });
    document.getElementById('pedidos-next-page').addEventListener('click', () => { state.page++; renderListado(); });

    document.getElementById('pedidos-tbody').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const id = Number(btn.dataset.id), act = btn.dataset.action;
      if (act === 'ver') openDetalle(id);
      else if (act === 'quick-pay') { state.pagoPedidoId = id; state.pagoMethod = null; document.getElementById('modal-pedido-pago').classList.remove('hidden'); }
      else if (act === 'quick-send') cambiarEstadoSimple(id, 'enviado', 'Pedido marcado como enviado');
      else if (act === 'quick-complete') cambiarEstadoSimple(id, 'completado', 'Pedido completado manualmente');
      else if (act === 'eliminar') eliminarPedido(id);
    });

    document.querySelectorAll('.ped-tab-btn').forEach(b => b.addEventListener('click', () => setPedTab(b.dataset.pedTab)));
    document.getElementById('pedidos-bolsas-search')?.addEventListener('input', e => { state.bolsasSearch = e.target.value; renderBolsas(); });
    document.getElementById('pedidos-bolsas-list')?.addEventListener('click', async e => {
      const btnAdd = e.target.closest('[data-bolsa-add]');
      if (btnAdd) { e.stopPropagation(); await openWizard({ clienteId: Number(btnAdd.dataset.bolsaAdd), jumpStep2: true }); return; }
      const btnAlb = e.target.closest('[data-bolsa-alb]');
      if (btnAlb) { e.stopPropagation(); const ids = btnAlb.dataset.bolsaAlb.split(',').map(Number).filter(Boolean); if (ids.length) DocumentosModule.abrirAlbaranBolsa(ids); return; }
      const btnClose = e.target.closest('[data-bolsa-close]');
      if (btnClose) { e.stopPropagation(); await openCerrarBolsaModal(btnClose.dataset.bolsaClose); return; }
      const btnVer = e.target.closest('[data-bolsa-ver]');
      if (btnVer) { e.stopPropagation(); await openDetalle(Number(btnVer.dataset.bolsaVer)); return; }
      const btnPayPed = e.target.closest('[data-bolsa-pay-ped]');
      if (btnPayPed) { e.stopPropagation(); state.pagoPedidoId = Number(btnPayPed.dataset.bolsaPayPed); state.pagoMethod = null; document.getElementById('modal-pedido-pago').classList.remove('hidden'); return; }
      const btnAlbPed = e.target.closest('[data-bolsa-alb-ped]');
      if (btnAlbPed) { e.stopPropagation(); DocumentosModule.abrirAlbaran(Number(btnAlbPed.dataset.bolsaAlbPed)); return; }
      const btnRemPed = e.target.closest('[data-bolsa-remove-ped]');
      if (btnRemPed) { e.stopPropagation(); await sacarPedidoDeBolsa(Number(btnRemPed.dataset.bolsaRemovePed)); return; }
      if (e.target.closest('[data-bolsa-stop]')) return;
      const cardHead = e.target.closest('[data-bolsa-toggle]');
      if (cardHead) {
        const key = cardHead.dataset.bolsaToggle;
        if (state.expandedBolsas.has(key)) state.expandedBolsas.delete(key);
        else state.expandedBolsas.add(key);
        renderBolsas();
      }
    });

    document.getElementById('btn-nuevo-pedido').addEventListener('click', () => openWizard());
    document.getElementById('btn-wizard-cancelar').addEventListener('click', () => showSubview('lista'));

    // Wizard Paso 1
    const cs = document.getElementById('wiz-cliente-search');
    const searchCli = async (q) => {
      const dd = document.getElementById('wiz-cliente-dropdown');
      const all = await db.clientes.toArray();
      const lq = q.trim().toLowerCase();
      const m = (lq ? all.filter(c => (c.nombre || '').toLowerCase().includes(lq) || (c.telefono || '').toLowerCase().includes(lq)) : all).slice(0, 8);
      dd.innerHTML = m.length ? m.map(c => `<button type="button" data-wcli="${c.id}" class="w-full text-left px-4 py-2 hover:bg-[#F5F7F4] text-sm cursor-pointer"><strong>${esc(c.nombre)}</strong> <span class="text-xs text-gray-500">${esc(c.telefono)}</span></button>`).join('')
        : '<div class="p-3 text-xs text-gray-400">Sin resultados. Pulsa "+ Nuevo cliente".</div>';
      dd.classList.remove('hidden');
    };
    cs.addEventListener('input', e => searchCli(e.target.value));
    cs.addEventListener('focus', e => searchCli(e.target.value));
    document.getElementById('wiz-cliente-dropdown').addEventListener('click', async e => {
      const b = e.target.closest('[data-wcli]'); if (!b) return;
      const c = await db.clientes.get(Number(b.dataset.wcli));
      if (c) {
        state.wizCliente = c;
        document.getElementById('wiz-cliente-dropdown').classList.add('hidden');
        document.getElementById('wiz-cliente-sel-nombre').textContent = c.nombre || c.telefono;
        document.getElementById('wiz-cliente-sel-info').textContent = [c.telefono, c.email].filter(Boolean).join(' · ');
        document.getElementById('wiz-cliente-seleccionado').classList.remove('hidden');
        await checkWizClienteBolsa();
      }
    });
    document.getElementById('wiz-cliente-quitar').addEventListener('click', () => {
      state.wizCliente = null; state.wizActiveBolsa = null;
      document.getElementById('wiz-cliente-seleccionado').classList.add('hidden');
      document.getElementById('wiz-bolsa-banner')?.classList.add('hidden');
      const chk = document.getElementById('wiz-dejar-en-bolsa'); if (chk) chk.checked = false;
    });
    document.getElementById('wiz-bolsa-btn-ir-pendiente')?.addEventListener('click', async e => {
      const pid = Number(e.currentTarget.dataset.pendId || 0);
      if (pid) await openDetalle(pid);
    });
    document.getElementById('wiz-btn-nuevo-cliente').addEventListener('click', () => window.openClienteModal({
      onSaved: async (c) => {
        state.wizCliente = c;
        document.getElementById('wiz-cliente-sel-nombre').textContent = c.nombre || c.telefono;
        document.getElementById('wiz-cliente-sel-info').textContent = [c.telefono, c.email].filter(Boolean).join(' · ');
        document.getElementById('wiz-cliente-seleccionado').classList.remove('hidden');
        await checkWizClienteBolsa();
      }
    }));
    document.getElementById('wiz-next-1').addEventListener('click', () => { if (!state.wizCliente) return showToast('Selecciona un cliente', 'warning'); setWizStep(2); });

    // Wizard Paso 2
    const as = document.getElementById('wiz-art-search');
    as.addEventListener('input', e => {
      state.wizSelectedArt = null;
      const q = e.target.value.trim().toLowerCase();
      const dd = document.getElementById('wiz-art-dropdown');
      if (!q) { dd.classList.add('hidden'); return; }
      const m = state.wizCatalogo.filter(a => (a.nombre || '').toLowerCase().includes(q) || (a.codigo || '').toLowerCase().includes(q) || (a.aliases || []).some(al => (al || '').toLowerCase().includes(q))).slice(0, 8);
      dd.innerHTML = m.map(a => `<button type="button" data-wart="${a.id}" class="w-full text-left px-3 py-2 hover:bg-[#F5F7F4] text-sm cursor-pointer"><strong>${esc(a.nombre)}</strong>${a.codigo ? ` <span class="text-xs font-mono text-gray-400">[${esc(a.codigo)}]</span>` : ''} · ${fmtEur(a.precioVenta)}</button>`).join('') +
        `<button type="button" data-wart-new="1" class="w-full text-left px-3 py-2 bg-amber-50 text-amber-800 text-xs font-semibold cursor-pointer">+ Añadir "${esc(e.target.value.trim())}" como nuevo (stock negativo)</button>`;
      dd.classList.remove('hidden');
    });
    document.getElementById('wiz-art-dropdown').addEventListener('click', e => {
      const ba = e.target.closest('[data-wart]');
      if (ba) {
        const a = state.wizCatalogo.find(x => x.id === Number(ba.dataset.wart));
        state.wizSelectedArt = { esNuevo: false, art: a };
        as.value = a.nombre;
        document.getElementById('wiz-art-dropdown').classList.add('hidden');
        document.getElementById('wiz-art-precio').value = Number(a.precioVenta || 0).toFixed(2);
        const vs = document.getElementById('wiz-var-select'); vs.classList.remove('hidden');
        document.getElementById('wiz-nuevo-var-box').classList.add('hidden');
        const vars = state.wizVariantesMap.get(a.id) || [];
        vs.innerHTML = vars.map(v => `<option value="${v.id}" data-stock="${v.stock}">${esc(v.talla)} / ${esc(v.color)} (Stock: ${v.stock})</option>`).join('');
        vs.disabled = !vars.length;
      } else if (e.target.closest('[data-wart-new]')) {
        state.wizSelectedArt = { esNuevo: true, nombre: as.value.trim() };
        document.getElementById('wiz-art-dropdown').classList.add('hidden');
        document.getElementById('wiz-var-select').classList.add('hidden');
        document.getElementById('wiz-nuevo-var-box').classList.remove('hidden');
      }
    });
    document.getElementById('wiz-btn-add-linea').addEventListener('click', async () => {
      const nom = as.value.trim();
      const cant = parseInt(document.getElementById('wiz-art-cantidad').value, 10);
      const precio = parseFloat(document.getElementById('wiz-art-precio').value);
      if (!nom || !cant || cant < 1 || Number.isNaN(precio)) return showToast('Completa artículo, cantidad y precio', 'warning');
      const emp = await db.empresa.get(1); const ivaDef = Number(emp?.ivaDefecto || 21);
      if (!state.wizSelectedArt) state.wizSelectedArt = { esNuevo: true, nombre: nom };
      if (state.wizSelectedArt.esNuevo) {
        const t = document.getElementById('wiz-nuevo-talla').value.trim() || 'Única';
        const c = document.getElementById('wiz-nuevo-color').value.trim() || 'Estándar';
        state.wizLineas.push({ tempId: Date.now() + Math.random(), esNuevo: true, articuloId: null, varianteId: null, nombreArticulo: state.wizSelectedArt.nombre, talla: t, color: c, descripcionVariante: `${t} / ${c}`, cantidad: cant, precioUnitario: precio, tipoIVA: ivaDef });
      } else {
        const vId = Number(document.getElementById('wiz-var-select').value);
        const a = state.wizSelectedArt.art;
        const v = (state.wizVariantesMap.get(a.id) || []).find(x => x.id === vId);
        if (!v) return showToast('Selecciona una variante', 'warning');
        state.wizLineas.push({ tempId: Date.now() + Math.random(), esNuevo: false, articuloId: a.id, varianteId: v.id, nombreArticulo: a.nombre, talla: v.talla, color: v.color, descripcionVariante: `${v.talla} / ${v.color}`, cantidad: cant, precioUnitario: precio, tipoIVA: Number(a.tipoIVA || ivaDef) });
      }
      resetWizArtInputs(); renderWizLineas();
    });
    document.getElementById('wiz-lineas-tbody').addEventListener('input', e => {
      const tidStr = e.target.dataset.wizNombre ?? e.target.dataset.wizCant ?? e.target.dataset.wizPrecio;
      if (tidStr === undefined) return;
      const tid = Number(tidStr);
      const l = state.wizLineas.find(x => x.tempId === tid);
      if (!l) return;
      if (e.target.dataset.wizNombre !== undefined) {
        l.nombreArticulo = e.target.value;
      } else if (e.target.dataset.wizCant !== undefined) {
        l.cantidad = Math.max(1, parseInt(e.target.value || '1', 10) || 1);
      } else if (e.target.dataset.wizPrecio !== undefined) {
        const val = parseFloat(e.target.value);
        if (!Number.isNaN(val)) l.precioUnitario = round2(val);
      }
      const ltEl = document.querySelector(`[data-wiz-lt="${tid}"]`);
      if (ltEl) {
        const lt = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
        ltEl.textContent = fmtEur(lt);
        ltEl.className = `px-3 py-2 text-right font-semibold ${lt < 0 ? 'text-emerald-700' : ''}`;
      }
      updateWizTotalesLive();
    });
    document.getElementById('wiz-lineas-tbody').addEventListener('change', e => {
      if (e.target.dataset.wizNombre !== undefined && !e.target.value.trim()) {
        const l = state.wizLineas.find(x => x.tempId === Number(e.target.dataset.wizNombre));
        if (l) { l.nombreArticulo = l.esDescuento ? 'Descuento' : 'Artículo'; e.target.value = l.nombreArticulo; }
      } else if (e.target.dataset.wizCant !== undefined || e.target.dataset.wizPrecio !== undefined) {
        renderWizLineas();
      }
    });
    document.getElementById('wiz-lineas-tbody').addEventListener('click', e => {
      const b = e.target.closest('[data-wiz-del]'); if (!b) return;
      state.wizLineas = state.wizLineas.filter(l => l.tempId !== Number(b.dataset.wizDel));
      renderWizLineas();
    });

    const bindPorteSync = (selectId, nombreId, precioId) => {
      document.getElementById(selectId)?.addEventListener('change', e => {
        const opt = e.target.selectedOptions[0];
        const nom = document.getElementById(nombreId);
        const pre = document.getElementById(precioId);
        if (!opt || !nom || !pre) return;
        if (opt.value) {
          nom.value = opt.dataset.nombre || '';
          pre.value = opt.dataset.precio || '0.00';
        } else {
          nom.value = '';
          pre.value = '';
          nom.focus();
        }
      });
    };
    bindPorteSync('wiz-porte-select', 'wiz-porte-nombre', 'wiz-porte-precio');
    bindPorteSync('det-porte-select', 'det-porte-nombre', 'det-porte-precio');

    document.getElementById('wiz-btn-ir-portes')?.addEventListener('click', () => navigateTo('ajustes'));
    document.getElementById('wiz-btn-add-porte')?.addEventListener('click', async () => {
      const nom = (document.getElementById('wiz-porte-nombre')?.value || '').trim();
      const precio = parseFloat(document.getElementById('wiz-porte-precio')?.value || '');
      if (!nom || Number.isNaN(precio) || precio < 0) return showToast('Indica el concepto y el precio del porte', 'warning');
      const emp = await db.empresa.get(1); const ivaDef = Number(emp?.ivaDefecto || 21);
      state.wizLineas.push({ tempId: Date.now() + Math.random(), esNuevo: false, esPorte: true, articuloId: null, varianteId: null, nombreArticulo: nom, talla: '', color: '', descripcionVariante: 'Portes', cantidad: 1, precioUnitario: round2(precio), tipoIVA: ivaDef });
      renderWizLineas();
      showToast('Porte añadido al pedido', 'success');
    });
    document.getElementById('wiz-btn-add-desc')?.addEventListener('click', async () => {
      const nom = (document.getElementById('wiz-desc-nombre')?.value || '').trim() || 'Descuento';
      const tipo = document.getElementById('wiz-desc-tipo')?.value === 'pct' ? 'pct' : 'eur';
      const val = parseFloat(document.getElementById('wiz-desc-valor')?.value || '');
      if (Number.isNaN(val) || val <= 0) return showToast('Indica un importe o porcentaje de descuento válido', 'warning');
      let monto = round2(val);
      if (tipo === 'pct') {
        const posSum = state.wizLineas.reduce((acc, l) => {
          const s = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
          return s > 0 ? acc + s : acc;
        }, 0);
        if (posSum <= 0) return showToast('Añade primero algún artículo para calcular el porcentaje', 'warning');
        monto = round2(posSum * (Math.min(100, val) / 100));
      }
      const emp = await db.empresa.get(1); const ivaDef = Number(emp?.ivaDefecto || 21);
      state.wizLineas.push({ tempId: Date.now() + Math.random(), esNuevo: false, esDescuento: true, articuloId: null, varianteId: null, nombreArticulo: nom, talla: '', color: '', descripcionVariante: tipo === 'pct' ? `Descuento (${val}%)` : 'Descuento', cantidad: 1, precioUnitario: -monto, tipoIVA: ivaDef });
      document.getElementById('wiz-desc-nombre').value = 'Descuento';
      document.getElementById('wiz-desc-valor').value = '';
      renderWizLineas();
      showToast('Descuento añadido como artículo', 'success');
    });

    document.getElementById('wiz-back-2').addEventListener('click', () => setWizStep(1));
    document.getElementById('wiz-next-2').addEventListener('click', () => { if (!state.wizLineas.length) return showToast('Añade al menos un artículo', 'warning'); setWizStep(3); });
    document.getElementById('wiz-back-3').addEventListener('click', () => setWizStep(2));
    document.getElementById('wiz-guardar-final').addEventListener('click', saveWizardPedido);
    document.getElementById('wiz-btn-ver-creado').addEventListener('click', () => openDetalle(state.wizCreatedPedidoId));
    document.getElementById('wiz-btn-albaran-creado').addEventListener('click', () => DocumentosModule.abrirAlbaran(state.wizCreatedPedidoId));
    document.getElementById('wiz-btn-volver-lista').addEventListener('click', async () => { showSubview('lista'); await loadListado(); });

    // Detalle
    document.getElementById('det-btn-volver').addEventListener('click', async () => {
      if (state.returnToClienteId) { const cid = state.returnToClienteId; state.returnToClienteId = null; window.openClienteFicha(cid); return; }
      showSubview('lista'); await loadListado();
    });
    document.getElementById('det-btn-save-notas').addEventListener('click', async () => {
      await db.pedidos.update(state.currentPedidoId, { notas: document.getElementById('det-notas').value.trim() });
      showToast('Notas guardadas', 'success');
    });
    document.getElementById('det-btn-save-importes')?.addEventListener('click', async () => {
      const descTipo = document.getElementById('det-desc-tipo').value === 'pct' ? 'pct' : 'eur';
      const descVal = Math.max(0, Number(document.getElementById('det-desc-valor').value || 0));
      const envio = Math.max(0, Number(document.getElementById('det-envio').value || 0));
      await db.pedidos.update(state.currentPedidoId, {
        descuentoTipo: descVal > 0 ? descTipo : null,
        descuentoValor: descVal > 0 ? round2(descVal) : 0,
        gastosEnvio: envio > 0 ? round2(envio) : 0
      });
      showToast('Descuento y envío actualizados', 'success');
      await renderDetalle(); await loadListado();
    });

    // Devolución parcial
    let devLinesDraft = [];
    const calcDevModalTotal = () => {
      const sum = devLinesDraft.reduce((acc, it) => acc + it.devolver * it.unitRefund, 0);
      document.getElementById('mdev-total').textContent = fmtEur(round2(sum));
    };
    document.getElementById('det-btn-devolucion-parcial')?.addEventListener('click', async () => {
      const [p, ls] = await Promise.all([db.pedidos.get(state.currentPedidoId), db.lineasPedido.where('pedidoId').equals(state.currentPedidoId).toArray()]);
      if (!p) return;
      const devMap = new Map();
      (p.devoluciones || []).forEach(d => (d.items || []).forEach(it => devMap.set(it.lineaId, (devMap.get(it.lineaId) || 0) + Number(it.cantidad || 0))));
      const pctDesc = p.descuentoTipo === 'pct' && Number(p.descuentoValor || 0) > 0 ? Math.min(100, Number(p.descuentoValor)) / 100 : 0;
      devLinesDraft = ls.filter(l => Number(l.precioUnitario || 0) > 0 && l.descripcionVariante !== 'Portes').map(l => {
        const disp = Math.max(0, Number(l.cantidad || 0) - (devMap.get(l.id) || 0));
        const unitRefund = round2(Number(l.precioUnitario || 0) * (1 - pctDesc));
        return { linea: l, disp, devolver: 0, unitRefund };
      }).filter(x => x.disp > 0);
      document.getElementById('mdev-lineas-tbody').innerHTML = devLinesDraft.map((x, idx) => `
        <tr>
          <td class="px-3 py-2 font-medium">${esc(x.linea.nombreArticulo)}<div class="text-[11px] text-gray-500">${esc(x.linea.descripcionVariante || '')}</div></td>
          <td class="px-3 py-2 text-center font-semibold">${x.disp}</td>
          <td class="px-3 py-2 text-right">${fmtEur(x.unitRefund)}</td>
          <td class="px-3 py-2 text-center"><input type="number" min="0" max="${x.disp}" value="0" data-dev-idx="${idx}" class="w-16 text-center px-2 py-1 border border-gray-300 rounded-lg" /></td>
        </tr>`).join('');
      document.getElementById('mdev-nota').value = '';
      document.getElementById('mdev-reponer-stock').checked = true;
      calcDevModalTotal();
      document.getElementById('modal-pedido-devolucion').classList.remove('hidden');
    });
    document.getElementById('mdev-lineas-tbody')?.addEventListener('input', e => {
      if (e.target.dataset.devIdx === undefined) return;
      const idx = Number(e.target.dataset.devIdx);
      const item = devLinesDraft[idx];
      if (!item) return;
      const v = Math.max(0, Math.min(item.disp, parseInt(e.target.value || '0', 10) || 0));
      item.devolver = v;
      if (Number(e.target.value) !== v) e.target.value = String(v);
      calcDevModalTotal();
    });
    document.getElementById('mdev-close')?.addEventListener('click', () => document.getElementById('modal-pedido-devolucion').classList.add('hidden'));
    document.getElementById('mdev-cancel')?.addEventListener('click', () => document.getElementById('modal-pedido-devolucion').classList.add('hidden'));
    document.getElementById('mdev-confirm')?.addEventListener('click', async () => {
      const sel = devLinesDraft.filter(x => x.devolver > 0);
      if (!sel.length) return showToast('Indica al menos 1 unidad a devolver', 'warning');
      const reponer = document.getElementById('mdev-reponer-stock').checked;
      const nota = document.getElementById('mdev-nota').value.trim();
      const nowIso = new Date().toISOString();
      const totalDevuelto = round2(sel.reduce((a, x) => a + x.devolver * x.unitRefund, 0));

      await db.transaction('rw', [db.pedidos, db.variantes, db.movimientos_stock], async () => {
        const p = await db.pedidos.get(state.currentPedidoId);
        if (!p) return;
        if (reponer) {
          for (const x of sel) {
            if (x.linea.varianteId) {
              const v = await db.variantes.get(x.linea.varianteId);
              if (v) {
                const stockRes = Number(v.stock || 0) + x.devolver;
                await db.variantes.update(v.id, { stock: stockRes });
                await registrarMovimientoStock({
                  fecha: nowIso,
                  articuloId: x.linea.articuloId || null,
                  varianteId: v.id,
                  nombreArticulo: x.linea.nombreArticulo,
                  descripcionVariante: x.linea.descripcionVariante || '',
                  tipo: 'devolucion',
                  delta: x.devolver,
                  stockResultante: stockRes,
                  referencia: p.numero || '',
                  nota: nota || 'Devolución parcial'
                });
              }
            }
          }
        }
        const prevDevs = Array.isArray(p.devoluciones) ? [...p.devoluciones] : [];
        const numRec = p.numeroFactura ? `REC-${p.numeroFactura}${prevDevs.length ? `-${prevDevs.length + 1}` : ''}` : null;
        prevDevs.push({
          id: Date.now(),
          fecha: nowIso,
          nota,
          reponerStock: reponer,
          totalDevuelto,
          numeroRectificativa: numRec,
          items: sel.map(x => ({
            lineaId: x.linea.id,
            articuloId: x.linea.articuloId || null,
            varianteId: x.linea.varianteId || null,
            nombreArticulo: x.linea.nombreArticulo,
            descripcionVariante: x.linea.descripcionVariante || '',
            cantidad: x.devolver,
            precioUnitario: x.unitRefund
          }))
        });
        const hist = Array.isArray(p.historialEstados) ? [...p.historialEstados] : [];
        hist.push({ estado: p.estado, fecha: nowIso, nota: `Devolución parcial (-${fmtEur(totalDevuelto)})${nota ? `: ${nota}` : ''}` });
        await db.pedidos.update(p.id, { devoluciones: prevDevs, historialEstados: hist });
      });

      document.getElementById('modal-pedido-devolucion').classList.add('hidden');
      showToast('Devolución registrada y stock actualizado', 'success');
      await recalcularAlertasStock(false); await renderDetalle(); await loadListado();
    });

    document.getElementById('det-btn-cancelar-pedido').addEventListener('click', () => cancelarPedido(state.currentPedidoId));
    document.getElementById('det-btn-eliminar-pedido').addEventListener('click', () => eliminarPedido(state.currentPedidoId));

    // Editar líneas en detalle (pendiente_pago)
    document.getElementById('det-add-search').addEventListener('input', e => {
      const dd = document.getElementById('det-add-dropdown');
      const q = e.target.value.trim().toLowerCase();
      state.detSelectedArt = null;
      if (!q) { dd.classList.add('hidden'); return; }
      const m = state.wizCatalogo.filter(a => (a.nombre || '').toLowerCase().includes(q) || (a.codigo || '').toLowerCase().includes(q) || (a.aliases || []).some(al => (al || '').toLowerCase().includes(q))).slice(0, 8);
      dd.innerHTML = m.map(a => `<button type="button" data-dart="${a.id}" class="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F5F7F4] cursor-pointer">${esc(a.nombre)}${a.codigo ? ` <span class="font-mono text-gray-400">[${esc(a.codigo)}]</span>` : ''} · ${fmtEur(a.precioVenta)}</button>`).join('');
      dd.classList.remove('hidden');
    });
    document.getElementById('det-add-dropdown').addEventListener('click', e => {
      const b = e.target.closest('[data-dart]'); if (!b) return;
      const a = state.wizCatalogo.find(x => x.id === Number(b.dataset.dart));
      state.detSelectedArt = a;
      document.getElementById('det-add-search').value = a.nombre;
      document.getElementById('det-add-dropdown').classList.add('hidden');
      const dPrice = document.getElementById('det-add-precio');
      if (dPrice) dPrice.value = Number(a.precioVenta || 0).toFixed(2);
      const sel = document.getElementById('det-add-variante');
      const vars = state.wizVariantesMap.get(a.id) || [];
      sel.innerHTML = vars.map(v => `<option value="${v.id}">${esc(v.talla)} / ${esc(v.color)} (${v.stock})</option>`).join('');
      sel.disabled = !vars.length;
    });
    document.getElementById('det-btn-confirm-add').addEventListener('click', async () => {
      if (!state.detSelectedArt) return;
      const vId = Number(document.getElementById('det-add-variante').value);
      const cant = parseInt(document.getElementById('det-add-cantidad').value, 10);
      if (!vId || !cant || cant < 1) return;
      const a = state.detSelectedArt;
      const rawPrecio = parseFloat(document.getElementById('det-add-precio')?.value || '');
      const precioUnit = Number.isNaN(rawPrecio) ? Number(a.precioVenta || 0) : round2(rawPrecio);
      const v = (state.wizVariantesMap.get(a.id) || []).find(x => x.id === vId);
      const nowIso = new Date().toISOString();
      await db.transaction('rw', [db.pedidos, db.lineasPedido, db.variantes, db.movimientos_stock], async () => {
        const p = await db.pedidos.get(state.currentPedidoId);
        const vb = await db.variantes.get(vId);
        const stockRes = vb ? Number(vb.stock || 0) - cant : null;
        if (vb) await db.variantes.update(vId, { stock: stockRes });
        const descVar = `${v.talla} / ${v.color}`;
        await db.lineasPedido.add({ pedidoId: state.currentPedidoId, articuloId: a.id, varianteId: vId, nombreArticulo: a.nombre, descripcionVariante: descVar, cantidad: cant, precioUnitario: precioUnit, tipoIVA: Number(a.tipoIVA || 21) });
        await registrarMovimientoStock({
          fecha: nowIso,
          articuloId: a.id,
          varianteId: vId,
          nombreArticulo: a.nombre,
          descripcionVariante: descVar,
          tipo: 'venta',
          delta: -cant,
          stockResultante: stockRes,
          referencia: p?.numero || '',
          nota: 'Añadido al pedido'
        });
      });
      await recalcularAlertasStock(false); await renderDetalle(); await loadListado();
    });
    document.getElementById('det-btn-add-porte')?.addEventListener('click', async () => {
      if (!state.currentPedidoId) return;
      const nom = (document.getElementById('det-porte-nombre')?.value || '').trim();
      const precio = parseFloat(document.getElementById('det-porte-precio')?.value || '');
      if (!nom || Number.isNaN(precio) || precio < 0) return showToast('Indica el concepto y el precio del porte', 'warning');
      const emp = await db.empresa.get(1);
      await db.lineasPedido.add({
        pedidoId: state.currentPedidoId,
        articuloId: null,
        varianteId: null,
        nombreArticulo: nom,
        descripcionVariante: 'Portes',
        cantidad: 1,
        precioUnitario: round2(precio),
        tipoIVA: Number(emp?.ivaDefecto || 21)
      });
      showToast('Porte añadido al pedido', 'success');
      await renderDetalle(); await loadListado();
    });
    document.getElementById('det-btn-add-desc')?.addEventListener('click', async () => {
      if (!state.currentPedidoId) return;
      const nom = (document.getElementById('det-add-desc-nombre')?.value || '').trim() || 'Descuento';
      const tipo = document.getElementById('det-add-desc-tipo')?.value === 'pct' ? 'pct' : 'eur';
      const val = parseFloat(document.getElementById('det-add-desc-valor')?.value || '');
      if (Number.isNaN(val) || val <= 0) return showToast('Indica un importe o porcentaje de descuento válido', 'warning');
      let monto = round2(val);
      if (tipo === 'pct') {
        const ls = await db.lineasPedido.where('pedidoId').equals(state.currentPedidoId).toArray();
        const posSum = ls.reduce((acc, l) => {
          const s = Number(l.cantidad || 0) * Number(l.precioUnitario || 0);
          return s > 0 ? acc + s : acc;
        }, 0);
        if (posSum <= 0) return showToast('El pedido no tiene importes positivos para calcular el %', 'warning');
        monto = round2(posSum * (Math.min(100, val) / 100));
      }
      const emp = await db.empresa.get(1);
      await db.lineasPedido.add({
        pedidoId: state.currentPedidoId,
        articuloId: null,
        varianteId: null,
        nombreArticulo: nom,
        descripcionVariante: tipo === 'pct' ? `Descuento (${val}%)` : 'Descuento',
        cantidad: 1,
        precioUnitario: -monto,
        tipoIVA: Number(emp?.ivaDefecto || 21)
      });
      showToast('Descuento aplicado como artículo', 'success');
      await renderDetalle(); await loadListado();
    });
    document.getElementById('det-lineas-tbody').addEventListener('change', async e => {
      const lIdStr = e.target.dataset.detNombre ?? e.target.dataset.detCant ?? e.target.dataset.detPrecio;
      if (lIdStr === undefined) return;
      const lId = Number(lIdStr);
      const l = await db.lineasPedido.get(lId);
      if (!l) return;
      if (e.target.dataset.detNombre !== undefined) {
        const nuevo = e.target.value.trim();
        if (!nuevo) { e.target.value = l.nombreArticulo; return showToast('El nombre no puede estar vacío', 'warning'); }
        await db.lineasPedido.update(lId, { nombreArticulo: nuevo });
        showToast('Concepto actualizado', 'success');
      } else if (e.target.dataset.detPrecio !== undefined) {
        const val = parseFloat(e.target.value);
        if (Number.isNaN(val)) { e.target.value = Number(l.precioUnitario || 0).toFixed(2); return; }
        await db.lineasPedido.update(lId, { precioUnitario: round2(val) });
        showToast('Precio actualizado en el pedido', 'success');
      } else if (e.target.dataset.detCant !== undefined) {
        const oldQty = Number(l.cantidad || 1);
        const newQty = Math.max(1, parseInt(e.target.value || '1', 10) || 1);
        if (newQty === oldQty) { e.target.value = String(oldQty); return; }
        const diff = newQty - oldQty;
        const nowIso = new Date().toISOString();
        await db.transaction('rw', [db.pedidos, db.lineasPedido, db.variantes, db.movimientos_stock], async () => {
          const p = await db.pedidos.get(state.currentPedidoId);
          if (l.varianteId) {
            const v = await db.variantes.get(l.varianteId);
            if (v) {
              const stockRes = Number(v.stock || 0) - diff;
              await db.variantes.update(v.id, { stock: stockRes });
              await registrarMovimientoStock({
                fecha: nowIso,
                articuloId: l.articuloId || null,
                varianteId: v.id,
                nombreArticulo: l.nombreArticulo,
                descripcionVariante: l.descripcionVariante || '',
                tipo: 'ajuste_manual',
                delta: -diff,
                stockResultante: stockRes,
                referencia: p?.numero || '',
                nota: 'Cantidad modificada en pedido'
              });
            }
          }
          await db.lineasPedido.update(lId, { cantidad: newQty });
        });
        await recalcularAlertasStock(false);
        showToast('Cantidad actualizada', 'success');
      }
      await renderDetalle(); await loadListado();
    });
    document.getElementById('det-lineas-tbody').addEventListener('click', async e => {
      const b = e.target.closest('[data-det-del]'); if (!b) return;
      const lId = Number(b.dataset.detDel);
      const l = await db.lineasPedido.get(lId); if (!l) return;
      const nowIso = new Date().toISOString();
      await db.transaction('rw', [db.pedidos, db.lineasPedido, db.variantes, db.movimientos_stock], async () => {
        const p = await db.pedidos.get(state.currentPedidoId);
        if (l.varianteId) {
          const v = await db.variantes.get(l.varianteId);
          if (v) {
            const qty = Number(l.cantidad || 0);
            const stockRes = Number(v.stock || 0) + qty;
            await db.variantes.update(v.id, { stock: stockRes });
            await registrarMovimientoStock({
              fecha: nowIso,
              articuloId: l.articuloId || null,
              varianteId: v.id,
              nombreArticulo: l.nombreArticulo,
              descripcionVariante: l.descripcionVariante || '',
              tipo: 'ajuste_manual',
              delta: qty,
              stockResultante: stockRes,
              referencia: p?.numero || '',
              nota: 'Línea quitada del pedido'
            });
          }
        }
        await db.lineasPedido.delete(lId);
      });
      await recalcularAlertasStock(false); await renderDetalle(); await loadListado();
    });

    // Modales Pago, Bolsa y Confirmación
    document.querySelectorAll('.pay-method-btn').forEach(b => b.addEventListener('click', () => {
      state.pagoMethod = b.dataset.payMethod;
      document.querySelectorAll('.pay-method-btn').forEach(x => { x.classList.toggle('border-[#B6BEB2]', x === b); x.classList.toggle('bg-[#F5F7F4]', x === b); });
    }));
    document.getElementById('modal-pago-close').addEventListener('click', () => document.getElementById('modal-pedido-pago').classList.add('hidden'));
    document.getElementById('modal-pago-cancel').addEventListener('click', () => document.getElementById('modal-pedido-pago').classList.add('hidden'));
    document.getElementById('modal-pago-confirm').addEventListener('click', confirmarPago);
    document.getElementById('modal-pconf-cancel').addEventListener('click', () => document.getElementById('modal-pedido-confirm').classList.add('hidden'));

    // Modal Cerrar Bolsa y Enviar
    const closeBolsaModal = () => document.getElementById('modal-cerrar-bolsa')?.classList.add('hidden');
    document.getElementById('mbolsa-close')?.addEventListener('click', closeBolsaModal);
    document.getElementById('mbolsa-cancel')?.addEventListener('click', closeBolsaModal);
    bindPorteSync('mbolsa-porte-select', 'mbolsa-porte-nombre', 'mbolsa-porte-precio');
    document.getElementById('mbolsa-porte-select')?.addEventListener('change', updateCerrarBolsaResumen);
    document.getElementById('mbolsa-porte-nombre')?.addEventListener('input', updateCerrarBolsaResumen);
    document.getElementById('mbolsa-porte-precio')?.addEventListener('input', updateCerrarBolsaResumen);
    document.getElementById('mbolsa-add-porte-chk')?.addEventListener('change', () => {
      document.getElementById('mbolsa-porte-inputs')?.classList.toggle('hidden', !document.getElementById('mbolsa-add-porte-chk').checked);
      updateCerrarBolsaResumen();
    });
    document.getElementById('mbolsa-marcar-pagado-chk')?.addEventListener('change', () => {
      const chk = document.getElementById('mbolsa-marcar-pagado-chk').checked;
      document.getElementById('mbolsa-pay-methods')?.classList.toggle('hidden', !chk);
    });
    document.querySelectorAll('.bolsa-pay-btn').forEach(b => b.addEventListener('click', () => {
      state.bolsaPayMethod = b.dataset.bolsaPay;
      document.querySelectorAll('.bolsa-pay-btn').forEach(x => {
        x.classList.toggle('border-[#B6BEB2]', x === b);
        x.classList.toggle('bg-[#F5F7F4]', x === b);
      });
    }));
    document.getElementById('mbolsa-btn-albaran')?.addEventListener('click', () => {
      const b = buildBolsasAbiertas().find(x => x.key === state.cerrarBolsaKey);
      if (!b) return;
      const porteDraft = getModalPorteDraft(b);
      DocumentosModule.abrirAlbaranBolsa(b.pedidos.map(p => p.id), porteDraft);
    });
    document.getElementById('mbolsa-confirm')?.addEventListener('click', confirmarCerrarBolsa);
  }

  async function sacarPedidoDeBolsa(pedidoId) {
    const p = await db.pedidos.get(Number(pedidoId));
    if (!p) return;
    const nowIso = new Date().toISOString();
    const hist = [...(p.historialEstados || []), { estado: p.estado, fecha: nowIso, nota: 'Sacado de bolsa abierta' }];
    await db.pedidos.update(p.id, { enBolsa: false, bolsaId: null, historialEstados: hist });
    showToast(`${p.numero} sacado de la bolsa`, 'success');
    await loadListado();
    if (state.currentPedidoId === p.id) await renderDetalle();
  }

  async function meterPedidoEnBolsa(pedidoId) {
    const p = await db.pedidos.get(Number(pedidoId));
    if (!p) return;
    if (!state.pedidos.length) await loadListado();
    const existing = p.clienteId ? buildBolsasAbiertas().find(b => Number(b.clienteId) === Number(p.clienteId)) : null;
    const bolsaId = existing?.bolsaId || `BOLSA-${p.clienteId || 'C'}-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const hist = [...(p.historialEstados || []), { estado: p.estado, fecha: nowIso, nota: 'Guardado en bolsa abierta' }];
    await db.pedidos.update(p.id, { enBolsa: true, bolsaId, historialEstados: hist });
    showToast(`${p.numero} añadido a bolsa abierta`, 'success');
    await loadListado();
    if (state.currentPedidoId === p.id) await renderDetalle();
  }

  function getModalPorteDraft(b) {
    if (!b || b.hasPorte) return null;
    const chk = document.getElementById('mbolsa-add-porte-chk')?.checked;
    if (!chk) return null;
    const nombre = (document.getElementById('mbolsa-porte-nombre')?.value || '').trim() || 'Portes';
    const rawP = parseFloat(document.getElementById('mbolsa-porte-precio')?.value || '0');
    const precio = Number.isNaN(rawP) ? 0 : round2(Math.max(0, rawP));
    return { nombre, precio };
  }

  function updateCerrarBolsaResumen() {
    const b = buildBolsasAbiertas().find(x => x.key === state.cerrarBolsaKey);
    if (!b) return;
    const porteDraft = getModalPorteDraft(b);
    const extraP = porteDraft ? porteDraft.precio : 0;
    const tot = round2(b.totalImporte + extraP);
    const pend = round2(b.pendienteImporte + extraP);

    const pagoBox = document.getElementById('mbolsa-pago-box');
    if (pagoBox) {
      pagoBox.classList.toggle('hidden', pend <= 0);
      if (pend <= 0) {
        const chkP = document.getElementById('mbolsa-marcar-pagado-chk');
        if (chkP) chkP.checked = false;
        document.getElementById('mbolsa-pay-methods')?.classList.add('hidden');
      }
    }

    const resEl = document.getElementById('mbolsa-resumen-totales');
    if (resEl) {
      resEl.innerHTML = `
        <div class="flex justify-between"><span>Pedidos acumulados (${b.pedidos.length})</span><span>${fmtEur(b.totalImporte)}</span></div>
        ${porteDraft ? `<div class="flex justify-between text-gray-700"><span>Porte único (${esc(porteDraft.nombre)})</span><span>+${fmtEur(porteDraft.precio)}</span></div>` : ''}
        ${b.pagadoImporte > 0 ? `<div class="flex justify-between text-emerald-700"><span>Ya pagado</span><span>-${fmtEur(b.pagadoImporte)}</span></div>` : ''}
        <div class="flex justify-between font-bold text-sm text-gray-900 pt-1.5 border-t border-gray-200">
          <span>Total envío completo</span><span>${fmtEur(tot)}</span>
        </div>
        ${pend > 0 ? `<div class="flex justify-between font-semibold text-amber-800"><span>Pendiente de cobro</span><span>${fmtEur(pend)}</span></div>` : '<div class="text-emerald-700 font-semibold pt-0.5">✅ Todo pagado</div>'}`;
    }

    const waBtn = document.getElementById('mbolsa-btn-whatsapp');
    if (waBtn) {
      const waUrl = buildWhatsAppUrl(b.telefonoCliente, buildBolsaWhatsAppResumen(b, porteDraft));
      waBtn.classList.toggle('hidden', !waUrl);
      if (waUrl) waBtn.href = waUrl;
    }
  }

  async function openCerrarBolsaModal(bolsaKey) {
    if (!state.pedidos.length) await loadListado();
    const b = buildBolsasAbiertas().find(x => x.key === bolsaKey || x.pedidos.some(p => getBolsaKey(p) === bolsaKey));
    if (!b) return showToast('No se encontró esa bolsa abierta', 'warning');

    state.cerrarBolsaKey = b.key;
    state.bolsaPayMethod = null;
    document.querySelectorAll('.bolsa-pay-btn').forEach(x => { x.classList.remove('border-[#B6BEB2]', 'bg-[#F5F7F4]'); });

    document.getElementById('mbolsa-title').textContent = `Cerrar bolsa de ${b.nombreCliente}`;
    document.getElementById('mbolsa-subtitle').textContent = `${b.pedidos.length} pedido(s) · ${b.totalArticulos} artículo(s) acumulados`;
    document.getElementById('mbolsa-pedidos-list').innerHTML = b.pedidos.map(p => {
      const est = ESTADOS_META[p.estado] || ESTADOS_META.pendiente_pago;
      const artCount = (p.lineas || []).reduce((s, l) => (Number(l.precioUnitario || 0) >= 0 && l.descripcionVariante !== 'Portes' ? s + Math.max(0, Number(l.cantidad || 0)) : s), 0);
      return `
        <div class="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
          <div>
            <span class="font-bold text-gray-900">${esc(p.numero)}</span>
            <span class="text-gray-400 ml-1.5">${fmtFecha(p.fecha)} · ${artCount} art.</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md font-semibold ${est.cls}">${est.label}</span>
            <span class="font-bold text-gray-900">${fmtEur(p.total)}</span>
          </div>
        </div>`;
    }).join('');

    const porteExisteEl = document.getElementById('mbolsa-porte-ya-existe');
    const porteWrap = document.getElementById('mbolsa-porte-selector-wrap');
    const porteChk = document.getElementById('mbolsa-add-porte-chk');
    if (b.hasPorte) {
      porteExisteEl.textContent = `✅ Esta bolsa ya incluye porte (${b.porteInfo}). No se añadirá otro.`;
      porteExisteEl.classList.remove('hidden');
      porteWrap.classList.add('hidden');
      if (porteChk) porteChk.checked = false;
    } else {
      porteExisteEl.classList.add('hidden');
      porteWrap.classList.remove('hidden');
      if (porteChk) porteChk.checked = true;
      document.getElementById('mbolsa-porte-inputs')?.classList.remove('hidden');
      await populatePorteSelector('mbolsa-porte-select', 'mbolsa-porte-nombre', 'mbolsa-porte-precio');
    }

    const chkPay = document.getElementById('mbolsa-marcar-pagado-chk');
    if (chkPay) chkPay.checked = false;
    document.getElementById('mbolsa-pay-methods')?.classList.add('hidden');
    const chkEnv = document.getElementById('mbolsa-marcar-enviado-chk');
    if (chkEnv) chkEnv.checked = true;

    updateCerrarBolsaResumen();
    document.getElementById('modal-cerrar-bolsa').classList.remove('hidden');
  }

  async function confirmarCerrarBolsa() {
    const b = buildBolsasAbiertas().find(x => x.key === state.cerrarBolsaKey);
    if (!b) return;
    const addPorte = Boolean(!b.hasPorte && document.getElementById('mbolsa-add-porte-chk')?.checked);
    const porteNombre = (document.getElementById('mbolsa-porte-nombre')?.value || '').trim();
    const portePrecio = parseFloat(document.getElementById('mbolsa-porte-precio')?.value || '');
    if (addPorte && (!porteNombre || Number.isNaN(portePrecio) || portePrecio < 0)) {
      return showToast('Indica concepto y precio válido para el porte', 'warning');
    }
    const marcarPagado = Boolean(document.getElementById('mbolsa-marcar-pagado-chk')?.checked);
    const marcarEnviado = Boolean(document.getElementById('mbolsa-marcar-enviado-chk')?.checked);
    const pendingWithPorte = round2(b.pendienteImporte + (addPorte ? round2(portePrecio) : 0));
    if (marcarPagado && pendingWithPorte > 0 && !state.bolsaPayMethod) {
      return showToast('Elige el método de pago para cobrar lo pendiente', 'warning');
    }
    if (!addPorte && !marcarPagado && !marcarEnviado) {
      return showToast('Selecciona al menos una acción para procesar la bolsa', 'warning');
    }

    const nowIso = new Date().toISOString();
    const año = new Date().getFullYear();
    const añoC = String(año).slice(-2);
    const pedIds = b.pedidos.map(p => p.id);

    await db.transaction('rw', [db.empresa, db.pedidos, db.lineasPedido], async () => {
      let emp = (await db.empresa.get(1)) || { id: 1, ivaDefecto: 21 };
      const ivaDef = Number(emp.ivaDefecto || 21);

      if (addPorte) {
        let targetPend = null;
        for (const id of pedIds) {
          const ped = await db.pedidos.get(id);
          if (ped && ped.estado === 'pendiente_pago') targetPend = ped;
        }
        if (targetPend) {
          await db.lineasPedido.add({
            pedidoId: targetPend.id,
            articuloId: null,
            varianteId: null,
            nombreArticulo: porteNombre,
            descripcionVariante: 'Portes',
            cantidad: 1,
            precioUnitario: round2(portePrecio),
            tipoIVA: ivaDef
          });
          const hist = [...(targetPend.historialEstados || []), { estado: targetPend.estado, fecha: nowIso, nota: `Porte añadido al cerrar bolsa (${porteNombre})` }];
          await db.pedidos.update(targetPend.id, { historialEstados: hist });
        } else {
          const ultPed = emp.ultimoNumeroPedido || { año, numero: 0 };
          const sigPed = (ultPed.año === año ? Number(ultPed.numero || 0) : 0) + 1;
          const numGen = `BLC-${añoC}${String(sigPed).padStart(4, '0')}`;
          emp = { ...emp, id: 1, ultimoNumeroPedido: { año, numero: sigPed } };
          await db.empresa.put(emp);
          const newPortePedId = await db.pedidos.add({
            numero: numGen,
            clienteId: b.clienteId,
            nombreCliente: b.nombreCliente,
            telefonoCliente: b.telefonoCliente,
            fecha: nowIso,
            estado: 'pendiente_pago',
            enBolsa: true,
            bolsaId: b.bolsaId || b.key,
            metodoPago: null,
            numeroFactura: null,
            fechaPago: null,
            fechaEnvio: null,
            fechaCompletado: null,
            notas: 'Portes de envío de bolsa acumulada',
            descuentoTipo: null,
            descuentoValor: 0,
            gastosEnvio: 0,
            devoluciones: [],
            historialEstados: [{ estado: 'pendiente_pago', fecha: nowIso, nota: 'Pedido de portes creado al cerrar bolsa' }]
          });
          await db.lineasPedido.add({
            pedidoId: newPortePedId,
            articuloId: null,
            varianteId: null,
            nombreArticulo: porteNombre,
            descripcionVariante: 'Portes',
            cantidad: 1,
            precioUnitario: round2(portePrecio),
            tipoIVA: ivaDef
          });
          pedIds.push(newPortePedId);
        }
      }

      if (marcarPagado) {
        for (const id of pedIds) {
          const ped = await db.pedidos.get(id);
          if (!ped || ped.estado !== 'pendiente_pago') continue;
          let numFac = ped.numeroFactura || null;
          if (!numFac) {
            const ultFac = emp.ultimoNumeroFactura || { año, numero: 0 };
            const sigFac = (ultFac.año === año ? Number(ultFac.numero || 0) : 0) + 1;
            numFac = `FAC-${año}-${String(sigFac).padStart(4, '0')}`;
            emp = { ...emp, id: 1, ultimoNumeroFactura: { año, numero: sigFac } };
            await db.empresa.put(emp);
          }
          const hist = [...(ped.historialEstados || []), { estado: 'pagado', fecha: nowIso, nota: `Pago bolsa (${METODO_LABELS[state.bolsaPayMethod]}) · Factura ${numFac}` }];
          await db.pedidos.update(ped.id, {
            estado: 'pagado',
            metodoPago: state.bolsaPayMethod,
            fechaPago: nowIso,
            numeroFactura: numFac,
            historialEstados: hist
          });
        }
      }

      if (marcarEnviado) {
        for (const id of pedIds) {
          const ped = await db.pedidos.get(id);
          if (!ped) continue;
          const hist = [...(ped.historialEstados || []), { estado: 'enviado', fecha: nowIso, nota: 'Bolsa cerrada y enviada en un único paquete' }];
          await db.pedidos.update(ped.id, {
            estado: 'enviado',
            enBolsa: false,
            fechaEnvio: nowIso,
            historialEstados: hist
          });
        }
      }
    });

    document.getElementById('modal-cerrar-bolsa').classList.add('hidden');
    showToast(marcarEnviado ? `Bolsa de ${b.nombreCliente} cerrada y enviada` : 'Bolsa actualizada correctamente', 'success');
    await loadListado();
    if (state.currentPedidoId && pedIds.includes(state.currentPedidoId)) await renderDetalle();
    if (b.clienteId && !document.getElementById('clientes-subview-ficha')?.classList.contains('hidden')) {
      await ClientesModule.openFicha(b.clienteId);
    }
  }

  async function init() { bindEvents(); await autoCompletarPedidosEnviados(); await loadListado(); }
  async function onEnterView() { await autoCompletarPedidosEnviados(); showSubview('lista'); await loadListado(); }
  async function refreshActive() {
    if (!document.getElementById('pedidos-subview-lista').classList.contains('hidden')) await loadListado();
    else if (!document.getElementById('pedidos-subview-detalle').classList.contains('hidden') && state.currentPedidoId) await renderDetalle();
  }
  return { init, onEnterView, openDetalle, openWizard, setPedTab, expandBolsa: (k) => state.expandedBolsas.add(k), openCerrarBolsaModal, refreshActive };
})();

window.openPedidoDetalle = async (id, opts = {}) => { navigateTo('pedidos', { skipEnter: true }); await PedidosModule.openDetalle(id, opts); };
window.openWizardBolsaForCliente = async (clienteId) => { navigateTo('pedidos', { skipEnter: true }); await PedidosModule.openWizard({ clienteId, jumpStep2: true }); };
window.openPedidosBolsasTab = async (expandKey = null) => {
  navigateTo('pedidos', { skipEnter: true });
  if (expandKey) PedidosModule.expandBolsa(expandKey);
  await PedidosModule.onEnterView();
  PedidosModule.setPedTab('bolsas');
};
window.openCerrarBolsaModal = async (bolsaKey) => { await PedidosModule.openCerrarBolsaModal(bolsaKey); };

// ==================== 8. DOCUMENTOS (ALBARÁN PNG + FACTURA PDF) ====================
const DocumentosModule = (() => {
  let albBlob = null, albName = 'pedido.png', facBlob = null, facName = 'factura.pdf';
  const loadImg = (src) => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const wrap = (ctx, t, mw) => {
    const words = String(t || '').split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width > mw && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur); return lines.length ? lines : [''];
  };
  const dl = (b, fn) => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500); };
  const share = async (b, fn, title) => {
    const f = new File([b], fn, { type: b.type });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    dl(b, fn); showToast('Archivo descargado', 'success');
  };

  async function abrirAlbaran(pedidoId) {
    showGlobalSpinner('Generando imagen...');
    try {
      const [p, ls, emp] = await Promise.all([db.pedidos.get(Number(pedidoId)), db.lineasPedido.where('pedidoId').equals(Number(pedidoId)).toArray(), db.empresa.get(1)]);
      const cli = p.clienteId ? await db.clientes.get(p.clienteId) : null;
      const tots = calcPedidoTotales(p, ls);
      const logo = await loadImg(emp?.logo);
      const W = 1080, PAD = 72, IW = W - PAD * 2;
      const mc = document.createElement('canvas').getContext('2d');
      const titulo = `Pedido de ${(p.nombreCliente || '').trim() || (p.telefonoCliente || '').trim() || 'Cliente'}`;
      mc.font = 'bold 44px system-ui, sans-serif';
      const tLines = wrap(mc, titulo, IW - (logo ? 210 : 0));
      mc.font = '600 23px system-ui, sans-serif';
      const rows = ls.map(l => {
        const dL = wrap(mc, l.nombreArticulo, 360), vL = wrap(mc, l.descripcionVariante || '—', 210);
        return { l, dL, vL, h: Math.max(56, Math.max(dL.length, vL.length) * 30 + 24) };
      });
      const extraLines = [];
      if (tots.descuentoEur > 0 || tots.envio > 0 || tots.totalDevuelto > 0) extraLines.push({ label: 'Subtotal artículos', val: fmtEur(tots.brutoLineas), color: '#4B5563' });
      if (tots.descuentoEur > 0) extraLines.push({ label: `Descuento${tots.descTipo === 'pct' ? ` (${tots.descVal}%)` : ''}`, val: `-${fmtEur(tots.descuentoEur)}`, color: '#047857' });
      if (tots.envio > 0) extraLines.push({ label: 'Gastos de envío', val: fmtEur(tots.envio), color: '#4B5563' });
      if (tots.totalDevuelto > 0) extraLines.push({ label: 'Devoluciones', val: `-${fmtEur(tots.totalDevuelto)}`, color: '#B91C1C' });

      const msg = (emp?.mensajeAlbaran || '¡Gracias por tu compra!').trim();
      mc.font = 'italic 23px system-ui, sans-serif';
      const mLines = wrap(mc, msg, IW);

      const headH = Math.max(120, tLines.length * 52 + 76);
      const extraH = extraLines.length ? extraLines.length * 38 + 20 : 0;
      const H = Math.max(720, 44 + headH + 90 + rows.reduce((a, r) => a + r.h, 0) + extraH + 180 + mLines.length * 32 + 50);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#B6BEB2'; ctx.fillRect(0, 0, W, 16);
      ctx.fillStyle = '#F5F7F4'; ctx.beginPath(); ctx.arc(W - 60, 70, 160, 0, Math.PI * 2); ctx.fill();

      let y = 64;
      if (logo) { const r = Math.min(190 / logo.width, 96 / logo.height, 1); ctx.drawImage(logo, W - PAD - logo.width * r, y, logo.width * r, logo.height * r); }
      ctx.fillStyle = '#1F2937'; ctx.font = 'bold 44px system-ui, sans-serif'; ctx.textBaseline = 'top';
      let ty = y; tLines.forEach(t => { ctx.fillText(t, PAD, ty); ty += 52; });
      ctx.fillStyle = '#6B7280'; ctx.font = '500 22px system-ui, sans-serif';
      ctx.fillText(`${p.numero}  ·  ${fmtFecha(p.fecha)}`, PAD, ty + 10);

      y += headH + 20;
      ctx.fillStyle = '#F5F7F4'; ctx.fillRect(PAD, y, IW, 52);
      ctx.fillStyle = '#4B5563'; ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.fillText('DESCRIPCIÓN', PAD + 16, y + 17); ctx.fillText('VARIANTE', PAD + 395, y + 17);
      ctx.textAlign = 'center'; ctx.fillText('CANT.', PAD + 645, y + 17);
      ctx.textAlign = 'right'; ctx.fillText('P. UNIT.', PAD + 785, y + 17); ctx.fillText('TOTAL', W - PAD - 16, y + 17);
      y += 52;

      rows.forEach(r => {
        const lt = Number(r.l.cantidad) * Number(r.l.precioUnitario);
        ctx.textAlign = 'left'; ctx.fillStyle = '#1F2937'; ctx.font = '600 23px system-ui, sans-serif';
        r.dL.forEach((t, i) => ctx.fillText(t, PAD + 16, y + 16 + i * 30));
        ctx.fillStyle = '#6B7280'; ctx.font = '400 21px system-ui, sans-serif';
        r.vL.forEach((t, i) => ctx.fillText(t, PAD + 395, y + 16 + i * 30));
        ctx.fillStyle = '#1F2937'; ctx.textAlign = 'center'; ctx.font = '600 23px system-ui, sans-serif';
        ctx.fillText(String(r.l.cantidad), PAD + 645, y + 16);
        ctx.textAlign = 'right'; ctx.font = '400 22px system-ui, sans-serif'; ctx.fillText(fmtEur(r.l.precioUnitario), PAD + 785, y + 16);
        ctx.font = 'bold 23px system-ui, sans-serif'; ctx.fillText(fmtEur(lt), W - PAD - 16, y + 16);
        y += r.h;
      });

      if (extraLines.length) {
        y += 12;
        extraLines.forEach(el => {
          ctx.textAlign = 'left'; ctx.fillStyle = el.color; ctx.font = '500 22px system-ui, sans-serif';
          ctx.fillText(el.label, PAD + 16, y);
          ctx.textAlign = 'right'; ctx.font = 'bold 22px system-ui, sans-serif';
          ctx.fillText(el.val, W - PAD - 16, y);
          y += 38;
        });
      }

      y += 20; ctx.strokeStyle = '#B6BEB2'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); y += 30;
      ctx.textAlign = 'left'; ctx.fillStyle = '#6B7280'; ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillText('TOTAL', PAD, y + 14);
      ctx.textAlign = 'right'; ctx.fillStyle = '#1F2937'; ctx.font = 'bold 52px system-ui, sans-serif'; ctx.fillText(fmtEur(tots.totalNeto), W - PAD, y);
      y += 100; ctx.textAlign = 'center'; ctx.fillStyle = '#727D6E'; ctx.font = 'italic bold 30px Georgia, serif'; ctx.fillText(emp?.nombre || 'babyluc', W / 2, y);
      y += 42; ctx.fillStyle = '#4B5563'; ctx.font = 'italic 23px system-ui, sans-serif'; mLines.forEach(t => { ctx.fillText(t, W / 2, y); y += 32; });

      albBlob = await new Promise(res => c.toBlob(res, 'image/png'));
      albName = `${p.numero}.png`;
      document.getElementById('alb-preview-img').src = URL.createObjectURL(albBlob);
      const waAlb = document.getElementById('alb-btn-whatsapp');
      if (waAlb) {
        const waUrl = buildWhatsAppUrl(p.telefonoCliente || cli?.telefono || '', `¡Hola ${p.nombreCliente || ''}! Aquí tienes el resumen de tu pedido ${p.numero} (Total: ${fmtEur(tots.totalNeto)}).`);
        waAlb.classList.toggle('hidden', !waUrl);
        if (waUrl) waAlb.href = waUrl;
      }
      document.getElementById('modal-doc-albaran').classList.remove('hidden');
    } finally { hideGlobalSpinner(); }
  }

  async function abrirAlbaranBolsa(pedidoIds, extraPorte = null) {
    const ids = (pedidoIds || []).map(Number).filter(Boolean);
    if (!ids.length) return;
    showGlobalSpinner('Generando albarán de bolsa...');
    try {
      const [pedsRaw, allLineas, emp] = await Promise.all([
        Promise.all(ids.map(id => db.pedidos.get(id))),
        db.lineasPedido.toArray(),
        db.empresa.get(1)
      ]);
      const peds = pedsRaw.filter(Boolean).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      if (!peds.length) return;
      const firstCliId = peds.find(x => x.clienteId)?.clienteId;
      const cli = firstCliId ? await db.clientes.get(firstCliId) : null;
      const nombreCli = (peds.find(x => x.nombreCliente)?.nombreCliente || cli?.nombre || 'Cliente').trim();
      const telCli = peds.find(x => x.telefonoCliente)?.telefonoCliente || cli?.telefono || '';

      const lByP = new Map();
      allLineas.forEach(l => { if (!lByP.has(l.pedidoId)) lByP.set(l.pedidoId, []); lByP.get(l.pedidoId).push(l); });

      const mergedLines = [];
      let sumTotal = 0, sumPagado = 0, sumPendiente = 0;
      for (const p of peds) {
        const ls = lByP.get(p.id) || [];
        const tots = calcPedidoTotales(p, ls);
        sumTotal = round2(sumTotal + tots.totalNeto);
        if (p.estado === 'pagado') sumPagado = round2(sumPagado + tots.totalNeto);
        else if (p.estado === 'pendiente_pago') sumPendiente = round2(sumPendiente + tots.totalNeto);
        ls.forEach(l => mergedLines.push({
          ...l,
          refPed: peds.length > 1 ? p.numero : ''
        }));
        if (tots.descuentoEur > 0) {
          mergedLines.push({ nombreArticulo: `Descuento (${p.numero})`, descripcionVariante: 'Descuento', cantidad: 1, precioUnitario: -tots.descuentoEur, refPed: '' });
        }
        if (tots.envio > 0) {
          mergedLines.push({ nombreArticulo: `Gastos de envío (${p.numero})`, descripcionVariante: 'Portes', cantidad: 1, precioUnitario: tots.envio, refPed: '' });
        }
      }
      if (extraPorte && extraPorte.nombre) {
        const ep = round2(Number(extraPorte.precio || 0));
        mergedLines.push({ nombreArticulo: extraPorte.nombre, descripcionVariante: 'Portes', cantidad: 1, precioUnitario: ep, refPed: '' });
        sumTotal = round2(sumTotal + ep);
        sumPendiente = round2(sumPendiente + ep);
      }

      const logo = await loadImg(emp?.logo);
      const W = 1080, PAD = 72, IW = W - PAD * 2;
      const mc = document.createElement('canvas').getContext('2d');
      const titulo = `Bolsa acumulada de ${nombreCli}`;
      mc.font = 'bold 42px system-ui, sans-serif';
      const tLines = wrap(mc, titulo, IW - (logo ? 210 : 0));
      mc.font = '600 22px system-ui, sans-serif';
      const rows = mergedLines.map(l => {
        const varTxt = [l.refPed, l.descripcionVariante || '—'].filter(Boolean).join(' · ');
        const dL = wrap(mc, l.nombreArticulo, 360), vL = wrap(mc, varTxt, 210);
        return { l, dL, vL, h: Math.max(54, Math.max(dL.length, vL.length) * 29 + 22) };
      });
      const extraLines = [];
      if (sumPagado > 0) extraLines.push({ label: 'Ya pagado previamente', val: `-${fmtEur(sumPagado)}`, color: '#047857' });
      if (sumPendiente > 0 && sumPagado > 0) extraLines.push({ label: 'Pendiente de pago', val: fmtEur(sumPendiente), color: '#B45309' });

      const msg = (emp?.mensajeAlbaran || '¡Gracias por tu compra!').trim();
      mc.font = 'italic 23px system-ui, sans-serif';
      const mLines = wrap(mc, msg, IW);

      const headH = Math.max(120, tLines.length * 50 + 78);
      const extraH = extraLines.length ? extraLines.length * 38 + 20 : 0;
      const H = Math.max(720, 44 + headH + 90 + rows.reduce((a, r) => a + r.h, 0) + extraH + 180 + mLines.length * 32 + 50);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#B6BEB2'; ctx.fillRect(0, 0, W, 16);
      ctx.fillStyle = '#F5F7F4'; ctx.beginPath(); ctx.arc(W - 60, 70, 160, 0, Math.PI * 2); ctx.fill();

      let y = 64;
      if (logo) { const r = Math.min(190 / logo.width, 96 / logo.height, 1); ctx.drawImage(logo, W - PAD - logo.width * r, y, logo.width * r, logo.height * r); }
      ctx.fillStyle = '#1F2937'; ctx.font = 'bold 42px system-ui, sans-serif'; ctx.textBaseline = 'top';
      let ty = y; tLines.forEach(t => { ctx.fillText(t, PAD, ty); ty += 50; });
      ctx.fillStyle = '#6B7280'; ctx.font = '500 21px system-ui, sans-serif';
      ctx.fillText(`${peds.map(p => p.numero).join(' + ')}  ·  ${fmtFecha(new Date().toISOString())}`, PAD, ty + 10);

      y += headH + 20;
      ctx.fillStyle = '#F5F7F4'; ctx.fillRect(PAD, y, IW, 52);
      ctx.fillStyle = '#4B5563'; ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.fillText('DESCRIPCIÓN', PAD + 16, y + 17); ctx.fillText('PEDIDO / VAR.', PAD + 395, y + 17);
      ctx.textAlign = 'center'; ctx.fillText('CANT.', PAD + 645, y + 17);
      ctx.textAlign = 'right'; ctx.fillText('P. UNIT.', PAD + 785, y + 17); ctx.fillText('TOTAL', W - PAD - 16, y + 17);
      y += 52;

      rows.forEach(r => {
        const lt = Number(r.l.cantidad) * Number(r.l.precioUnitario);
        ctx.textAlign = 'left'; ctx.fillStyle = lt < 0 ? '#047857' : '#1F2937'; ctx.font = '600 22px system-ui, sans-serif';
        r.dL.forEach((t, i) => ctx.fillText(t, PAD + 16, y + 15 + i * 29));
        ctx.fillStyle = '#6B7280'; ctx.font = '400 20px system-ui, sans-serif';
        r.vL.forEach((t, i) => ctx.fillText(t, PAD + 395, y + 15 + i * 29));
        ctx.fillStyle = '#1F2937'; ctx.textAlign = 'center'; ctx.font = '600 22px system-ui, sans-serif';
        ctx.fillText(String(r.l.cantidad), PAD + 645, y + 15);
        ctx.textAlign = 'right'; ctx.font = '400 21px system-ui, sans-serif'; ctx.fillText(fmtEur(r.l.precioUnitario), PAD + 785, y + 15);
        ctx.fillStyle = lt < 0 ? '#047857' : '#1F2937'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.fillText(fmtEur(lt), W - PAD - 16, y + 15);
        y += r.h;
      });

      if (extraLines.length) {
        y += 12;
        extraLines.forEach(el => {
          ctx.textAlign = 'left'; ctx.fillStyle = el.color; ctx.font = '500 22px system-ui, sans-serif';
          ctx.fillText(el.label, PAD + 16, y);
          ctx.textAlign = 'right'; ctx.font = 'bold 22px system-ui, sans-serif';
          ctx.fillText(el.val, W - PAD - 16, y);
          y += 38;
        });
      }

      y += 20; ctx.strokeStyle = '#B6BEB2'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke(); y += 30;
      ctx.textAlign = 'left'; ctx.fillStyle = '#6B7280'; ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillText('TOTAL BOLSA', PAD, y + 14);
      ctx.textAlign = 'right'; ctx.fillStyle = '#1F2937'; ctx.font = 'bold 52px system-ui, sans-serif'; ctx.fillText(fmtEur(sumTotal), W - PAD, y);
      y += 100; ctx.textAlign = 'center'; ctx.fillStyle = '#727D6E'; ctx.font = 'italic bold 30px Georgia, serif'; ctx.fillText(emp?.nombre || 'babyluc', W / 2, y);
      y += 42; ctx.fillStyle = '#4B5563'; ctx.font = 'italic 23px system-ui, sans-serif'; mLines.forEach(t => { ctx.fillText(t, W / 2, y); y += 32; });

      albBlob = await new Promise(res => c.toBlob(res, 'image/png'));
      const slug = nombreCli.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'cliente';
      albName = `BOLSA-${slug}.png`;
      document.getElementById('alb-preview-img').src = URL.createObjectURL(albBlob);
      const waAlb = document.getElementById('alb-btn-whatsapp');
      if (waAlb) {
        const pendTxt = sumPendiente > 0 && sumPagado > 0 ? ` (Pendiente: ${fmtEur(sumPendiente)})` : '';
        const waUrl = buildWhatsAppUrl(telCli, `¡Hola ${nombreCli}! Aquí tienes el resumen completo de tu bolsa acumulada (${peds.map(p => p.numero).join(' + ')}) · Total: ${fmtEur(sumTotal)}${pendTxt}.`);
        waAlb.classList.toggle('hidden', !waUrl);
        if (waUrl) waAlb.href = waUrl;
      }
      document.getElementById('modal-doc-albaran').classList.remove('hidden');
    } finally { hideGlobalSpinner(); }
  }

  function renderFacturaPage(doc, p, ls, emp, cli, logoImg) {
    const tots = calcPedidoTotales(p, ls);
    const pw = doc.internal.pageSize.getWidth(), m = 15;
    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFillColor(182, 190, 178); doc.rect(0, 0, pw, 4, 'F');
    if (logoImg && emp?.logo) {
      const r = Math.min(34 / logoImg.width, 18 / logoImg.height, 1);
      doc.addImage(emp.logo, emp.logo.includes('png') ? 'PNG' : 'JPEG', m, 14, logoImg.width * r, logoImg.height * r);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('FACTURA', pw - m, 20, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Nº: ${p.numeroFactura}`, pw - m, 27, { align: 'right' });
    doc.text(`Fecha: ${fmtFecha(p.fechaPago || p.fecha)}`, pw - m, 32, { align: 'right' });
    doc.text(`Ref. Pedido: ${p.numero}`, pw - m, 37, { align: 'right' });

    let ye = logoImg ? 38 : 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(emp?.nombre || 'babyluc', m, ye);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (emp?.cif) { ye += 5; doc.text(`CIF: ${emp.cif}`, m, ye); }
    if (emp?.direccion) { ye += 5; doc.text(emp.direccion, m, ye); }

    const yc = Math.max(ye + 8, 46);
    doc.setFillColor(249, 250, 251); doc.roundedRect(m, yc, pw - m * 2, 22, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(cli?.nombre || p.nombreCliente || 'Cliente', m + 4, yc + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text([cli?.nif ? `NIF: ${cli.nif}` : '', cli?.telefono || p.telefonoCliente || '', cli?.direccion || ''].filter(Boolean).join(' · '), m + 4, yc + 14);

    const body = ls.map(l => {
      const pu = Number(l.precioUnitario), cant = Number(l.cantidad);
      const ps = pu / 1.21, base = ps * cant;
      return [l.nombreArticulo, l.descripcionVariante || '—', String(cant), fmtEur(ps), '21%', fmtEur(base)];
    });
    if (tots.descuentoEur > 0) {
      const dBase = tots.descuentoEur / 1.21;
      body.push(['Descuento aplicado', tots.descTipo === 'pct' ? `${tots.descVal}%` : 'Importe fijo', '1', `-${fmtEur(dBase)}`, '21%', `-${fmtEur(dBase)}`]);
    }
    if (tots.envio > 0) {
      const eBase = tots.envio / 1.21;
      body.push(['Gastos de envío', 'Transporte / mensajería', '1', fmtEur(eBase), '21%', fmtEur(eBase)]);
    }
    doc.autoTable({ startY: yc + 28, margin: { left: m, right: m }, head: [['Descripción', 'Variante', 'Cant.', 'P. unit. s/IVA', 'IVA %', 'Base imponible']], body, headStyles: { fillColor: [182, 190, 178], textColor: [31, 41, 55] } });

    const st = tots.totalOriginal, sb = round2(st / 1.21), sc = round2(st - sb);
    const resBody = [
      ['Base imponible 21%', fmtEur(sb), 'Cuota IVA 21%', fmtEur(sc), fmtEur(st)],
      ['TOTAL BASE', fmtEur(sb), 'TOTAL IVA', fmtEur(sc), fmtEur(st)]
    ];
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      margin: { left: m, right: m },
      head: [['Base', 'Importe', 'IVA', 'Cuota', 'Total']],
      body: resBody,
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81] },
      didParseCell: (data) => {
        if (data.row.index === resBody.length - 1) {
          data.cell.styles.fillColor = [245, 247, 244];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    const ph = doc.internal.pageSize.getHeight();
    doc.setDrawColor(182, 190, 178); doc.setLineWidth(0.4); doc.line(m, ph - 18, pw - m, ph - 18);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(75, 85, 99);
    doc.text('Emisor acogido al régimen especial de recargo de equivalencia (Real Decreto 1624/1992)', pw / 2, ph - 12, { align: 'center' });
    doc.setTextColor(31, 41, 55); doc.setFont('helvetica', 'normal');
    return { st, sb, sc };
  }

  function renderRectificativaPage(doc, p, dev, emp, cli, logoImg) {
    const numRec = dev.numeroRectificativa || `REC-${p.numeroFactura || p.numero}`;
    const pw = doc.internal.pageSize.getWidth(), m = 15;
    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFillColor(182, 190, 178); doc.rect(0, 0, pw, 4, 'F');
    if (logoImg && emp?.logo) {
      const r = Math.min(34 / logoImg.width, 18 / logoImg.height, 1);
      doc.addImage(emp.logo, emp.logo.includes('png') ? 'PNG' : 'JPEG', m, 14, logoImg.width * r, logoImg.height * r);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('FACTURA RECTIFICATIVA', pw - m, 20, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Nº: ${numRec}`, pw - m, 27, { align: 'right' });
    doc.text(`Fecha: ${fmtFecha(dev.fecha)}`, pw - m, 32, { align: 'right' });
    doc.text(`Rectifica a: ${p.numeroFactura || p.numero}`, pw - m, 37, { align: 'right' });

    let ye = logoImg ? 38 : 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(emp?.nombre || 'babyluc', m, ye);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (emp?.cif) { ye += 5; doc.text(`CIF: ${emp.cif}`, m, ye); }
    if (emp?.direccion) { ye += 5; doc.text(emp.direccion, m, ye); }

    const yc = Math.max(ye + 8, 46);
    doc.setFillColor(249, 250, 251); doc.roundedRect(m, yc, pw - m * 2, 22, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(cli?.nombre || p.nombreCliente || 'Cliente', m + 4, yc + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text([cli?.nif ? `NIF: ${cli.nif}` : '', cli?.telefono || p.telefonoCliente || '', cli?.direccion || ''].filter(Boolean).join(' · '), m + 4, yc + 14);

    const body = (dev.items || []).map(it => {
      const pu = Number(it.precioUnitario || 0), cant = Number(it.cantidad || 0);
      const ps = pu / 1.21, base = ps * cant;
      return [it.nombreArticulo, it.descripcionVariante || '—', `-${cant}`, fmtEur(ps), '21%', `-${fmtEur(base)}`];
    });
    doc.autoTable({ startY: yc + 28, margin: { left: m, right: m }, head: [['Descripción', 'Variante', 'Cant.', 'P. unit. s/IVA', 'IVA %', 'Base imponible']], body, headStyles: { fillColor: [182, 190, 178], textColor: [31, 41, 55] } });

    const st = round2(dev.totalDevuelto || 0), sb = round2(st / 1.21), sc = round2(st - sb);
    const resBody = [
      ['Base imponible 21%', `-${fmtEur(sb)}`, 'Cuota IVA 21%', `-${fmtEur(sc)}`, `-${fmtEur(st)}`],
      ['TOTAL RECTIFICADO', `-${fmtEur(sb)}`, 'TOTAL IVA', `-${fmtEur(sc)}`, `-${fmtEur(st)}`]
    ];
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      margin: { left: m, right: m },
      head: [['Base', 'Importe', 'IVA', 'Cuota', 'Total']],
      body: resBody,
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81] },
      didParseCell: (data) => {
        if (data.row.index === resBody.length - 1) {
          data.cell.styles.fillColor = [254, 242, 242];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    const ph = doc.internal.pageSize.getHeight();
    doc.setDrawColor(182, 190, 178); doc.setLineWidth(0.4); doc.line(m, ph - 18, pw - m, ph - 18);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(75, 85, 99);
    doc.text('Emisor acogido al régimen especial de recargo de equivalencia (Real Decreto 1624/1992)', pw / 2, ph - 12, { align: 'center' });
    doc.setTextColor(31, 41, 55); doc.setFont('helvetica', 'normal');
    return { numRec, st, sb, sc };
  }

  async function abrirFactura(pedidoId) {
    showGlobalSpinner('Generando factura PDF...');
    try {
      const [p, ls, emp] = await Promise.all([db.pedidos.get(Number(pedidoId)), db.lineasPedido.where('pedidoId').equals(Number(pedidoId)).toArray(), db.empresa.get(1)]);
      if (!p?.numeroFactura) return showToast('El pedido no tiene factura asignada', 'warning');
      const [cli, logoImg] = await Promise.all([
        p.clienteId ? db.clientes.get(p.clienteId) : Promise.resolve(null),
        emp?.logo ? loadImg(emp.logo) : Promise.resolve(null)
      ]);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const { st, sb, sc } = renderFacturaPage(doc, p, ls, emp, cli, logoImg);

      facBlob = doc.output('blob');
      facName = `${p.numeroFactura}.pdf`;
      document.getElementById('fac-modal-titulo').textContent = `Factura ${p.numeroFactura}`;
      document.getElementById('fac-modal-resumen').innerHTML = `<div><strong>Cliente:</strong> ${esc(p.nombreCliente)}</div><div><strong>Base:</strong> ${fmtEur(sb)} · <strong>IVA:</strong> ${fmtEur(sc)}</div><div class="text-base font-bold pt-1">Total: ${fmtEur(st)}</div>`;
      document.getElementById('modal-doc-factura').classList.remove('hidden');
    } finally { hideGlobalSpinner(); }
  }

  async function abrirRectificativa(pedidoId, devId) {
    showGlobalSpinner('Generando factura rectificativa...');
    try {
      const [p, emp] = await Promise.all([db.pedidos.get(Number(pedidoId)), db.empresa.get(1)]);
      const dev = (p?.devoluciones || []).find(d => Number(d.id) === Number(devId));
      if (!p || !dev) return showToast('No se encontró la devolución', 'warning');
      const [cli, logoImg] = await Promise.all([
        p.clienteId ? db.clientes.get(p.clienteId) : Promise.resolve(null),
        emp?.logo ? loadImg(emp.logo) : Promise.resolve(null)
      ]);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const { numRec, st, sb, sc } = renderRectificativaPage(doc, p, dev, emp, cli, logoImg);

      facBlob = doc.output('blob');
      facName = `${numRec}.pdf`;
      document.getElementById('fac-modal-titulo').textContent = `Rectificativa ${numRec}`;
      document.getElementById('fac-modal-resumen').innerHTML = `<div><strong>Cliente:</strong> ${esc(p.nombreCliente)}</div><div><strong>Base rectificada:</strong> -${fmtEur(sb)} · <strong>IVA:</strong> -${fmtEur(sc)}</div><div class="text-base font-bold text-red-700 pt-1">Total abono: -${fmtEur(st)}</div>`;
      document.getElementById('modal-doc-factura').classList.remove('hidden');
    } finally { hideGlobalSpinner(); }
  }

  // ---- Lote de facturas por período ----
  const ESTADOS_FACT = new Set(['pagado', 'enviado', 'completado']);
  const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function getLotePresetDates(preset) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    if (preset === 'mes') return [fmtYmd(new Date(y, m, 1)), fmtYmd(new Date(y, m + 1, 0))];
    if (preset === 'mes_ant') return [fmtYmd(new Date(y, m - 1, 1)), fmtYmd(new Date(y, m, 0))];
    if (preset === 'trimestre') { const q = Math.floor(m / 3) * 3; return [fmtYmd(new Date(y, q, 1)), fmtYmd(new Date(y, q + 3, 0))]; }
    if (preset === 'trim_ant') { const q = Math.floor(m / 3) * 3 - 3; return [fmtYmd(new Date(y, q, 1)), fmtYmd(new Date(y, q + 3, 0))]; }
    return [`${y}-01-01`, `${y}-12-31`];
  }

  async function collectLoteDocs() {
    const desde = document.getElementById('lote-fac-desde')?.value || '';
    const hasta = document.getElementById('lote-fac-hasta')?.value || '';
    const incluirRec = document.getElementById('lote-fac-incluir-rec')?.checked !== false;
    if (desde && hasta && desde > hasta) return { invalidRange: true, desde, hasta, docs: [] };

    const [peds, lineas, clis, emp] = await Promise.all([
      db.pedidos.toArray(),
      db.lineasPedido.toArray(),
      db.clientes.toArray(),
      db.empresa.get(1)
    ]);
    const cliMap = new Map(clis.map(c => [c.id, c]));
    const lByP = new Map();
    lineas.forEach(l => { if (!lByP.has(l.pedidoId)) lByP.set(l.pedidoId, []); lByP.get(l.pedidoId).push(l); });

    const inRange = (ymd) => (!desde || ymd >= desde) && (!hasta || ymd <= hasta);
    const docs = [];

    for (const p of peds) {
      if (!p.numeroFactura || !ESTADOS_FACT.has(p.estado)) continue;
      const ymd = String(p.fechaPago || p.fecha || '').slice(0, 10);
      if (inRange(ymd)) {
        const ls = lByP.get(p.id) || [];
        const tots = calcPedidoTotales(p, ls);
        const st = tots.totalOriginal, sb = round2(st / 1.21), sc = round2(st - sb);
        docs.push({
          type: 'fac',
          ymd,
          docNum: p.numeroFactura,
          p,
          ls,
          cli: p.clienteId ? (cliMap.get(p.clienteId) || null) : null,
          sb, sc, st
        });
      }
      if (incluirRec && Array.isArray(p.devoluciones)) {
        for (const dev of p.devoluciones) {
          if (!dev.numeroRectificativa) continue;
          const rYmd = String(dev.fecha || '').slice(0, 10);
          if (inRange(rYmd)) {
            const st = -round2(dev.totalDevuelto || 0);
            const sb = round2(st / 1.21);
            const sc = round2(st - sb);
            docs.push({
              type: 'rec',
              ymd: rYmd,
              docNum: dev.numeroRectificativa,
              p,
              dev,
              cli: p.clienteId ? (cliMap.get(p.clienteId) || null) : null,
              sb, sc, st
            });
          }
        }
      }
    }

    docs.sort((a, b) => a.ymd.localeCompare(b.ymd) || String(a.docNum).localeCompare(String(b.docNum)));
    return { invalidRange: false, desde, hasta, docs, emp };
  }

  async function refreshLotePreview() {
    const box = document.getElementById('lote-fac-resumen');
    if (!box) return;
    const { invalidRange, docs } = await collectLoteDocs();
    const hasDocs = !invalidRange && docs.length > 0;
    document.getElementById('lote-fac-download').disabled = !hasDocs;
    document.getElementById('lote-fac-share').disabled = !hasDocs;
    document.getElementById('lote-fac-csv').disabled = !hasDocs;
    document.getElementById('lote-fac-download').classList.toggle('opacity-40', !hasDocs);
    document.getElementById('lote-fac-share').classList.toggle('opacity-40', !hasDocs);
    document.getElementById('lote-fac-csv').classList.toggle('opacity-40', !hasDocs);

    if (invalidRange) {
      box.innerHTML = '<span class="text-red-700 font-semibold">La fecha "Desde" no puede ser posterior a "Hasta".</span>';
      return;
    }
    if (!docs.length) {
      box.innerHTML = '<span class="text-gray-500">No hay facturas emitidas en el período seleccionado.</span>';
      return;
    }
    const nFac = docs.filter(d => d.type === 'fac').length;
    const nRec = docs.filter(d => d.type === 'rec').length;
    const sumBase = round2(docs.reduce((a, d) => a + d.sb, 0));
    const sumIva = round2(docs.reduce((a, d) => a + d.sc, 0));
    const sumTot = round2(docs.reduce((a, d) => a + d.st, 0));
    box.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-bold text-gray-900">${nFac} factura(s)${nRec ? ` + ${nRec} rectificativa(s)` : ''}</span>
        <span class="font-bold text-sm text-gray-900">Total período: ${fmtEur(sumTot)}</span>
      </div>
      <div class="text-gray-600 pt-0.5">Base imponible 21%: <strong>${fmtEur(sumBase)}</strong> · Cuota IVA 21%: <strong>${fmtEur(sumIva)}</strong></div>
    `;
  }

  async function buildLotePdf() {
    const { invalidRange, desde, hasta, docs, emp } = await collectLoteDocs();
    if (invalidRange) { showToast('Revisa el rango de fechas', 'warning'); return null; }
    if (!docs.length) { showToast('No hay facturas en ese período', 'warning'); return null; }

    const incluirPortada = document.getElementById('lote-fac-portada')?.checked !== false;
    const logoImg = emp?.logo ? await loadImg(emp.logo) : null;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth(), m = 15;
    let hasPage = false;

    if (incluirPortada) {
      hasPage = true;
      doc.setTextColor(31, 41, 55);
      doc.setFillColor(182, 190, 178); doc.rect(0, 0, pw, 4, 'F');
      if (logoImg && emp?.logo) {
        const r = Math.min(34 / logoImg.width, 18 / logoImg.height, 1);
        doc.addImage(emp.logo, emp.logo.includes('png') ? 'PNG' : 'JPEG', m, 14, logoImg.width * r, logoImg.height * r);
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
      doc.text('RESUMEN DE FACTURAS', pw - m, 20, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      const rangoTxt = `${desde ? fmtFecha(desde) : 'Inicio'} — ${hasta ? fmtFecha(hasta) : 'Hoy'}`;
      doc.text(`Período: ${rangoTxt}`, pw - m, 27, { align: 'right' });
      doc.text(`Documentos: ${docs.length}`, pw - m, 32, { align: 'right' });

      let ye = logoImg ? 38 : 18;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(emp?.nombre || 'babyluc', m, ye);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      if (emp?.cif) { ye += 5; doc.text(`CIF: ${emp.cif}`, m, ye); }
      if (emp?.direccion) { ye += 5; doc.text(emp.direccion, m, ye); }

      const sumBase = round2(docs.reduce((a, d) => a + d.sb, 0));
      const sumIva = round2(docs.reduce((a, d) => a + d.sc, 0));
      const sumTot = round2(docs.reduce((a, d) => a + d.st, 0));

      const tBody = docs.map(d => [
        fmtFecha(d.ymd),
        d.docNum,
        d.p.numero || '',
        d.cli?.nombre || d.p.nombreCliente || 'Cliente',
        d.cli?.nif || '—',
        fmtEur(d.sb),
        fmtEur(d.sc),
        fmtEur(d.st)
      ]);
      tBody.push(['TOTAL', `${docs.length} doc(s)`, '', '', '', fmtEur(sumBase), fmtEur(sumIva), fmtEur(sumTot)]);

      doc.autoTable({
        startY: Math.max(ye + 10, 46),
        margin: { left: m, right: m },
        styles: { fontSize: 8, cellPadding: 2 },
        head: [['Fecha', 'Nº Factura', 'Pedido', 'Cliente', 'NIF/CIF', 'Base 21%', 'IVA 21%', 'Total']],
        body: tBody,
        headStyles: { fillColor: [182, 190, 178], textColor: [31, 41, 55] },
        didParseCell: (data) => {
          if (data.row.index === tBody.length - 1) {
            data.cell.styles.fillColor = [245, 247, 244];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });
    }

    for (const d of docs) {
      if (hasPage) doc.addPage();
      hasPage = true;
      if (d.type === 'fac') renderFacturaPage(doc, d.p, d.ls, emp, d.cli, logoImg);
      else renderRectificativaPage(doc, d.p, d.dev, emp, d.cli, logoImg);
    }

    const suf = `${desde || 'inicio'}_a_${hasta || 'hoy'}`;
    return { blob: doc.output('blob'), filename: `babyluc_facturas_${suf}.pdf`, count: docs.length };
  }

  function applyLotePreset(preset) {
    const [d1, d2] = getLotePresetDates(preset);
    document.getElementById('lote-fac-desde').value = d1;
    document.getElementById('lote-fac-hasta').value = d2;
    document.querySelectorAll('.lote-preset-btn').forEach(b => {
      const act = b.dataset.lotePreset === preset;
      b.className = act
        ? 'lote-preset-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#B6BEB2] bg-[#F5F7F4] text-gray-900 cursor-pointer'
        : 'lote-preset-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer';
    });
    refreshLotePreview();
  }

  function openLoteModal(initDesde = '', initHasta = '') {
    if (initDesde || initHasta) {
      document.getElementById('lote-fac-desde').value = initDesde;
      document.getElementById('lote-fac-hasta').value = initHasta;
      document.querySelectorAll('.lote-preset-btn').forEach(b => {
        b.className = 'lote-preset-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer';
      });
      refreshLotePreview();
    } else {
      applyLotePreset('mes');
    }
    document.getElementById('modal-lote-facturas').classList.remove('hidden');
  }

  function init() {
    document.getElementById('modal-alb-close').addEventListener('click', () => document.getElementById('modal-doc-albaran').classList.add('hidden'));
    document.getElementById('alb-btn-descargar').addEventListener('click', () => albBlob && dl(albBlob, albName));
    document.getElementById('alb-btn-compartir').addEventListener('click', () => albBlob && share(albBlob, albName, 'Resumen de pedido'));
    document.getElementById('modal-fac-close').addEventListener('click', () => document.getElementById('modal-doc-factura').classList.add('hidden'));
    document.getElementById('fac-btn-descargar').addEventListener('click', () => facBlob && dl(facBlob, facName));
    document.getElementById('fac-btn-compartir').addEventListener('click', () => facBlob && share(facBlob, facName, facName));

    document.getElementById('btn-lote-facturas')?.addEventListener('click', () => {
      openLoteModal(document.getElementById('pedidos-filter-desde')?.value || '', document.getElementById('pedidos-filter-hasta')?.value || '');
    });
    document.getElementById('btn-bal-lote-facturas')?.addEventListener('click', () => {
      openLoteModal(document.getElementById('bal-date-start')?.value || '', document.getElementById('bal-date-end')?.value || '');
    });
    document.querySelectorAll('.lote-preset-btn').forEach(b => b.addEventListener('click', () => applyLotePreset(b.dataset.lotePreset)));
    ['lote-fac-desde', 'lote-fac-hasta', 'lote-fac-incluir-rec'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (id !== 'lote-fac-incluir-rec') {
          document.querySelectorAll('.lote-preset-btn').forEach(b => {
            b.className = 'lote-preset-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer';
          });
        }
        refreshLotePreview();
      });
    });
    const closeLote = () => document.getElementById('modal-lote-facturas').classList.add('hidden');
    document.getElementById('lote-fac-close')?.addEventListener('click', closeLote);
    document.getElementById('lote-fac-cancel')?.addEventListener('click', closeLote);

    document.getElementById('lote-fac-download')?.addEventListener('click', async () => {
      showGlobalSpinner('Generando PDF con todas las facturas...');
      try {
        const res = await buildLotePdf();
        if (res) {
          dl(res.blob, res.filename);
          showToast(`PDF con ${res.count} factura(s) descargado`, 'success');
          closeLote();
        }
      } finally { hideGlobalSpinner(); }
    });
    document.getElementById('lote-fac-share')?.addEventListener('click', async () => {
      showGlobalSpinner('Generando PDF con todas las facturas...');
      try {
        const res = await buildLotePdf();
        if (res) {
          await share(res.blob, res.filename, 'Facturas babyluc');
          closeLote();
        }
      } finally { hideGlobalSpinner(); }
    });
    document.getElementById('lote-fac-csv')?.addEventListener('click', async () => {
      const { invalidRange, desde, hasta, docs } = await collectLoteDocs();
      if (invalidRange) return showToast('Revisa el rango de fechas', 'warning');
      if (!docs.length) return showToast('No hay facturas en ese período', 'warning');
      generateCSV(
        ['Fecha', 'Nº Factura', 'Tipo', 'Pedido', 'Cliente', 'NIF/CIF', 'Base 21%', 'IVA 21%', 'Total'],
        docs.map(d => [d.ymd, d.docNum, d.type === 'rec' ? 'Rectificativa' : 'Factura', d.p.numero || '', d.cli?.nombre || d.p.nombreCliente || '', d.cli?.nif || '', d.sb.toFixed(2), d.sc.toFixed(2), d.st.toFixed(2)]),
        `babyluc_facturas_${desde || 'inicio'}_a_${hasta || 'hoy'}`
      );
    });
  }
  return { init, abrirAlbaran, abrirAlbaranBolsa, abrirFactura, abrirRectificativa, openLoteModal };
})();

window.openAlbaranBolsa = (pedidoIds, extraPorte = null) => DocumentosModule.abrirAlbaranBolsa(pedidoIds, extraPorte);

// ==================== 9. MÓDULO BALANCES ====================
const BalancesModule = (() => {
  const ESTADOS_FACT = new Set(['pagado', 'enviado', 'completado']);
  const ESTADOS_ORD = [
    { key: 'pendiente_pago', label: 'Pendiente pago', cls: 'bg-gray-100 text-gray-700' },
    { key: 'pagado', label: 'Pagado', cls: 'bg-orange-100 text-orange-800' },
    { key: 'enviado', label: 'Enviado', cls: 'bg-blue-100 text-blue-800' },
    { key: 'completado', label: 'Completado', cls: 'bg-green-100 text-green-800' },
    { key: 'cancelado', label: 'Cancelado', cls: 'bg-red-100 text-red-700' }
  ];
  const state = { preset: 'mes', startDate: null, endDate: null, chartData: [], chartBars: [], hovered: -1 };
  const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseD = (v) => { if (!v) return null; const s = String(v).trim(); const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s); return Number.isNaN(d.getTime()) ? null : d; };

  function getRange(preset) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
    if (preset === 'hoy') return { start: new Date(y, m, d, 0, 0, 0), end: new Date(y, m, d, 23, 59, 59) };
    if (preset === 'semana') { const dow = (n.getDay() + 6) % 7; const s = new Date(y, m, d - dow, 0, 0, 0); return { start: s, end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6, 23, 59, 59) }; }
    if (preset === 'mes') return { start: new Date(y, m, 1, 0, 0, 0), end: new Date(y, m + 1, 0, 23, 59, 59) };
    if (preset === 'trimestre') { const q = Math.floor(m / 3) * 3; return { start: new Date(y, q, 1, 0, 0, 0), end: new Date(y, q + 3, 0, 23, 59, 59) }; }
    return { start: new Date(y, 0, 1, 0, 0, 0), end: new Date(y, 11, 31, 23, 59, 59) };
  }

  function syncUI() {
    document.querySelectorAll('.bal-preset-btn').forEach(b => {
      const a = b.dataset.preset === state.preset;
      b.className = a ? 'bal-preset-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#B6BEB2] bg-[#F5F7F4] text-gray-900 cursor-pointer'
        : 'bal-preset-btn px-3 py-1.5 rounded-xl text-xs font-semibold border border-gray-200 bg-gray-50 text-gray-700 cursor-pointer';
    });
    document.getElementById('bal-date-start').value = toYMD(state.startDate);
    document.getElementById('bal-date-end').value = toYMD(state.endDate);
    document.getElementById('bal-rango-label').textContent = `Período del ${state.startDate.toLocaleDateString('es-ES')} al ${state.endDate.toLocaleDateString('es-ES')}`;
  }

  async function calculate() {
    document.getElementById('balances-spinner').classList.remove('hidden');
    try {
      const [peds, lineas, facs] = await Promise.all([db.pedidos.toArray(), db.lineasPedido.toArray(), db.facturas_compra.toArray()]);
      const lByP = new Map();
      lineas.forEach(l => { if (!lByP.has(l.pedidoId)) lByP.set(l.pedidoId, []); lByP.get(l.pedidoId).push(l); });

      const sMs = state.startDate.getTime(), eMs = state.endDate.getTime();
      const ps = new Date(state.startDate); ps.setFullYear(ps.getFullYear() - 1);
      const pe = new Date(state.endDate); pe.setFullYear(pe.getFullYear() - 1);
      const curPeds = [], prevPeds = [];
      for (const p of peds) {
        const d = parseD(p.fecha); if (!d) continue;
        const ls = lByP.get(p.id) || [];
        const en = { ...p, _d: d, _tot: calcPedidoTotales(p, ls).totalNeto, _ls: ls };
        if (d.getTime() >= sMs && d.getTime() <= eMs) curPeds.push(en);
        else if (d.getTime() >= ps.getTime() && d.getTime() <= pe.getTime()) prevPeds.push(en);
      }
      const curFacs = facs.filter(f => { const d = parseD(f.fecha); return d && d.getTime() >= sMs && d.getTime() <= eMs; });
      const pagados = curPeds.filter(p => ESTADOS_FACT.has(p.estado));
      const facturado = pagados.reduce((a, p) => a + p._tot, 0);
      const compras = curFacs.reduce((a, f) => a + Number(f.total ?? (Number(f.baseImponible || 0) + Number(f.cuotaIVA || 0) + Number(f.recargoEquivalencia || 0))), 0);
      const margen = facturado - compras;

      document.getElementById('bal-kpi-facturado').textContent = fmtEur(facturado);
      document.getElementById('bal-kpi-pedidos').textContent = String(curPeds.length);
      document.getElementById('bal-kpi-pedidos-sub').textContent = `${pagados.length} pagado(s)`;
      document.getElementById('bal-kpi-compras').textContent = fmtEur(compras);
      document.getElementById('bal-kpi-compras-sub').textContent = `${curFacs.length} factura(s)`;
      const mEl = document.getElementById('bal-kpi-margen');
      mEl.textContent = fmtEur(margen); mEl.className = `text-2xl font-bold mt-1.5 ${margen >= 0 ? 'text-green-700' : 'text-red-600'}`;
      document.getElementById('bal-kpi-ticket').textContent = fmtEur(pagados.length ? facturado / pagados.length : 0);

      document.getElementById('bal-estados-tbody').innerHTML = ESTADOS_ORD.map(e => {
        const sub = curPeds.filter(p => p.estado === e.key);
        return `<tr><td class="px-3 py-2"><span class="px-2 py-0.5 rounded text-xs font-semibold ${e.cls}">${e.label}</span></td><td class="px-3 py-2 text-center font-semibold">${sub.length}</td><td class="px-3 py-2 text-right font-semibold">${fmtEur(sub.reduce((a, p) => a + p._tot, 0))}</td></tr>`;
      }).join('');

      buildChart(pagados);

      const artMap = new Map();
      pagados.forEach(p => {
        const devMap = new Map();
        (p.devoluciones || []).forEach(d => (d.items || []).forEach(it => devMap.set(it.lineaId, (devMap.get(it.lineaId) || 0) + Number(it.cantidad || 0))));
        p._ls.forEach(l => {
          if (Number(l.precioUnitario || 0) <= 0 || l.descripcionVariante === 'Portes' || l.descripcionVariante === 'Descuento' || String(l.descripcionVariante || '').startsWith('Descuento (')) return;
          const uNetas = Math.max(0, Number(l.cantidad || 0) - (devMap.get(l.id) || 0));
          if (uNetas <= 0) return;
          if (!artMap.has(l.nombreArticulo)) artMap.set(l.nombreArticulo, { n: l.nombreArticulo, u: 0, i: 0, v: new Map() });
          const e = artMap.get(l.nombreArticulo); e.u += uNetas; e.i += uNetas * Number(l.precioUnitario || 0);
          e.v.set(l.descripcionVariante || 'Única', (e.v.get(l.descripcionVariante || 'Única') || 0) + uNetas);
        });
      });
      const topA = [...artMap.values()].sort((a, b) => b.u - a.u).slice(0, 5);
      document.getElementById('bal-top-art-empty').classList.toggle('hidden', topA.length > 0);
      document.getElementById('bal-top-articulos-tbody').innerHTML = topA.map(a => {
        const vt = [...a.v.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '—';
        return `<tr><td class="px-3 py-2 font-medium">${esc(a.n)}</td><td class="px-3 py-2 text-xs text-gray-500">${esc(vt)}</td><td class="px-3 py-2 text-center font-semibold">${a.u}</td><td class="px-3 py-2 text-right font-semibold">${fmtEur(a.i)}</td></tr>`;
      }).join('');

      const cliMap = new Map();
      pagados.forEach(p => {
        const k = p.clienteId || p.nombreCliente || 'Sin cliente';
        if (!cliMap.has(k)) cliMap.set(k, { id: p.clienteId, n: p.nombreCliente || 'Cliente', c: 0, t: 0 });
        const e = cliMap.get(k); e.c++; e.t += p._tot;
      });
      const topC = [...cliMap.values()].sort((a, b) => b.t - a.t).slice(0, 5);
      document.getElementById('bal-top-cli-empty').classList.toggle('hidden', topC.length > 0);
      document.getElementById('bal-top-clientes-tbody').innerHTML = topC.map(c => `<tr><td class="px-3 py-2 font-medium">${esc(c.n)}</td><td class="px-3 py-2 text-center">${c.c}</td><td class="px-3 py-2 text-right font-semibold">${fmtEur(c.t)}</td></tr>`).join('');

      document.getElementById('bal-comp-rango').textContent = `vs ${ps.toLocaleDateString('es-ES')} – ${pe.toLocaleDateString('es-ES')}`;
      const prevF = prevPeds.filter(p => ESTADOS_FACT.has(p.estado)).reduce((a, p) => a + p._tot, 0);
      document.getElementById('bal-comp-empty').classList.toggle('hidden', prevPeds.length > 0);
      document.getElementById('bal-comp-content').classList.toggle('hidden', prevPeds.length === 0);
      if (prevPeds.length) {
        const mk = (t, a, b, eur) => {
          const pct = b > 0 ? ((a - b) / b) * 100 : (a > 0 ? 100 : 0);
          const arrow = pct >= 0 ? `<span class="text-green-700 font-bold">▲ +${pct.toFixed(1)}%</span>` : `<span class="text-red-600 font-bold">▼ ${pct.toFixed(1)}%</span>`;
          return `<div class="p-4 rounded-xl bg-gray-50 border border-gray-200 flex justify-between items-center"><div><p class="text-xs text-gray-500">${t}</p><p class="text-lg font-bold">${eur ? fmtEur(a) : a}</p><p class="text-xs text-gray-400">Año ant.: ${eur ? fmtEur(b) : b}</p></div>${arrow}</div>`;
        };
        document.getElementById('bal-comp-content').innerHTML = mk('Facturación', facturado, prevF, true) + mk('Nº Pedidos', curPeds.length, prevPeds.length, false);
      }
    } finally { document.getElementById('balances-spinner').classList.add('hidden'); }
  }

  function buildChart(pagados) {
    const days = Math.round((state.endDate - state.startDate) / 86400000) + 1;
    const mode = days < 15 ? 'dia' : days <= 93 ? 'semana' : 'mes';
    document.getElementById('bal-chart-granularity').textContent = mode === 'dia' ? 'Agrupado por días' : mode === 'semana' ? 'Agrupado por semanas' : 'Agrupado por meses';
    const b = new Map(), cur = new Date(state.startDate.getFullYear(), state.startDate.getMonth(), state.startDate.getDate()), end = new Date(state.endDate.getFullYear(), state.endDate.getMonth(), state.endDate.getDate());
    if (mode === 'dia') {
      while (cur <= end) { b.set(toYMD(cur), { label: cur.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), value: 0, count: 0 }); cur.setDate(cur.getDate() + 1); }
      pagados.forEach(p => { const k = toYMD(p._d); if (b.has(k)) { b.get(k).value += p._tot; b.get(k).count++; } });
    } else if (mode === 'semana') {
      const wk = d => { const c = new Date(d.getFullYear(), d.getMonth(), d.getDate()); c.setDate(c.getDate() - ((c.getDay() + 6) % 7)); return c; };
      let wc = wk(cur), we = wk(end);
      while (wc <= we) { b.set(toYMD(wc), { label: 'Sem ' + wc.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), value: 0, count: 0 }); wc.setDate(wc.getDate() + 7); }
      pagados.forEach(p => { const k = toYMD(wk(p._d)); if (b.has(k)) { b.get(k).value += p._tot; b.get(k).count++; } });
    } else {
      let mc = new Date(cur.getFullYear(), cur.getMonth(), 1), me = new Date(end.getFullYear(), end.getMonth(), 1);
      while (mc <= me) { b.set(`${mc.getFullYear()}-${mc.getMonth()}`, { label: mc.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }), value: 0, count: 0 }); mc.setMonth(mc.getMonth() + 1); }
      pagados.forEach(p => { const k = `${p._d.getFullYear()}-${p._d.getMonth()}`; if (b.has(k)) { b.get(k).value += p._tot; b.get(k).count++; } });
    }
    state.chartData = [...b.values()];
    document.getElementById('bal-chart-empty').classList.toggle('hidden', state.chartData.some(x => x.value > 0));
    drawChart();
  }

  function drawChart() {
    const c = document.getElementById('bal-chart-canvas'); if (!c) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth || 500, h = c.clientHeight || 250;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    state.chartBars = []; if (!state.chartData.length) return;
    const pL = 50, pR = 14, pT = 16, pB = 30, pw = w - pL - pR, ph = h - pT - pB, maxV = Math.max(...state.chartData.map(d => d.value), 10);
    const sw = pw / state.chartData.length, bw = Math.min(40, Math.max(8, sw * 0.6));
    state.chartData.forEach((d, i) => {
      const bh = (d.value / maxV) * ph, x = pL + i * sw + (sw - bw) / 2, y = pT + ph - bh;
      state.chartBars.push({ x: pL + i * sw, y: pT, w: sw, h: ph, ...d });
      ctx.fillStyle = i === state.hovered ? '#727D6E' : '#B6BEB2';
      ctx.fillRect(x, y, bw, bh);
      if (i % Math.max(1, Math.ceil(state.chartData.length / 8)) === 0) {
        ctx.fillStyle = '#6B7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(d.label, x + bw / 2, pT + ph + 14);
      }
    });
  }

  function init() {
    const yNow = new Date().getFullYear();
    document.getElementById('bal-year-select').innerHTML = `<option value="">Año concreto...</option><option value="${yNow}">${yNow}</option><option value="${yNow - 1}">${yNow - 1}</option>`;
    document.querySelectorAll('.bal-preset-btn').forEach(b => b.addEventListener('click', () => {
      state.preset = b.dataset.preset; const r = getRange(state.preset); state.startDate = r.start; state.endDate = r.end; syncUI(); calculate();
    }));
    document.getElementById('bal-year-select').addEventListener('change', e => {
      const y = Number(e.target.value); if (!y) return;
      state.preset = null; state.startDate = new Date(y, 0, 1, 0, 0, 0); state.endDate = new Date(y, 11, 31, 23, 59, 59); syncUI(); calculate();
    });
    const onD = () => {
      const s = document.getElementById('bal-date-start').value, e = document.getElementById('bal-date-end').value;
      if (s && e) { state.preset = null; state.startDate = new Date(`${s}T00:00:00`); state.endDate = new Date(`${e}T23:59:59`); syncUI(); calculate(); }
    };
    document.getElementById('bal-date-start').addEventListener('change', onD);
    document.getElementById('bal-date-end').addEventListener('change', onD);

    const canvas = document.getElementById('bal-chart-canvas'), tip = document.getElementById('bal-chart-tooltip');
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left;
      const idx = state.chartBars.findIndex(b => mx >= b.x && mx <= b.x + b.w);
      if (idx !== state.hovered) { state.hovered = idx; drawChart(); }
      if (idx >= 0) {
        const b = state.chartBars[idx];
        tip.innerHTML = `<strong>${esc(b.label)}</strong>: ${fmtEur(b.value)} (${b.count})`;
        tip.style.left = `${Math.min(r.width - 140, Math.max(8, mx + 10))}px`; tip.style.top = '10px'; tip.classList.remove('hidden');
      } else tip.classList.add('hidden');
    });
    canvas.addEventListener('mouseleave', () => { tip.classList.add('hidden'); state.hovered = -1; drawChart(); });

    const r = getRange('mes'); state.startDate = r.start; state.endDate = r.end; syncUI();
  }
  return { init, onEnterView: () => { syncUI(); calculate(); } };
})();

// ==================== 10. MÓDULO IMPUESTOS (MODELO 303 + RE) ====================
const ImpuestosModule = (() => {
  const ESTADOS_FACT = new Set(['pagado', 'enviado', 'completado']);
  const CHIPS = { pendiente: { l: '🟡 Pendiente', c: 'bg-amber-100 text-amber-800' }, pagado: { l: '✅ Pagado', c: 'bg-green-100 text-green-800' }, aplazado: { l: '🔵 Aplazado', c: 'bg-blue-100 text-blue-800' } };
  let curRegId = null, estRegId = null;
  const parseD = v => { if (!v) return null; const s = String(v).trim(); const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s); return Number.isNaN(d.getTime()) ? null : d; };

  async function calcTrimestre(año, trim, maxD = null) {
    const sm = (trim - 1) * 3, start = new Date(año, sm, 1, 0, 0, 0), end = new Date(año, sm + 3, 0, 23, 59, 59);
    const lim = maxD && maxD < end ? maxD : end;
    const [peds, lineas, facs] = await Promise.all([db.pedidos.toArray(), db.lineasPedido.toArray(), db.facturas_compra.toArray()]);
    const lsByPed = new Map();
    lineas.forEach(l => { if (!lsByPed.has(l.pedidoId)) lsByPed.set(l.pedidoId, []); lsByPed.get(l.pedidoId).push(l); });
    const g = { 21: { b: 0, c: 0 }, 10: { b: 0, c: 0 }, 4: { b: 0, c: 0 } };
    peds.forEach(p => {
      if (!ESTADOS_FACT.has(p.estado)) return;
      const d = parseD(p.fechaPago); if (!d || d < start || d > lim) return;
      const tot = calcPedidoTotales(p, lsByPed.get(p.id) || []).totalNeto;
      const base = tot / 1.21;
      g[21].b += base; g[21].c += (tot - base);
    });
    const desgloseIVA = { 21: { base: round2(g[21].b), cuota: round2(g[21].c) }, 10: { base: round2(g[10].b), cuota: round2(g[10].c) }, 4: { base: round2(g[4].b), cuota: round2(g[4].c) } };
    const re = { 21: 0, 10: 0, 4: 0, total: 0 };
    facs.forEach(f => {
      const d = parseD(f.fecha); if (!d || d < start || d > lim) return;
      const rt = Number(f.recargoEquivalencia || 0); if (rt <= 0) return;
      re[21] += rt; re.total += rt;
    });
    return {
      desgloseIVA,
      baseTotal: round2(desgloseIVA[21].base + desgloseIVA[10].base + desgloseIVA[4].base),
      totalIVA: round2(desgloseIVA[21].cuota + desgloseIVA[10].cuota + desgloseIVA[4].cuota),
      reInformativo: { 21: round2(re[21]), 10: round2(re[10]), 4: round2(re[4]), total: round2(re.total) }
    };
  }

  async function generarTrimestresPasadosPendientes() {
    const now = new Date(), yN = now.getFullYear(), tN = Math.floor(now.getMonth() / 3) + 1, idxN = yN * 4 + (tN - 1);
    const [peds, facs, regs] = await Promise.all([db.pedidos.toArray(), db.facturas_compra.toArray(), db.registros_iva.toArray()]);
    const ex = new Set(regs.map(r => `${r.año}-${r.trimestre}`));
    let minIdx = null;
    const chk = v => { const d = parseD(v); if (!d) return; const idx = d.getFullYear() * 4 + Math.floor(d.getMonth() / 3); if (idx < idxN && (minIdx === null || idx < minIdx)) minIdx = idx; };
    peds.forEach(p => ESTADOS_FACT.has(p.estado) && chk(p.fechaPago));
    facs.forEach(f => chk(f.fecha));
    if (minIdx === null) return;
    let gen = 0;
    for (let idx = minIdx; idx < idxN; idx++) {
      const a = Math.floor(idx / 4), t = (idx % 4) + 1;
      if (ex.has(`${a}-${t}`)) continue;
      const c = await calcTrimestre(a, t);
      await db.registros_iva.add({ trimestre: t, año: a, estado: 'pendiente', fechaGeneracion: new Date().toISOString(), fechaPago: null, notas: '', baseImponible: c.baseTotal, totalIVA: c.totalIVA, desgloseIVA: c.desgloseIVA, reInformativo: c.reInformativo });
      gen++;
    }
    if (gen > 0) showToast(`Se han generado ${gen} registros trimestrales pendientes`, 'warning');
  }

  async function refresh() {
    const now = new Date(), y = now.getFullYear(), t = Math.floor(now.getMonth() / 3) + 1;
    document.getElementById('imp-curso-titulo').textContent = `Trimestre ${t} - ${y}`;
    const lim = t === 1 ? new Date(y, 3, 20) : t === 2 ? new Date(y, 6, 20) : t === 3 ? new Date(y, 9, 20) : new Date(y + 1, 0, 20);
    document.getElementById('imp-curso-limite').textContent = lim.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    const dias = Math.ceil((lim - now) / 86400000);
    const b = document.getElementById('imp-curso-dias-badge');
    b.textContent = dias >= 0 ? `${dias} días restantes` : 'Plazo vencido';
    b.className = `px-3.5 py-2 rounded-xl text-xs font-bold border ${dias > 30 ? 'bg-green-50 text-green-700 border-green-200' : dias >= 10 ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-red-50 text-red-700 border-red-200'}`;

    const c = await calcTrimestre(y, t, now);
    const ivasVisibles = [21, 10, 4].filter(tp => tp === 21 || (c.desgloseIVA?.[tp]?.base || 0) > 0 || (c.desgloseIVA?.[tp]?.cuota || 0) > 0);
    document.getElementById('imp-curso-iva-tbody').innerHTML = ivasVisibles.map(tp => `<tr><td class="px-4 py-2 font-medium">IVA ${tp}%</td><td class="px-4 py-2 text-right">${fmtEur(c.desgloseIVA[tp].base)}</td><td class="px-4 py-2 text-right">${fmtEur(c.desgloseIVA[tp].cuota)}</td><td class="px-4 py-2 text-right font-semibold">${fmtEur(c.desgloseIVA[tp].cuota)}</td></tr>`).join('') +
      `<tr class="bg-[#F5F7F4]"><td class="px-4 py-3 font-bold">TOTAL A INGRESAR (Modelo 303)</td><td class="px-4 py-3 text-right font-semibold">${fmtEur(c.baseTotal)}</td><td class="px-4 py-3 text-right font-semibold">${fmtEur(c.totalIVA)}</td><td class="px-4 py-3 text-right font-bold text-base">${fmtEur(c.totalIVA)}</td></tr>`;
    document.getElementById('imp-curso-re-grid').innerHTML = `<div class="bg-white border border-gray-200 rounded-lg p-2.5"><span class="text-gray-400 block">Total RE proveedores</span><strong>${fmtEur(c.reInformativo.total)}</strong></div>`;

    const regs = (await db.registros_iva.toArray()).sort((a, b) => (b.año - a.año) || (b.trimestre - a.trimestre));
    document.getElementById('imp-historial-empty').classList.toggle('hidden', regs.length > 0);
    document.getElementById('imp-historial-tbody').innerHTML = regs.map(r => {
      const ch = CHIPS[r.estado] || CHIPS.pendiente;
      return `<tr class="hover:bg-gray-50 cursor-pointer" data-rdet="${r.id}"><td class="px-4 py-3 font-bold">${r.trimestre}T - ${r.año}</td><td class="px-4 py-3 text-right">${fmtEur(r.baseImponible)}</td><td class="px-4 py-3 text-right font-bold">${fmtEur(r.totalIVA)}</td><td class="px-4 py-3 text-center"><span class="px-2.5 py-1 rounded-lg text-xs font-semibold ${ch.c}">${ch.l}</span></td><td class="px-4 py-3 text-right" onclick="event.stopPropagation()"><button type="button" data-rdet="${r.id}" class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 mr-1 cursor-pointer">Detalle</button><button type="button" data-rest="${r.id}" class="px-2.5 py-1 text-xs rounded-lg border border-[#B6BEB2] bg-[#F5F7F4] cursor-pointer">Estado</button></td></tr>`;
    }).join('');
  }

  function init() {
    const yNow = new Date().getFullYear();
    document.getElementById('imp-gen-anio').innerHTML = [0, 1, 2, 3].map(i => `<option value="${yNow - i}">${yNow - i}</option>`).join('');
    document.querySelectorAll('[data-bal-tab]').forEach(b => b.addEventListener('click', () => {
      const imp = b.dataset.balTab === 'impuestos';
      document.getElementById('balances-tab-resumen').classList.toggle('hidden', imp);
      document.getElementById('balances-tab-impuestos').classList.toggle('hidden', !imp);
      document.getElementById('bal-tab-btn-impuestos').className = imp ? 'px-4 py-2 rounded-xl text-sm font-semibold bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] cursor-pointer' : 'px-4 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 cursor-pointer';
      document.getElementById('bal-tab-btn-resumen').className = !imp ? 'px-4 py-2 rounded-xl text-sm font-semibold bg-[#F5F7F4] text-gray-900 border border-[#B6BEB2] cursor-pointer' : 'px-4 py-2 rounded-xl text-sm font-semibold bg-white text-gray-600 border border-gray-200 cursor-pointer';
      if (imp) refresh(); else BalancesModule.onEnterView();
    }));

    document.getElementById('imp-btn-generar').addEventListener('click', async () => {
      const t = Number(document.getElementById('imp-gen-trimestre').value), a = Number(document.getElementById('imp-gen-anio').value);
      const c = await calcTrimestre(a, t);
      const ex = await db.registros_iva.where('[año+trimestre]').equals([a, t]).first();
      if (ex) await db.registros_iva.update(ex.id, { fechaGeneracion: new Date().toISOString(), baseImponible: c.baseTotal, totalIVA: c.totalIVA, desgloseIVA: c.desgloseIVA, reInformativo: c.reInformativo });
      else await db.registros_iva.add({ trimestre: t, año: a, estado: 'pendiente', fechaGeneracion: new Date().toISOString(), fechaPago: null, notas: '', baseImponible: c.baseTotal, totalIVA: c.totalIVA, desgloseIVA: c.desgloseIVA, reInformativo: c.reInformativo });
      showToast(`Registro ${t}T - ${a} actualizado`, 'success'); refresh();
    });

    document.getElementById('imp-historial-tbody').addEventListener('click', async e => {
      const be = e.target.closest('[data-rest]');
      if (be) { estRegId = Number(be.dataset.rest); document.getElementById('modal-trimestre-estado').classList.remove('hidden'); return; }
      const bd = e.target.closest('[data-rdet]');
      if (bd) {
        curRegId = Number(bd.dataset.rdet); const r = await db.registros_iva.get(curRegId); if (!r) return;
        document.getElementById('tdet-titulo').textContent = `Trimestre ${r.trimestre} - ${r.año}`;
        document.getElementById('tdet-total-303').textContent = fmtEur(r.totalIVA);
        document.getElementById('tdet-notas').value = r.notas || '';
        const ivasDet = [21, 10, 4].filter(t => t === 21 || (r.desgloseIVA?.[t]?.base || 0) > 0 || (r.desgloseIVA?.[t]?.cuota || 0) > 0);
        document.getElementById('tdet-iva-tbody').innerHTML = ivasDet.map(t => `<tr><td class="px-3 py-2">IVA ${t}%</td><td class="px-3 py-2 text-right">${fmtEur(r.desgloseIVA?.[t]?.base)}</td><td class="px-3 py-2 text-right font-semibold">${fmtEur(r.desgloseIVA?.[t]?.cuota)}</td></tr>`).join('');
        document.getElementById('modal-trimestre-detalle').classList.remove('hidden');
      }
    });
    document.getElementById('tdet-close').addEventListener('click', () => document.getElementById('modal-trimestre-detalle').classList.add('hidden'));
    document.getElementById('tdet-btn-save-notas').addEventListener('click', async () => { await db.registros_iva.update(curRegId, { notas: document.getElementById('tdet-notas').value.trim() }); showToast('Notas guardadas', 'success'); });
    document.getElementById('tdet-btn-cambiar-estado').addEventListener('click', () => { estRegId = curRegId; document.getElementById('modal-trimestre-estado').classList.remove('hidden'); });
    document.getElementById('test-select').addEventListener('change', e => document.getElementById('test-fecha-wrap').classList.toggle('hidden', e.target.value !== 'pagado'));
    document.getElementById('test-cancel').addEventListener('click', () => document.getElementById('modal-trimestre-estado').classList.add('hidden'));
    document.getElementById('test-save').addEventListener('click', async () => {
      const est = document.getElementById('test-select').value;
      const fp = est === 'pagado' ? (document.getElementById('test-fecha-pago').value || new Date().toISOString().slice(0, 10)) : null;
      await db.registros_iva.update(estRegId, { estado: est, fechaPago: fp });
      document.getElementById('modal-trimestre-estado').classList.add('hidden');
      showToast('Estado actualizado', 'success'); refresh();
    });
  }

  return { init: async () => { init(); await generarTrimestresPasadosPendientes(); }, refresh };
})();

// ==================== 11. TRANSVERSALES (CTRL+K, PIN, PROVEEDORES, CSV) ====================
const GlobalSearchModule = (() => {
  function open() {
    document.getElementById('modal-global-search').classList.remove('hidden');
    const i = document.getElementById('global-search-input'); i.value = '';
    document.getElementById('global-search-results').innerHTML = '<p class="text-center text-xs text-gray-400 py-6">Escribe para buscar artículos, clientes o pedidos.</p>';
    setTimeout(() => i.focus(), 30);
  }
  function close() { document.getElementById('modal-global-search').classList.add('hidden'); }
  function init() {
    document.getElementById('btn-open-global-search').addEventListener('click', open);
    document.getElementById('global-search-close').addEventListener('click', close);
    document.getElementById('global-search-input').addEventListener('input', async e => {
      const q = e.target.value.trim().toLowerCase(), box = document.getElementById('global-search-results');
      if (!q) { box.innerHTML = '<p class="text-center text-xs text-gray-400 py-6">Escribe para buscar...</p>'; return; }
      const [arts, clis, peds, provs] = await Promise.all([db.articulos.toArray(), db.clientes.toArray(), db.pedidos.toArray(), db.proveedores.toArray()]);
      const rA = arts.filter(a => a.activo !== false && ((a.nombre || '').toLowerCase().includes(q) || (a.codigo || '').toLowerCase().includes(q) || (a.aliases || []).some(al => (al || '').toLowerCase().includes(q)))).slice(0, 5);
      const rC = clis.filter(c => (c.nombre || '').toLowerCase().includes(q) || (c.telefono || '').toLowerCase().includes(q)).slice(0, 5);
      const rPr = provs.filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.CIF || '').toLowerCase().includes(q)).slice(0, 5);
      const rP = peds.filter(p => (p.numero || '').toLowerCase().includes(q) || (p.nombreCliente || '').toLowerCase().includes(q)).slice(0, 5);
      box.innerHTML = (rA.length ? `<div class="space-y-1"><p class="text-[11px] font-bold uppercase text-gray-400">📦 Artículos</p>${rA.map(a => `<button type="button" data-gs="art:${a.id}" class="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F5F7F4] cursor-pointer">${esc(a.nombre)}${a.codigo ? ` <span class="text-xs font-mono text-gray-400">[${esc(a.codigo)}]</span>` : ''}</button>`).join('')}</div>` : '') +
        (rC.length ? `<div class="space-y-1"><p class="text-[11px] font-bold uppercase text-gray-400">👥 Clientes</p>${rC.map(c => `<button type="button" data-gs="cli:${c.id}" class="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F5F7F4] cursor-pointer">${esc(c.nombre)} · ${esc(c.telefono)}</button>`).join('')}</div>` : '') +
        (rPr.length ? `<div class="space-y-1"><p class="text-[11px] font-bold uppercase text-gray-400">🚚 Proveedores</p>${rPr.map(p => `<button type="button" data-gs="prov:${p.id}" class="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F5F7F4] cursor-pointer">${esc(p.nombre)}${p.CIF ? ' · ' + esc(p.CIF) : ''}</button>`).join('')}</div>` : '') +
        (rP.length ? `<div class="space-y-1"><p class="text-[11px] font-bold uppercase text-gray-400">🛍️ Pedidos</p>${rP.map(p => `<button type="button" data-gs="ped:${p.id}" class="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F5F7F4] cursor-pointer"><strong>${esc(p.numero)}</strong> · ${esc(p.nombreCliente)}</button>`).join('')}</div>` : '') ||
        '<p class="text-center text-xs text-gray-400 py-6">Sin resultados.</p>';
    });
    document.getElementById('global-search-results').addEventListener('click', e => {
      const b = e.target.closest('[data-gs]'); if (!b) return;
      const [t, id] = b.dataset.gs.split(':'); close();
      if (t === 'art') { navigateTo('stock'); StockModule.openArticuloModal(Number(id)); }
      if (t === 'cli') window.openClienteFicha(Number(id));
      if (t === 'prov') window.openProveedorFicha(Number(id));
      if (t === 'ped') window.openPedidoDetalle(Number(id));
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
      else if (e.key === 'Escape') close();
    });
  }
  return { init };
})();

const PinAndAjustesExtra = (() => {
  let entered = '', attempts = 0, lockedUntil = 0;
  const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const renderDots = () => document.querySelectorAll('#pin-dots .pin-dot').forEach((d, i) => { d.classList.toggle('bg-[#B6BEB2]', i < entered.length); d.classList.toggle('bg-white', i >= entered.length); });

  async function checkPin() {
    if (entered.length < 6) return;
    const emp = await db.empresa.get(1);
    if ((await sha256(entered)) === emp?.pinHash) {
      entered = ''; attempts = 0; document.getElementById('pin-lock-screen').classList.add('hidden'); renderDots();
    } else {
      attempts++; entered = ''; renderDots();
      if (attempts >= 3) {
        lockedUntil = Date.now() + 30000;
        const iv = setInterval(() => {
          const s = Math.ceil((lockedUntil - Date.now()) / 1000);
          document.getElementById('pin-error-msg').textContent = s > 0 ? `Bloqueado ${s}s...` : '';
          if (s <= 0) { clearInterval(iv); attempts = 0; }
        }, 250);
      } else document.getElementById('pin-error-msg').textContent = `PIN incorrecto (${attempts}/3)`;
    }
  }

  async function refreshAjustesExtra() {
    const emp = (await db.empresa.get(1)) || {};
    document.getElementById('aj-pin-activo').checked = Boolean(emp.pinActivo);
    document.getElementById('aj-pin-status').textContent = emp.pinHash ? (emp.pinActivo ? 'PIN activo' : 'PIN desactivado') : 'Sin PIN';
    const up = emp.ultimoNumeroPedido, uf = emp.ultimoNumeroFactura;
    document.getElementById('aj-cont-pedido').textContent = up?.numero ? `BLC-${String(up.año).slice(-2)}${String(up.numero).padStart(4, '0')}` : 'Ninguno';
    document.getElementById('aj-cont-factura').textContent = uf?.numero ? `FAC-${uf.año}-${String(uf.numero).padStart(4, '0')}` : 'Ninguna';
  }

  function init() {
    document.getElementById('pin-keypad').addEventListener('click', e => {
      const b = e.target.closest('[data-pin-key]'); if (!b || Date.now() < lockedUntil) return;
      const k = b.dataset.pinKey;
      if (k === 'clear') entered = ''; else if (k === 'back') entered = entered.slice(0, -1); else if (entered.length < 6) entered += k;
      renderDots(); checkPin();
    });
    document.getElementById('aj-pin-activo').addEventListener('change', async e => {
      const emp = (await db.empresa.get(1)) || { id: 1 };
      if (e.target.checked && !emp.pinHash) { e.target.checked = false; document.getElementById('aj-btn-config-pin').click(); return; }
      await db.empresa.put({ ...emp, id: 1, pinActivo: e.target.checked });
      showToast(e.target.checked ? 'PIN activado' : 'PIN desactivado', 'success'); refreshAjustesExtra();
    });
    document.getElementById('aj-btn-config-pin').addEventListener('click', async () => {
      const emp = await db.empresa.get(1);
      document.getElementById('mpin-actual-wrap').classList.toggle('hidden', !emp?.pinHash);
      document.getElementById('modal-ajustes-pin').classList.remove('hidden');
    });
    document.getElementById('mpin-close').addEventListener('click', () => document.getElementById('modal-ajustes-pin').classList.add('hidden'));
    document.getElementById('mpin-save').addEventListener('click', async () => {
      const emp = (await db.empresa.get(1)) || { id: 1 };
      if (emp.pinHash && (await sha256(document.getElementById('mpin-actual').value.trim())) !== emp.pinHash) return showToast('PIN actual incorrecto', 'error');
      const n = document.getElementById('mpin-nuevo').value.trim(), c = document.getElementById('mpin-confirm').value.trim();
      if (!/^\d{6}$/.test(n) || n !== c) return showToast('El PIN debe tener 6 dígitos y coincidir', 'warning');
      await db.empresa.put({ ...emp, id: 1, pinHash: await sha256(n), pinActivo: true });
      document.getElementById('modal-ajustes-pin').classList.add('hidden');
      showToast('PIN configurado', 'success'); refreshAjustesExtra();
    });
    document.querySelectorAll('[data-reset-counter]').forEach(b => b.addEventListener('click', async () => {
      const emp = (await db.empresa.get(1)) || { id: 1 }, año = new Date().getFullYear();
      if (b.dataset.resetCounter === 'pedido') emp.ultimoNumeroPedido = { año, numero: 0 };
      else emp.ultimoNumeroFactura = { año, numero: 0 };
      await db.empresa.put({ ...emp, id: 1 });
      showToast('Contador reseteado', 'success'); refreshAjustesExtra();
    }));

    // Copia de seguridad JSON (Exportar / Restaurar)
    const BACKUP_TABLES = ['empresa', 'categorias', 'proveedores', 'articulos', 'variantes', 'clientes', 'pedidos', 'lineasPedido', 'facturas_compra', 'registros_iva', 'movimientos_stock'];
    document.getElementById('aj-btn-backup-export')?.addEventListener('click', async () => {
      showGlobalSpinner('Generando copia de seguridad...');
      try {
        const data = {};
        for (const t of BACKUP_TABLES) data[t] = await db.table(t).toArray();
        const payload = { app: 'babyluc', version: 1, exportedAt: new Date().toISOString(), data };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `babyluc_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        showToast('Copia de seguridad descargada', 'success');
      } finally { hideGlobalSpinner(); }
    });

    document.getElementById('aj-backup-import-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed?.data || typeof parsed.data !== 'object') throw new Error('Archivo JSON no válido');
        const artsC = (parsed.data.articulos || []).length;
        const pedsC = (parsed.data.pedidos || []).length;
        const clisC = (parsed.data.clientes || []).length;
        const modal = document.getElementById('modal-pedido-confirm');
        document.getElementById('modal-pconf-title').textContent = 'Restaurar copia de seguridad';
        document.getElementById('modal-pconf-desc').textContent = `Se reemplazarán los datos actuales por la copia (${artsC} artículos, ${clisC} clientes, ${pedsC} pedidos).`;
        document.getElementById('modal-pconf-label').textContent = 'Escribe RESTAURAR para confirmar:';
        const inp = document.getElementById('modal-pconf-input'); inp.value = '';
        modal.classList.remove('hidden');
        document.getElementById('modal-pconf-ok').onclick = async () => {
          if (inp.value.trim().toUpperCase() !== 'RESTAURAR') return showToast('Escribe RESTAURAR exactamente', 'warning');
          modal.classList.add('hidden');
          showGlobalSpinner('Restaurando copia de seguridad...');
          try {
            await db.transaction('rw', BACKUP_TABLES.map(t => db.table(t)), async () => {
              for (const t of BACKUP_TABLES) {
                await db.table(t).clear();
                const rows = Array.isArray(parsed.data[t]) ? parsed.data[t] : [];
                if (rows.length) await db.table(t).bulkPut(rows);
              }
            });
            if (window.FirebaseBridge?.syncRestoredBackupToCloud && window.FirebaseBridge.getStatus()?.user) {
              await window.FirebaseBridge.syncRestoredBackupToCloud();
            }
            await AjustesModule.ensureDefault();
            await AjustesModule.load();
            await refreshAjustesExtra();
            await StockModule.refresh();
            await PedidosModule.onEnterView();
            await ClientesModule.onEnterView();
            await ProveedoresModule.onEnterView();
            await recalcularAlertasStock(false);
            showToast('Copia de seguridad restaurada correctamente', 'success');
          } finally { hideGlobalSpinner(); }
        };
      } catch (err) {
        showToast('Error al leer copia: ' + (err?.message || err), 'error');
      }
    });
  }
  return {
    init,
    refreshAjustesExtra,
    checkLockOnBoot: async () => { const emp = await db.empresa.get(1); if (emp?.pinActivo && emp?.pinHash) document.getElementById('pin-lock-screen').classList.remove('hidden'); }
  };
})();

function bindCsvExports() {
  document.getElementById('btn-export-stock').addEventListener('click', async () => {
    const [arts, vars, cats, provs] = await Promise.all([db.articulos.toArray(), db.variantes.toArray(), db.categorias.toArray(), db.proveedores.toArray()]);
    const cm = new Map(cats.map(c => [c.id, c.nombre])), pm = new Map(provs.map(p => [p.id, p.nombre]));
    const rows = [];
    arts.filter(a => a.activo !== false).forEach(a => {
      const av = vars.filter(v => v.articuloId === a.id);
      (av.length ? av : [{ talla: '—', color: '—', stock: 0 }]).forEach(v => rows.push([a.codigo || '', a.nombre, (a.aliases || []).join(' | '), cm.get(a.categoriaId) || '', pm.get(a.proveedorId) || '', v.talla, v.color, v.stock, a.precioCompra, a.precioVenta, a.tipoIVA]));
    });
    generateCSV(['Código', 'Nombre', 'Alias', 'Categoría', 'Proveedor', 'Talla', 'Color', 'Stock', 'P.Compra', 'P.Venta', 'IVA'], rows, 'babyluc_stock');
  });
  document.getElementById('btn-export-movimientos')?.addEventListener('click', async () => {
    const movs = await StockModule.getFilteredMovimientos();
    generateCSV(
      ['Fecha', 'Artículo', 'Variante', 'Tipo', 'Variación', 'Stock resultante', 'Referencia', 'Nota'],
      movs.map(m => [
        fmtFechaHora(m.fecha),
        m.nombreArticulo || '',
        m.descripcionVariante || '',
        m.tipo || '',
        Number(m.delta || 0) > 0 ? `+${m.delta}` : String(m.delta || 0),
        m.stockResultante === null || m.stockResultante === undefined ? '' : String(m.stockResultante),
        m.referencia || '',
        m.nota || ''
      ]),
      'babyluc_movimientos_stock'
    );
  });
  document.getElementById('btn-export-proveedores')?.addEventListener('click', async () => {
    const [provs, facs] = await Promise.all([db.proveedores.toArray(), db.facturas_compra.toArray()]);
    generateCSV(['Nombre', 'CIF', 'Teléfono', 'Email', 'Total comprado', 'Facturas'], provs.map(p => {
      const sus = facs.filter(f => Number(f.proveedorId) === Number(p.id) || (!f.proveedorId && (f.nombreProveedor || '').trim().toLowerCase() === (p.nombre || '').trim().toLowerCase()));
      const tot = sus.reduce((a, f) => a + Number(f.total || 0), 0);
      return [p.nombre, p.CIF || '', p.telefono || '', p.email || '', tot.toFixed(2), sus.length];
    }), 'babyluc_proveedores');
  });
  document.getElementById('btn-export-faccomp')?.addEventListener('click', async () => {
    const facs = await db.facturas_compra.toArray();
    generateCSV(['Fecha', 'Nº Factura', 'Proveedor', 'Estado', 'Base', 'IVA', 'RE', 'Total'], facs.map(f => [
      String(f.fecha || '').slice(0, 10), f.numeroFactura, f.nombreProveedor || '',
      getFacturaCompraEstado(f) === 'pendiente_recibir' ? 'Pendiente de recibir' : 'Recibido',
      Number(f.baseImponible || 0).toFixed(2), Number(f.cuotaIVA || 0).toFixed(2),
      Number(f.recargoEquivalencia || 0).toFixed(2), Number(f.total || 0).toFixed(2)
    ]), 'babyluc_facturas_compra');
  });
  document.getElementById('btn-export-pedidos').addEventListener('click', async () => {
    const [peds, ls] = await Promise.all([db.pedidos.toArray(), db.lineasPedido.toArray()]);
    const lm = new Map(); ls.forEach(l => { if (!lm.has(l.pedidoId)) lm.set(l.pedidoId, []); lm.get(l.pedidoId).push(l); });
    generateCSV(['Número', 'Cliente', 'Fecha', 'Total', 'Estado', 'Pago'], peds.map(p => [p.numero, p.nombreCliente, (p.fecha || '').slice(0, 10), calcPedidoTotales(p, lm.get(p.id) || []).totalNeto.toFixed(2), p.estado, p.metodoPago || '']), 'babyluc_pedidos');
  });
  document.getElementById('btn-export-clientes').addEventListener('click', async () => {
    const [clis, peds, ls] = await Promise.all([db.clientes.toArray(), db.pedidos.toArray(), db.lineasPedido.toArray()]);
    const lm = new Map(); ls.forEach(l => { if (!lm.has(l.pedidoId)) lm.set(l.pedidoId, []); lm.get(l.pedidoId).push(l); });
    generateCSV(['Nombre', 'Teléfono', 'Email', 'Dirección', 'Total gastado', 'Pedidos'], clis.map(c => {
      const sp = peds.filter(p => p.clienteId === c.id);
      const g = sp.filter(p => ['pagado', 'enviado', 'completado'].includes(p.estado)).reduce((a, p) => a + calcPedidoTotales(p, lm.get(p.id) || []).totalNeto, 0);
      return [c.nombre, c.telefono, c.email, c.direccion, g.toFixed(2), sp.length];
    }), 'babyluc_clientes');
  });
  document.getElementById('btn-export-balances').addEventListener('click', () => {
    generateCSV(['Métrica', 'Valor'], [
      ['Período', document.getElementById('bal-rango-label').textContent],
      ['Total facturado', document.getElementById('bal-kpi-facturado').textContent],
      ['Nº pedidos', document.getElementById('bal-kpi-pedidos').textContent],
      ['Compras proveedores', document.getElementById('bal-kpi-compras').textContent],
      ['Margen bruto', document.getElementById('bal-kpi-margen').textContent],
      ['Ticket medio', document.getElementById('bal-kpi-ticket').textContent]
    ], 'babyluc_balances');
  });
}

// ==================== 12. SINCRONIZACIÓN EN LA NUBE (FIREBASE) ====================
const CloudSyncModule = (() => {
  let prevUid = null;
  let gateDismissed = false;

  function waitForBridge(timeoutMs = 5000) {
    if (window.FirebaseBridge) return Promise.resolve(window.FirebaseBridge);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(window.FirebaseBridge || null), timeoutMs);
      window.addEventListener('babyluc:firebase-ready', () => {
        clearTimeout(timer);
        resolve(window.FirebaseBridge || null);
      }, { once: true });
    });
  }

  async function refreshVisibleViews() {
    await VariantComboModule.refreshCatalog();
    const isVisible = (id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    };
    if (isVisible('view-stock')) await StockModule.refresh();
    if (isVisible('view-pedidos')) await PedidosModule.refreshActive();
    if (isVisible('view-clientes') && isVisible('clientes-subview-lista')) await ClientesModule.onEnterView();
    if (isVisible('view-proveedores')) await ProveedoresModule.refreshActive();
    if (isVisible('view-balances')) {
      if (isVisible('balances-tab-impuestos')) await ImpuestosModule.refresh();
      else await BalancesModule.onEnterView();
    }
    if (isVisible('view-ajustes')) {
      await AjustesModule.load();
      await PinAndAjustesExtra.refreshAjustesExtra();
    }
    await recalcularAlertasStock(false);
  }

  function openAuthGate() {
    gateDismissed = false;
    document.getElementById('auth-gate-error')?.classList.add('hidden');
    document.getElementById('auth-gate-screen')?.classList.remove('hidden');
  }

  function applyStatusUI(status) {
    const gate = document.getElementById('auth-gate-screen');
    const gateErr = document.getElementById('auth-gate-error');
    const sbEmail = document.getElementById('sidebar-user-email');
    const sbLogin = document.getElementById('sidebar-btn-login');
    const sbOut = document.getElementById('sidebar-btn-logout');
    const hdLogin = document.getElementById('btn-header-login');
    const hdSync = document.getElementById('btn-header-sync-local');
    const hdCount = document.getElementById('header-pending-count');
    const ajStatus = document.getElementById('aj-cloud-status');
    const ajOut = document.getElementById('aj-btn-logout');

    if (!status.ready) return;

    if (!status.user) {
      if (!gateDismissed) gate?.classList.remove('hidden');
      gateErr?.classList.add('hidden');
      if (sbEmail) sbEmail.textContent = 'Sin sesión iniciada';
      sbLogin?.classList.remove('hidden');
      sbOut?.classList.add('hidden');
      hdLogin?.classList.remove('hidden');
      hdSync?.classList.add('hidden');
      if (ajStatus) ajStatus.textContent = 'Inicia sesión para sincronizar entre móvil y ordenador.';
      ajOut?.classList.add('hidden');
      prevUid = null;
      return;
    }

    gateDismissed = false;
    gate?.classList.add('hidden');
    gateErr?.classList.add('hidden');
    const label = status.user.email === 'admin@babyluc.app' ? 'admin' : (status.user.email || 'Conectado');
    if (sbEmail) sbEmail.textContent = status.syncing ? `${label} · Sincronizando...` : `Usuario: ${label}`;
    sbLogin?.classList.add('hidden');
    sbOut?.classList.remove('hidden');
    hdLogin?.classList.add('hidden');
    ajOut?.classList.remove('hidden');
    if (ajStatus) {
      ajStatus.textContent = status.syncing
        ? `Conectado (${label}) · Sincronizando con la nube...`
        : `Sincronizado en tiempo real (${label})`;
    }

    if (status.pendingLocalCount > 0) {
      if (hdCount) hdCount.textContent = String(status.pendingLocalCount);
      hdSync?.classList.remove('hidden');
    } else {
      hdSync?.classList.add('hidden');
    }

    if (status.lastError && ajStatus) {
      ajStatus.textContent = `Error de sincronización: ${status.lastError}`;
    }

    if (!status.syncing && status.user.uid !== prevUid) {
      prevUid = status.user.uid;
      PinAndAjustesExtra.checkLockOnBoot();
      refreshVisibleViews();
    }
  }

  async function init() {
    const doCredentialsLogin = async (username, password) => {
      const gateErr = document.getElementById('auth-gate-error');
      gateErr?.classList.add('hidden');
      showGlobalSpinner('Iniciando sesión...');
      try {
        const activeBridge = window.FirebaseBridge || await waitForBridge(3500);
        if (!activeBridge) {
          throw new Error('El módulo de Firebase no está disponible todavía. Revisa tu conexión o recarga la página.');
        }
        await activeBridge.signInWithCredentials(username, password);
        const passEl = document.getElementById('auth-password');
        if (passEl) passEl.value = '';
      } catch (err) {
        const msg = err?.message || 'Usuario o contraseña incorrectos';
        if (gateErr) {
          gateErr.textContent = msg;
          gateErr.classList.remove('hidden');
        }
        showToast(msg, 'error');
      } finally {
        hideGlobalSpinner();
      }
    };

    const doSignOut = async () => {
      const activeBridge = window.FirebaseBridge;
      if (!activeBridge) return;
      await activeBridge.signOutUser();
      showToast('Sesión cerrada', 'success');
    };

    const doMergeLocal = async () => {
      const activeBridge = window.FirebaseBridge;
      if (!activeBridge) return showToast('Inicia sesión primero para sincronizar con la nube', 'warning');
      showGlobalSpinner('Subiendo datos locales a la nube...');
      try {
        const count = await activeBridge.mergeLocalIntoCloud();
        await refreshVisibleViews();
        showToast(count > 0 ? `${count} registro(s) sincronizados con la nube` : 'Todos los datos ya estaban en la nube', 'success');
      } catch (err) {
        showToast('Error al sincronizar: ' + (err?.message || err), 'error');
      } finally {
        hideGlobalSpinner();
      }
    };

    document.getElementById('auth-login-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = document.getElementById('auth-username')?.value || '';
      const p = document.getElementById('auth-password')?.value || '';
      doCredentialsLogin(u, p);
    });
    document.getElementById('auth-btn-skip')?.addEventListener('click', () => {
      gateDismissed = true;
      document.getElementById('auth-gate-screen')?.classList.add('hidden');
    });
    document.getElementById('btn-header-login')?.addEventListener('click', openAuthGate);
    document.getElementById('sidebar-btn-login')?.addEventListener('click', openAuthGate);
    document.getElementById('sidebar-btn-logout')?.addEventListener('click', doSignOut);
    document.getElementById('aj-btn-logout')?.addEventListener('click', doSignOut);
    document.getElementById('btn-header-sync-local')?.addEventListener('click', doMergeLocal);
    document.getElementById('aj-btn-sync-local')?.addEventListener('click', doMergeLocal);

    const bridge = await waitForBridge(5000);
    if (!bridge) {
      const sbEmail = document.getElementById('sidebar-user-email');
      if (sbEmail) sbEmail.textContent = 'Sin sesión iniciada (local)';
      document.getElementById('sidebar-btn-login')?.classList.remove('hidden');
      document.getElementById('btn-header-login')?.classList.remove('hidden');
      return;
    }

    await bridge.attachDexie(db, {
      onRemoteChange: async () => {
        await refreshVisibleViews();
      },
      onStatusChange: (status) => {
        applyStatusUI(status);
      }
    });
    applyStatusUI(bridge.getStatus());
  }

  return { init, refreshVisibleViews, openAuthGate };
})();

// ==================== 13. ARRANQUE DE LA APLICACIÓN ====================
async function bootBabylucApp() {
  document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => navigateTo(b.dataset.nav)));

  try { await AjustesModule.ensureDefault(); } catch (e) { console.error(e); }
  VariantComboModule.init();
  try { await VariantComboModule.refreshCatalog(); } catch (e) { console.error(e); }
  AjustesModule.init();
  StockModule.init();
  InvoiceScannerModule.init();
  ClientesModule.init();
  ProveedoresModule.init();
  try { await PedidosModule.init(); } catch (e) { console.error(e); }
  DocumentosModule.init();
  BalancesModule.init();
  try { await ImpuestosModule.init(); } catch (e) { console.error(e); }
  GlobalSearchModule.init();
  PinAndAjustesExtra.init();
  bindCsvExports();

  // Arrancar UI inmediatamente sin esperar al timeout de Firebase si la red va lenta
  try { await PinAndAjustesExtra.checkLockOnBoot(); } catch (e) { console.error(e); }
  navigateTo('stock');
  CloudSyncModule.init().catch(err => console.error('CloudSync init error:', err));
  try { await recalcularAlertasStock(true); } catch (e) { console.error(e); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootBabylucApp);
} else {
  bootBabylucApp();
}
