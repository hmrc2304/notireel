/**
 * Agrupa las noticias que hablan del mismo hecho, aunque las publiquen medios
 * distintos y en idiomas distintos.
 *
 * Dos pasadas, porque una sola no alcanza:
 *
 *  1. TF-IDF con coseno sobre título y resumen. Es gratis, corre en milisegundos
 *     sobre 800 noticias y agrupa muy bien dentro de un mismo idioma. Los nombres
 *     propios pesan solos: aparecen poco, así que su IDF es alto.
 *
 *  2. Claude revisa los grupos más relevantes y fusiona lo que la primera pasada
 *     no podía ver: "Earthquake hits Colombia" y "Terremoto en Colombia" no
 *     comparten casi ningún token, pero son la misma noticia.
 *
 * Que un hecho lo cubran varios medios es la señal más fuerte de que importa,
 * y además es lo que habilita contrastar fuentes en la nota.
 */

import { env, esPrincipal } from './config.mjs';

const VACIAS = new Set([
  'para', 'como', 'este', 'esta', 'estos', 'estas', 'pero', 'porque', 'cuando', 'donde',
  'desde', 'hasta', 'sobre', 'entre', 'todos', 'todas', 'otros', 'otras', 'segun', 'tras',
  'ante', 'mientras', 'aunque', 'tambien', 'menos', 'muy', 'mas', 'sus', 'con', 'del',
  'los', 'las', 'que', 'una', 'unos', 'unas', 'por', 'the', 'and', 'for', 'with', 'from',
  'that', 'this', 'these', 'those', 'have', 'has', 'was', 'were', 'been', 'will', 'what',
  'when', 'where', 'after', 'before', 'about', 'into', 'over', 'their', 'they', 'them',
  'says', 'said', 'dice', 'dijo', 'ser', 'son', 'era', 'fue', 'hoy', 'ayer', 'vivo',
]);

function tokens(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9áéíóúñ\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => (t.length >= 4 && !VACIAS.has(t)) || /^\d{2,}$/.test(t));
}

/** Vector TF-IDF por noticia. El IDF se calcula sobre el corpus del día. */
function vectorizar(items) {
  const docs = items.map((i) => tokens(`${i.titulo} ${i.resumen.slice(0, 240)}`));

  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const N = docs.length;
  return docs.map((d) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);

    const v = new Map();
    let norma = 0;
    for (const [t, n] of tf) {
      // Un token que aparece en media portada no distingue nada: su peso tiende a 0.
      const idf = Math.log(N / (df.get(t) ?? 1));
      if (idf < 0.6) continue;
      const p = (1 + Math.log(n)) * idf;
      v.set(t, p);
      norma += p * p;
    }
    norma = Math.sqrt(norma) || 1;
    for (const [t, p] of v) v.set(t, p / norma);
    return v;
  });
}

function coseno(a, b) {
  const [chico, grande] = a.size < b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, p] of chico) {
    const q = grande.get(t);
    if (q) s += p * q;
  }
  return s;
}

/* ── Union-Find: junta en cadena A-B y B-C sin comparar A con C ── */
function nuevoUF(n) {
  const padre = Array.from({ length: n }, (_, i) => i);
  const raiz = (x) => (padre[x] === x ? x : (padre[x] = raiz(padre[x])));
  return { raiz, unir: (a, b) => { const [ra, rb] = [raiz(a), raiz(b)]; if (ra !== rb) padre[rb] = ra; } };
}

/**
 * Primera pasada: clusters por similitud léxica.
 *
 * El umbral sube con el tamaño del corpus. Con 700 noticias 0.26 andaba bien;
 * con 3.600 empezó a juntar cosas que no van (una nota de Kazajistán con una de
 * Colombia), porque cuantas más noticias hay, más fácil es que dos compartan
 * tokens por casualidad.
 */
