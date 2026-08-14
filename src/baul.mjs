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
    bajada: (g.noticias[0]?.resumen ?? '').slice(0, 400),
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
