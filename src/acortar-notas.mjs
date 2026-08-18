/**
 * Reescribe en formato corto las notas que se publicaron largas.
 *
 * El formato pasó de 300-450 palabras a 200-290, poco más de un minuto de
 * lectura, pero eso solo aplica a lo que se produce de ahí en adelante. Lo ya
 * publicado quedó con el doble de largo.
 *
 * No vuelve a las fuentes: trabaja sobre el texto que ya está publicado y lo
 * condensa. Es más barato y, sobre todo, más seguro: el material del que puede
 * afirmar algo es exactamente el mismo de antes, así que no hay forma de que
 * aparezca un dato nuevo.
 *
 *   node src/acortar-notas.mjs             dice cuántas hay
 *   node src/acortar-notas.mjs --hacer     las reescribe
 *   node src/acortar-notas.mjs --hacer --lote 5
 */

import { env, esPrincipal, salirPorError } from './config.mjs';
import { pedirHerramienta } from './claude.mjs';

const LARGO_MAXIMO = 300;   // palabras a partir de las cuales se considera larga

const URL_BASE = () => env('SUPABASE_NOTIREEL_URL');
const CLAVE = () => env('SUPABASE_NOTIREEL_SERVICE_KEY');
const cab = () => {
  const k = CLAVE();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' };
};

/**
 * Se pide una lista de párrafos, no un texto suelto.
 *
 * Pedir "de 200 a 290 palabras" no funciona: es un presupuesto global que el
 * modelo no puede verificar mientras escribe, así que recorta hasta que le
 * parece suficiente y frena. Una tanda entera volvió arriba de las 350. Un tope
 * por párrafo sí lo puede sostener, porque cada unidad es corta y el límite
 * vuelve a aparecer cuatro veces en lugar de una. Cuatro párrafos de 65 dan 260.
 */
const HERRAMIENTA = {
  name: 'entregar_nota_corta',
  input_schema: {
    type: 'object',
    properties: {
      parrafos: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: {
          type: 'string',
          description: 'un párrafo de DOS frases, entre 45 y 65 palabras. Nunca más de 65.',
        },
        description: 'los cuatro párrafos de la nota condensada',
      },
    },
    required: ['parrafos'],
  },
};

const SISTEMA = `Condensás notas periodísticas ya publicadas a un formato más corto.

LA FORMA es exactamente esta, y no se negocia:
- CUATRO párrafos, ni uno más ni uno menos.
- Cada párrafo tiene DOS frases y entre 45 y 65 palabras. Contá las palabras de
  cada párrafo antes de entregarlo.
- Párrafo 1: qué pasó, dónde y cuándo. Párrafo 2: los datos duros y quién los da.
  Párrafo 3: en qué difieren los medios entre sí, o el dato que falta. Párrafo 4:
  qué sigue o cuál es la consecuencia.

REGLAS DURAS:
- SOLO podés usar información que esté en el texto que recibís. No agregues nada,
  ni contexto, ni datos que sepas del tema. Condensar no es reescribir de memoria.
- Conservá SIEMPRE las atribuciones: "según la BBC", "de acuerdo con EFE". Si el
  original dice que dos medios difieren en una cifra, eso se queda.
- Lo que se saca primero es el contexto histórico, el color y las frases de
  relleno. Lo que nunca se saca son los datos del hecho y quién los dice.
- Español neutro, sin voseo. PROHIBIDO el guion largo (—): usá coma o punto.
- Frases cortas y directas, sin fórmulas de clickbait.`;

const contar = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

async function largas(limite) {
  const notas = await fetch(
    `${URL_BASE()}/rest/v1/notas?select=id,slug,titular,cuerpo&order=publicada_en.desc&limit=200`,
    { headers: cab() },
  ).then((r) => r.json());

  return notas.filter((n) => contar(n.cuerpo) > LARGO_MAXIMO).slice(0, limite);
}

/**
 * Pide la versión corta y la mide.
 *
 * El tope por párrafo sostiene el largo casi siempre, pero cuando se pasa hay un
 * segundo intento que le devuelve el párrafo culpable con su cuenta exacta. Un
 * número concreto sobre una unidad corta es un objetivo que puede cumplir; "más
 * corto" no lo es.
 */
export async function acortar(nota, { intentos = 2 } = {}) {
  const mensajes = [{ role: 'user', content: `TITULAR: ${nota.titular}\n\n${nota.cuerpo}` }];
  let ultimo = null;

  for (let i = 0; i < intentos; i++) {
    const { parrafos } = await pedirHerramienta({
      etapa: 'acortar',
      maxTokens: 1200,
      sistema: SISTEMA,
      herramienta: HERRAMIENTA,
      mensajes,
    });

    if (!parrafos?.length) throw new Error('el modelo no devolvió la nota');
    const cuerpo = parrafos.map((p) => String(p).trim()).filter(Boolean).join('\n\n');
    const largo = contar(cuerpo);
    if (largo <= LARGO_MAXIMO) return cuerpo;

    // Nos quedamos con el intento más corto, no con el último.
    if (!ultimo || largo < contar(ultimo)) ultimo = cuerpo;

    const cuentas = parrafos.map((p, n) => `${n + 1}: ${contar(p)} palabras`).join(', ');
    mensajes.push(
      { role: 'assistant', content: cuerpo },
      {
        role: 'user',
        content: `Esa versión suma ${largo} palabras (${cuentas}) y el tope son ${LARGO_MAXIMO}. `
          + 'Entregala de nuevo con los cuatro párrafos de 65 palabras o menos cada uno: '
          + 'sacá adjetivos, contexto de fondo y frases que no aporten un dato nuevo. '
          + 'Los datos del hecho y las atribuciones se quedan.',
      },
    );
  }

  return ultimo;
}

export async function correr({ hacer = false, lote = 50 } = {}) {
  const notas = await largas(lote);
  if (!notas.length) {
    console.log('Ninguna nota supera el largo actual.');
    return 0;
  }

  console.log(`${notas.length} nota(s) más largas de ${LARGO_MAXIMO} palabras\n`);
  let hechas = 0;

  for (const n of notas) {
    const antes = contar(n.cuerpo);
    if (!hacer) {
      console.log(`  ${String(antes).padStart(3)} pal · ${n.titular.slice(0, 56)}`);
      hechas++;
      continue;
    }

    try {
      const cuerpo = await acortar(n);
      await fetch(`${URL_BASE()}/rest/v1/notas?id=eq.${n.id}`, {
        method: 'PATCH',
        headers: { ...cab(), Prefer: 'return=minimal' },
        body: JSON.stringify({ cuerpo, actualizada_en: new Date().toISOString() }),
      });
      console.log(`  ${antes} → ${contar(cuerpo)} pal · ${n.titular.slice(0, 52)}`);
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
    const i = process.argv.indexOf('--lote');
    const hechas = await correr({
      hacer: process.argv.includes('--hacer'),
      lote: i > 0 ? Number(process.argv[i + 1]) : 50,
    });
    console.log(process.argv.includes('--hacer')
      ? `\n${hechas} nota(s) acortadas.`
      : `\n${hechas} para acortar. Corré con --hacer.`);
  } catch (e) {
    process.exit(salirPorError(e, 'el acortado de las notas'));
  }
}