export function agruparPorTexto(items, { umbral = null } = {}) {
  umbral ??= items.length > 2000 ? 0.38 : items.length > 1200 ? 0.32 : 0.26;
  const vs = vectorizar(items);
  const uf = nuevoUF(items.length);

  // Índice invertido por los tokens de más peso: evita comparar todos contra todos.
  const indice = new Map();
  vs.forEach((v, i) => {
    [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([t]) => {
      if (!indice.has(t)) indice.set(t, []);
      indice.get(t).push(i);
    });
  });

  const comparados = new Set();
  for (const lista of indice.values()) {
    if (lista.length > 60) continue; // token demasiado común, no discrimina
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
        const [i, j] = [lista[a], lista[b]];
        const par = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (comparados.has(par)) continue;
        comparados.add(par);
        if (coseno(vs[i], vs[j]) >= umbral) uf.unir(i, j);
      }
    }
  }

  const grupos = new Map();
  items.forEach((it, i) => {
    const r = uf.raiz(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(it);
  });

  return [...grupos.values()].map(armarGrupo);
}

/** Un titular en ruso o en chino no sirve de referencia para una nota en español. */
const LATINO = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}¿¡«»""''—–]+$/u;

/**
 * Bloques enfrentados, para saber si un hecho lo cuentan lados opuestos.
 *
 * Contar ejes distintos no sirve: el directorio tiene 138 ejes únicos, así que
 * casi cualquier grupo de tres medios da tres ejes y todo parecería contrastado.
 * Lo que importa es que haya al menos dos BLOQUES enfrentados en la misma noticia.
 */
const BLOQUES = [
  ['occidental', 'atlántico', 'atlantico', 'europeísta', 'europeista', 'prooccidental', 'aliado ee.uu', 'mercado'],
  ['antihegemonía', 'antihegemonia', 'antiimperialista', 'multipolar', 'antiintervencionista', 'resistencia', 'bolivariano'],
  ['pro-israel', 'sionista'],
  ['palestina', 'antiocupación', 'antiocupacion', 'antisionista'],
  ['china', 'pcch'],
  ['rusia'],
  ['irán', 'iran'],
];

function bloquesDe(ejes) {
  const encontrados = new Set();
  for (const eje of ejes) {
    const e = String(eje).toLowerCase();
    BLOQUES.forEach((palabras, i) => {
      if (palabras.some((p) => e.includes(p))) encontrados.add(i);
    });
  }
  return encontrados;
}

function armarGrupo(noticias) {
  const medios = [...new Set(noticias.map((n) => n.medio))];
  const pesoMedios = medios.reduce((s, m) => s + (noticias.find((n) => n.medio === m)?.peso ?? 1), 0);
  const masNueva = noticias.reduce((a, b) => (new Date(a.fecha) > new Date(b.fecha) ? a : b));

  // El titular de referencia se elige entre los que están en alfabeto latino:
  // con medios rusos, chinos o árabes en el catálogo, el de más peso puede venir
  // en cirílico y queda como titular de un grupo que se va a redactar en español.
  const ordenadas = [...noticias].sort((a, b) => b.peso - a.peso || b.resumen.length - a.resumen.length);
  const legible = ordenadas.find((n) => LATINO.test(n.titulo)) ?? ordenadas[0];

  const ejes = [...new Set(noticias.map((n) => n.eje).filter(Boolean))];

  return {
    titular: legible.titulo,
    medios,
    cantidadMedios: medios.length,
    noticias,
    fecha: masNueva.fecha,
    imagen: noticias.find((n) => n.imagen)?.imagen ?? null,
    pesoMedios,
    ejes,
    // Dos bloques opuestos contando el mismo hecho: eso sí es contraste real.
    partesEnfrentadas: bloquesDe(ejes).size >= 2,
    // Un hecho que solo sostienen medios de nivel D no se puede dar por confirmado.
    soloMonitoreo: noticias.every((n) => n.nivel === 'D'),
    mejorNivel: ['A', 'B', 'C', 'D'].find((n) => noticias.some((x) => x.nivel === n)) ?? 'B',
  };
}

