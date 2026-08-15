/**
 * El baúl: guarda todo lo que el recolector encuentra, se publique o no.
 *
 * Hasta ahora cada corrida recolectaba 3.600 noticias, publicaba una y tiraba el
 * resto. El baúl deja el material del día disponible para elegir a mano qué sale
 * y en qué formato.
 *
 * Guarda las coberturas enteras, así que redactar después no obliga a volver a
 * recolectar ni a agrupar: el trabajo caro ya está hecho.
 *
 *   node src/baul.mjs              guarda las 100 mejores del día
 *   node src/baul.mjs --tope 200   guarda más
 *   node src/baul.mjs --ver        muestra lo que hay guardado hoy
 */

import { env, esPrincipal } from './config.mjs';

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');

function cabeceras(extra = {}) {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...extra };
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${URL_BASE()}/rest/v1/${ruta}`, { ...opciones, headers: cabeceras(opciones.headers) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/** Misma huella que usa el anti-duplicados: la primera cobertura del hecho. */
function claveDelGrupo(grupo) {
  const urls = grupo.noticias.map((n) => String(n.url).split('?')[0]).sort();
  return (urls[0] ?? grupo.titular).slice(0, 400);
}

/**
 * Traduce al español los titulares que no tengan ninguna cobertura en español.
 *
 * El panel se lee en español y la nota se redacta en español, pero un hecho que
 * solo cubrieron medios ingleses llega con el titular en inglés y hay que
 * traducirlo de cabeza para saber de qué se trata. Va todo en UNA llamada: cien
 * llamadas sueltas costarían cien veces más y tardarían minutos.
 *
 * Si la traducción falla, se sigue con los titulares originales: que el baúl
 * quede sin llenar por esto sería peor que leer algunos titulares en inglés.
 */
const HERRAMIENTA_TRADUCIR = {
  name: 'traducir',
  description: 'Devuelve los textos traducidos al español.',
  input_schema: {
    type: 'object',
    properties: {
      textos: {
        type: 'array',
        description: 'uno por CADA número recibido, sin saltear ninguno',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'el número que venía en la lista' },
            titular: { type: 'string', description: 'el titular en español' },
            bajada: { type: 'string', description: 'la bajada en español, vacía si no venía' },
          },
          required: ['n', 'titular'],
        },
      },
    },
    required: ['textos'],
  },
};

const INSTRUCCION_TRADUCIR =
  'Traducís noticias al español neutro. El titular mantiene tono de titular: sin punto ' +
  'final, sin agregar ni sacar información, sin adjetivar. Los nombres propios, las siglas ' +
  'y los cargos quedan como se usan en la prensa en español. Devolvés una entrada por cada ' +
  'número que recibís, sin saltear ninguno.';

/** Una tanda: pide la traducción y la aplica sobre `filas`. Devuelve cuántas entraron. */
async function tandaDeTraduccion(filas, pendientes) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system: INSTRUCCION_TRADUCIR,
      tools: [HERRAMIENTA_TRADUCIR],
      tool_choice: { type: 'tool', name: 'traducir' },
      messages: [{
        role: 'user',
        content: pendientes
          .map((x) => `${x.i}. ${filas[x.i].titular}\n   bajada: ${(filas[x.i].bajada ?? '').slice(0, 300)}`)
          .join('\n\n'),
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const salida = data.content.find((b) => b.type === 'tool_use')?.input?.textos ?? [];

  let hechos = 0;
  for (const { n, titular, bajada } of salida) {
    if (!filas[n] || !titular?.trim()) continue;
    filas[n].titular = titular.trim();
    if (bajada?.trim()) filas[n].bajada = bajada.trim();
    hechos++;
  }
  return hechos;
}

/**
 * Traduce al español lo que no tenga ninguna cobertura en español.
 *
 * El panel se lee en español y la nota se redacta en español, pero un hecho que
 * solo cubrieron medios ingleses llega en inglés y hay que traducirlo de cabeza
 * para saber de qué se trata. Van juntos titular y bajada: traducir solo el
 * titular dejaba "Luigi Mangione se declara culpable" arriba de "I shot Mr
 * Thompson in Manhattan".
 *
 * Todo en UNA llamada, con un reintento para los que el modelo se saltee. Si
 * falla, se sigue con los textos originales: que el baúl quede sin llenar por
 * esto sería peor que leer algunos titulares en inglés.
 */
async function traducirTitulares(filas) {
  const { pareceEspanol } = await import('./agrupar.mjs');
  const faltantes = () => filas
    .map((f, i) => ({ i }))
    .filter(({ i }) => !pareceEspanol(`${filas[i].titular} ${filas[i].bajada ?? ''}`));

  let hechos = 0;
  try {
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const pendientes = faltantes();
      if (!pendientes.length) break;
      hechos += await tandaDeTraduccion(filas, pendientes);
    }
  } catch (e) {
    console.error(`  ! no pude traducir (${e.message}), queda como estaba`);
  }
  return hechos;
}

/**
 * Recolecta, agrupa y guarda las mejores del día.
 * Se puede correr varias veces: lo ya guardado se actualiza, no se duplica.
 */
export async function llenar({ tope = 100, horas = 24 } = {}) {
  const { recolectar } = await import('./recolector.mjs');
  const { agrupar } = await import('./agrupar.mjs');
  const { rankear } = await import('./redactar.mjs');

  const { items } = await recolectar({ horas });
  const grupos = await agrupar(items);
  const ranking = rankear(grupos);

  // Primero las que tienen cobertura cruzada: son las que se pueden contrastar.
  const elegidas = [
    ...ranking.filter((g) => g.cantidadMedios >= 2),
    ...ranking.filter((g) => g.cantidadMedios < 2),
  ].slice(0, tope);

  const filas = elegidas.map((g) => ({
    clave: claveDelGrupo(g),
    titular: g.titular,
    bajada: (g.bajada ?? g.noticias[0]?.resumen ?? '').slice(0, 400),
    seccion: 'Mundo',
    coberturas: g.noticias.map((n) => ({
      medio: n.medio, titulo: n.titulo, url: n.url, resumen: n.resumen,
      fecha: n.fecha, nivel: n.nivel, eje: n.eje, peso: n.peso, imagen: n.imagen,
    })),
    medios_count: g.cantidadMedios,
    nivel_mejor: g.mejorNivel ?? 'B',
    ejes: g.ejes ?? [],
    partes_enfrentadas: Boolean(g.partesEnfrentadas),
    solo_monitoreo: Boolean(g.soloMonitoreo),
    imagen_origen: g.imagen,
    puntaje: g.puntaje,
  }));

  const traducidos = await traducirTitulares(filas);
  if (traducidos) console.log(`  ${traducidos} noticias traducidas al español`);

  // De a tandas: un insert de 100 filas con las coberturas adentro es pesado.
  let guardadas = 0;
  for (let i = 0; i < filas.length; i += 25) {
    // `on_conflict=clave` es obligatorio: sin él PostgREST resuelve el upsert
    // contra la PK (id), la fila entra como nueva y el unique de `clave` la
    // rechaza con 409 en vez de actualizar la que ya estaba.
    await pedir('baul?on_conflict=clave', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(filas.slice(i, i + 25)),
    });
    guardadas += Math.min(25, filas.length - i);
  }

  return { guardadas, totalItems: items.length, totalGrupos: grupos.length };
}

export function listarDelDia(limite = 100) {
  return pedir(`baul?select=id,titular,medios_count,nivel_mejor,estado,puntaje,del_dia,creada_en&order=puntaje.desc&limit=${limite}`);
}

if (esPrincipal(import.meta.url)) {
  const i = process.argv.indexOf('--tope');
  const tope = i > 0 ? Number(process.argv[i + 1]) : 100;

  if (process.argv.includes('--ver')) {
    const filas = await listarDelDia(30);
    console.log(`${filas.length} noticias en el baúl (las 30 mejores)\n`);
    for (const f of filas) {
      console.log(`  ${String(f.medios_count).padStart(2)} medios · ${f.nivel_mejor} · ${f.estado.padEnd(10)} ${f.titular.slice(0, 58)}`);
    }
  } else {
    console.log(`Llenando el baúl con las ${tope} mejores del día...\n`);
    const r = await llenar({ tope });
    console.log(`${r.totalItems} noticias · ${r.totalGrupos} hechos · ${r.guardadas} guardadas en el baúl`);
  }
}
