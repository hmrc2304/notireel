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

import { env, esPrincipal, salirPorError } from './config.mjs';
import { pedirHerramienta, MODELO_LIVIANO } from './claude.mjs';

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

const limpiarUrl = (n) => String(n?.url ?? '').split('?')[0].slice(0, 400) || null;

/** Solo sirve para el unique de la tabla; quién identifica el hecho es baul_urls. */
function claveDelGrupo(grupo) {
  const urls = grupo.noticias.map(limpiarUrl).filter(Boolean).sort();
  return (urls[0] ?? grupo.titular).slice(0, 400);
}

/**
 * Qué URLs de estas ya están guardadas, y en qué fila del baúl.
 *
 * Va de a tandas chicas: las URLs viajan en la query string y con 100 por vuelta
 * la línea de request pasaba el límite de encabezados de undici, que corta con un
 * `HeadersOverflowError` bastante opaco.
 */
async function buscarPorUrls(urls) {
  const mapa = new Map();
  const unicas = [...new Set(urls)].filter(Boolean);

  for (let i = 0; i < unicas.length; i += 20) {
    const lista = unicas.slice(i, i + 20).map((u) => `"${u.replace(/"/g, '')}"`).join(',');
    const filas = await pedir(`baul_urls?select=url,baul_id&url=in.(${encodeURIComponent(lista)})`);
    for (const f of filas ?? []) mapa.set(f.url, f.baul_id);
  }
  return mapa;
}

/** Deja registrada cada cobertura del hecho, para reconocerlo en la próxima corrida. */
function registrarUrls(baulId, urls) {
  if (!urls.length) return null;
  return pedir('baul_urls?on_conflict=url', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(urls.map((url) => ({ url, baul_id: baulId }))),
  });
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
  const entrada = await pedirHerramienta({
    etapa: 'traducir',
    modelo: MODELO_LIVIANO,
    maxTokens: 8000,
    sistema: INSTRUCCION_TRADUCIR,
    herramienta: HERRAMIENTA_TRADUCIR,
    mensajes: [{
      role: 'user',
      content: pendientes
        .map((x) => `${x.i}. ${filas[x.i].titular}\n   bajada: ${(filas[x.i].bajada ?? '').slice(0, 300)}`)
        .join('\n\n'),
    }],
  });

  const salida = entrada?.textos ?? [];

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

  const urlsPorFila = elegidas.map((g) => [...new Set(g.noticias.map(limpiarUrl))].filter(Boolean));
  const yaGuardadas = await buscarPorUrls(urlsPorFila.flat());

  let nuevas = 0;
  let actualizadas = 0;

  for (let i = 0; i < filas.length; i++) {
    const conocida = urlsPorFila[i].map((u) => yaGuardadas.get(u)).find(Boolean);

    if (conocida) {
      // Ya está en el baúl con otra composición: se refresca lo que puede haber
      // cambiado, sin tocar `estado` ni pisar el titular si alguien ya lo usó.
      await pedir(`baul?id=eq.${conocida}&estado=eq.guardada`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          titular: filas[i].titular,
          bajada: filas[i].bajada,
          coberturas: filas[i].coberturas,
          medios_count: filas[i].medios_count,
          nivel_mejor: filas[i].nivel_mejor,
          ejes: filas[i].ejes,
          partes_enfrentadas: filas[i].partes_enfrentadas,
          solo_monitoreo: filas[i].solo_monitoreo,
          puntaje: filas[i].puntaje,
        }),
      });
      await registrarUrls(conocida, urlsPorFila[i]);
      actualizadas++;
      continue;
    }

    // `on_conflict=clave` es obligatorio: sin él PostgREST resuelve el upsert
    // contra la PK (id), la fila entra como nueva y el unique de `clave` la
    // rechaza con 409 en vez de actualizar la que ya estaba.
    const [creada] = await pedir('baul?on_conflict=clave', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([filas[i]]),
    }) ?? [];

    if (creada?.id) {
      await registrarUrls(creada.id, urlsPorFila[i]);
      urlsPorFila[i].forEach((u) => yaGuardadas.set(u, creada.id));
      nuevas++;
    }
  }

  return { guardadas: nuevas + actualizadas, nuevas, actualizadas, totalItems: items.length, totalGrupos: grupos.length };
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
  } else try {
    console.log(`Llenando el baúl con las ${tope} mejores del día...\n`);
    const r = await llenar({ tope });
    console.log(
      `${r.totalItems} noticias · ${r.totalGrupos} hechos · ` +
      `${r.nuevas} nuevas y ${r.actualizadas} actualizadas en el baúl`,
    );
  } catch (e) {
    process.exit(salirPorError(e, 'el llenado del baúl'));
  }
}
