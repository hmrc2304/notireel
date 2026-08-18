/**
 * Recorta las bajadas que no entran en la franja del video.
 *
 * La bajada se dibuja en tres renglones como máximo, y en esa franja entran unos
 * 130 caracteres con el cuerpo actual. Las que se publicaron antes promedian 161
 * y llegan a 250: el motor las achica de cuerpo hasta el mínimo y, si aún así no
 * entran, las corta con puntos suspensivos. Una bajada cortada se lee como si
 * faltara el final.
 *
 * No vuelve a las fuentes ni al cuerpo de la nota: condensa la bajada que ya
 * está, así que no puede aparecer un dato nuevo.
 *
 *   node src/acortar-bajadas.mjs             dice cuántas hay
 *   node src/acortar-bajadas.mjs --hacer     las reescribe
 */

import { env, esPrincipal, salirPorError } from './config.mjs';
import { pedirHerramienta, MODELO_LIVIANO } from './claude.mjs';

/** Lo que entra en tres renglones con el cuerpo de la bajada del vertical. */
const LARGO_MAXIMO = 130;

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');
const cab = () => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
};

const HERRAMIENTA = {
  name: 'entregar_bajada',
  input_schema: {
    type: 'object',
    properties: {
      bajada: {
        type: 'string',
        description: `la bajada condensada, MÁXIMO ${LARGO_MAXIMO} caracteres contando espacios`,
      },
    },
    required: ['bajada'],
  },
};

const SISTEMA = `Acortás la bajada de una nota periodística ya publicada.

REGLAS DURAS:
- SOLO podés usar lo que dice la bajada que recibís. No agregues nada.
- MÁXIMO ${LARGO_MAXIMO} caracteres contando espacios. Contalos antes de entregar.
- Una o dos frases. Tiene que ampliar el titular, no repetirlo.
- Lo primero que se saca es el detalle secundario y el contexto. Lo que se queda
  es el dato que el titular no dice.
- Español neutro, sin voseo. PROHIBIDO el guion largo (—): usá coma o punto.
- No termines con puntos suspensivos.`;

async function largas(limite) {
  const notas = await fetch(
    `${URL_BASE()}/rest/v1/notas?select=id,slug,titular,bajada&order=publicada_en.desc&limit=200`,
    { headers: cab() },
  ).then((r) => r.json());

  return notas.filter((n) => (n.bajada ?? '').length > LARGO_MAXIMO).slice(0, limite);
}

export async function acortarBajada(nota, { intentos = 2 } = {}) {
  const mensajes = [{ role: 'user', content: `TITULAR: ${nota.titular}\n\nBAJADA: ${nota.bajada}` }];
  let ultima = null;

  for (let i = 0; i < intentos; i++) {
    const { bajada } = await pedirHerramienta({
      etapa: 'acortar-bajada',
      // Condensar una frase de dos renglones no necesita el modelo grande.
      modelo: MODELO_LIVIANO,
      maxTokens: 300,
      sistema: SISTEMA,
      herramienta: HERRAMIENTA,
      mensajes,
    });

    const limpia = String(bajada ?? '').trim().replace(/\s*—\s*/g, ', ').replace(/…$/, '');
    if (!limpia) throw new Error('el modelo no devolvió la bajada');
    if (limpia.length <= LARGO_MAXIMO) return limpia;

    if (!ultima || limpia.length < ultima.length) ultima = limpia;
    mensajes.push(
      { role: 'assistant', content: limpia },
      {
        role: 'user',
        content: `Esa tiene ${limpia.length} caracteres y el tope son ${LARGO_MAXIMO}. `
          + `Sobran ${limpia.length - LARGO_MAXIMO}. Entregala de nuevo más corta, `
          + 'sacando el detalle secundario y dejando el dato principal.',
      },
    );
  }

  return ultima;
}

export async function correr({ hacer = false, lote = 60 } = {}) {
  const notas = await largas(lote);
  if (!notas.length) {
    console.log(`Ninguna bajada supera los ${LARGO_MAXIMO} caracteres.`);
    return 0;
  }

  console.log(`${notas.length} bajada(s) de más de ${LARGO_MAXIMO} caracteres\n`);
  let hechas = 0;

  for (const n of notas) {
    if (!hacer) {
      console.log(`  ${String(n.bajada.length).padStart(3)} · ${n.titular.slice(0, 56)}`);
      hechas++;
      continue;
    }

    try {
      const bajada = await acortarBajada(n);
      await fetch(`${URL_BASE()}/rest/v1/notas?id=eq.${n.id}`, {
        method: 'PATCH',
        headers: { ...cab(), Prefer: 'return=minimal' },
        body: JSON.stringify({ bajada, actualizada_en: new Date().toISOString() }),
      });
      console.log(`  ${n.bajada.length} → ${bajada.length} · ${n.titular.slice(0, 52)}`);
      hechas++;
    } catch (e) {
      console.error(`  ! ${n.slug.slice(0, 40)}: ${e.message.slice(0, 70)}`);
      if (/credit balance/i.test(e.message)) break;
    }
  }

  return hechas;
}

if (esPrincipal(import.meta.url)) {
  try {
    const hacer = process.argv.includes('--hacer');
    const hechas = await correr({ hacer });
    console.log(hacer ? `\n${hechas} bajada(s) acortadas.` : `\n${hechas} para acortar. Corré con --hacer.`);
  } catch (e) {
    process.exit(salirPorError(e, 'el acortado de las bajadas'));
  }
}
