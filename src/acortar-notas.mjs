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

const HERRAMIENTA = {
  name: 'entregar_nota_corta',
  input_schema: {
    type: 'object',
    properties: {
      cuerpo: {
        type: 'string',
        description: 'la nota condensada, de 200 a 290 palabras, en cuatro o cinco párrafos separados por una línea en blanco',
      },
    },
    required: ['cuerpo'],
  },
};

const SISTEMA = `Condensás notas periodísticas ya publicadas a un formato más corto.

REGLAS DURAS:
- SOLO podés usar información que esté en el texto que recibís. No agregues nada,
  ni contexto, ni datos que sepas del tema. Condensar no es reescribir de memoria.
- Conservá SIEMPRE las atribuciones: "según la BBC", "de acuerdo con EFE". Si el
  original dice que dos medios difieren en una cifra, eso se queda.
- Entre 200 y 290 palabras, en cuatro o cinco párrafos de dos o tres frases.
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
 * Pedir el largo en el prompt no alcanza: en la primera tanda de 30 notas, una
 * de 434 palabras volvió con 386. El modelo recorta lo que le parece de más y se
 * detiene, sin contar. Lo que sí funciona es devolverle su propio intento con la
 * cuenta exacta y cuántas palabras le sobran, porque entonces el objetivo deja
 * de ser "más corto" y pasa a ser un número.
 */
export async function acortar(nota, { intentos = 3 } = {}) {
  const mensajes = [{ role: 'user', content: `TITULAR: ${nota.titular}\n\n${nota.cuerpo}` }];
  let ultimo = null;

  for (let i = 0; i < intentos; i++) {
    const { cuerpo } = await pedirHerramienta({
      etapa: 'acortar',
      maxTokens: 1200,
      sistema: SISTEMA,
      herramienta: HERRAMIENTA,
      mensajes,
    });

    if (!cuerpo) throw new Error('el modelo no devolvió la nota');
    const largo = contar(cuerpo);
    if (largo <= LARGO_MAXIMO) return cuerpo;

    ultimo = cuerpo;
    mensajes.push(
      { role: 'assistant', content: cuerpo },
      {
        role: 'user',
        content: `Esa versión tiene ${largo} palabras y el máximo son ${LARGO_MAXIMO}. `
          + `Sobran ${largo - LARGO_MAXIMO}. Volvé a entregarla con 290 palabras o menos: `
          + 'sacá adjetivos, contexto de fondo y frases que no aporten un dato nuevo. '
          + 'Los datos del hecho y las atribuciones se quedan.',
      },
    );
  }

  // Después de tres intentos, la más corta que logró es mejor que la original.
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
