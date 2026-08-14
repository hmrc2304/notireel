/**
 * Limpia notas duplicadas del sitio y reconstruye el registro de hechos vistos.
 *
 * Hizo falta porque la primera versión del anti-duplicados guardaba una sola URL
 * por hecho, y entre corridas el mismo hecho llegaba con otra lista de coberturas.
 * Este script deja una nota por hecho y registra TODAS sus fuentes.
 *
 *   node src/deduplicar.mjs           muestra qué borraría
 *   node src/deduplicar.mjs --aplicar borra de verdad
 */

import { env, esPrincipal } from './config.mjs';

const aplicar = process.argv.includes('--aplicar');

const URL_BASE = env('SUPABASE_NOTIREEL_URL');
const CLAVE = env('SUPABASE_NOTIREEL_SERVICE_KEY');
const cab = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, { ...opciones, headers: { ...cab, ...opciones.headers } });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const notas = await pedir('notas?select=id,slug,titular,publicada_en,video_url,fuentes(url)&order=publicada_en.asc');
console.log(`${notas.length} notas en el sitio\n`);

// Dos notas son el mismo hecho si comparten al menos una cobertura.
const porUrl = new Map();
const duplicadas = [];

for (const nota of notas) {
  const urls = (nota.fuentes ?? []).map((f) => String(f.url).split('?')[0]);
  const original = urls.map((u) => porUrl.get(u)).find(Boolean);

  if (original) {
    // Se queda la que tiene video; si empatan, la más vieja (ya indexada por Google).
    const gana = original.video_url || !nota.video_url ? original : nota;
    const pierde = gana === original ? nota : original;
    duplicadas.push({ pierde, gana });
    if (gana !== original) {
      for (const u of urls) porUrl.set(u, gana);
    }
  } else {
    for (const u of urls) porUrl.set(u, nota);
  }
}

if (!duplicadas.length) {
  console.log('No hay duplicados.');
} else {
  console.log(`${duplicadas.length} duplicados:\n`);
  for (const { pierde, gana } of duplicadas) {
    console.log(`  BORRAR  ${pierde.titular.slice(0, 62)}`);
    console.log(`  queda   ${gana.titular.slice(0, 62)}${gana.video_url ? ' (tiene video)' : ''}\n`);
  }

  if (aplicar) {
    for (const { pierde } of duplicadas) {
      await pedir(`notas?id=eq.${pierde.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
    console.log(`${duplicadas.length} notas borradas.`);
  } else {
    console.log('Nada se borró. Corré con --aplicar para hacerlo.');
  }
}

// Reconstruir el registro: una fila por cobertura de cada nota que sobrevive.
if (aplicar) {
  const vivas = await pedir('notas?select=id,fuentes(url)');
  const filas = [];
  for (const nota of vivas) {
    for (const f of nota.fuentes ?? []) {
      filas.push({ clave: String(f.url).split('?')[0].slice(0, 400), nota_id: nota.id });
    }
  }
  if (filas.length) {
    await pedir('hechos_vistos', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(filas),
    });
    console.log(`Registro reconstruido: ${filas.length} coberturas de ${vivas.length} notas.`);
  }
}

export {};