/* ─────────────── segunda pasada: fusión con Claude ─────────────── */

const HERRAMIENTA = {
  name: 'fusionar_grupos',
  description: 'Indica qué grupos de titulares cubren exactamente el mismo hecho.',
  input_schema: {
    type: 'object',
    properties: {
      fusiones: {
        type: 'array',
        description: 'cada elemento es la lista de números de grupo que hay que unir; solo grupos que sean el MISMO hecho',
        items: { type: 'array', items: { type: 'integer' } },
      },
    },
    required: ['fusiones'],
  },
};

const CRITERIO = `Recibís titulares de noticias numerados, de medios distintos y en varios idiomas.
Decidís cuáles cubren EXACTAMENTE EL MISMO HECHO puntual.

Es el mismo hecho: "Earthquake hits Colombia" y "Terremoto de 7,4 sacude Colombia".
NO es el mismo hecho: dos noticias sobre el mismo país, el mismo político o el mismo
conflicto pero sobre episodios distintos. Ante la duda, NO fusiones: un grupo de más
mezcla dos noticias en una sola nota y arruina las dos.`;

async function fusionarConClaude(grupos, limite) {
  const candidatos = grupos.slice(0, limite);
  const lista = candidatos.map((g, i) => `${i}. [${g.medios.join(', ')}] ${g.titular}`).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      system: CRITERIO,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: 'fusionar_grupos' },
      messages: [{ role: 'user', content: lista }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const uso = data.content.find((b) => b.type === 'tool_use');
  return uso?.input?.fusiones ?? [];
}

/**
 * Agrupa en dos pasadas. `revisar` acota cuántos grupos mira Claude:
 * la cola larga son notas sueltas que no vale la pena cruzar.
 */
export async function agrupar(items, { umbral = 0.26, revisar = 60, usarIA = true } = {}) {
  let grupos = agruparPorTexto(items, { umbral })
    .sort((a, b) => b.cantidadMedios - a.cantidadMedios || new Date(b.fecha) - new Date(a.fecha));

  if (!usarIA || grupos.length < 2) return grupos;

  const fusiones = await fusionarConClaude(grupos, Math.min(revisar, grupos.length));
  const usados = new Set();
  const salida = [];

  for (const f of fusiones) {
    const validos = f.filter((i) => Number.isInteger(i) && i >= 0 && i < grupos.length && !usados.has(i));
    if (validos.length < 2) continue;
    validos.forEach((i) => usados.add(i));
    salida.push(armarGrupo(validos.flatMap((i) => grupos[i].noticias)));
  }

  grupos.forEach((g, i) => { if (!usados.has(i)) salida.push(g); });

  return salida.sort((a, b) => b.cantidadMedios - a.cantidadMedios || new Date(b.fecha) - new Date(a.fecha));
}

if (esPrincipal(import.meta.url)) {
  const { recolectar } = await import('./recolector.mjs');
  const { items } = await recolectar({ horas: 24 });
  console.log(`${items.length} noticias recolectadas`);

  const soloTexto = agruparPorTexto(items);
  console.log(`Pasada 1 (TF-IDF):  ${soloTexto.length} grupos, ${soloTexto.filter((g) => g.cantidadMedios > 1).length} con más de un medio`);

  const grupos = await agrupar(items);
  const cruzados = grupos.filter((g) => g.cantidadMedios > 1);
  console.log(`Pasada 2 (+ Claude): ${grupos.length} grupos, ${cruzados.length} con más de un medio\n`);

  console.log('Los hechos más cubiertos de las últimas 24 h:\n');
  for (const g of cruzados.slice(0, 12)) {
    console.log(`  ${g.cantidadMedios} medios · ${g.titular.slice(0, 74)}`);
    console.log(`            ${g.medios.join(', ')}`);
  }
}
