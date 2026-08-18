/**
 * Una sola puerta a la API del modelo, que además anota lo que gasta.
 *
 * Antes cada módulo armaba su propio fetch. Eso funcionaba, pero dejaba el gasto
 * invisible: el único indicador era que el crédito se agotara, que es tarde y
 * caro. Pasó dos veces en una semana, y las dos el motivo real fue una etapa
 * concreta comiéndose el presupuesto sin que se notara.
 *
 * Cada llamada declara su etapa y queda registrada con los tokens que consumió.
 * Que el registro falle nunca puede voltear una corrida: es contabilidad, no
 * producción.
 */

import { env } from './config.mjs';

const API = 'https://api.anthropic.com/v1/messages';
export const MODELO = 'claude-sonnet-5';

/** Modelo barato para lo mecánico: depurar, traducir, mirar si una foto sirve. */
export const MODELO_LIVIANO = 'claude-haiku-4-5';

/**
 * Precio por millón de tokens, para poder informar el gasto en plata.
 * Sonnet 5 tiene precio de lanzamiento hasta el 31/08/2026.
 */
const PRECIO = {
  'claude-sonnet-5': { entrada: 3, salida: 15 },
  'claude-haiku-4-5': { entrada: 1, salida: 5 },
};

export function costoEnDolares({ modelo, entrada = 0, salida = 0 }) {
  const p = PRECIO[modelo] ?? PRECIO['claude-sonnet-5'];
  return (entrada * p.entrada + salida * p.salida) / 1_000_000;
}

async function anotar({ etapa, modelo, uso }) {
  const url = env('SUPABASE_NOTIREEL_URL', false);
  const clave = env('SUPABASE_NOTIREEL_SERVICE_KEY', false);
  if (!url || !clave || !uso) return;

  try {
    await fetch(`${url}/rest/v1/gasto`, {
      method: 'POST',
      headers: {
        apikey: clave,
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        etapa,
        modelo,
        entrada: uso.input_tokens ?? 0,
        salida: uso.output_tokens ?? 0,
        cacheada: uso.cache_read_input_tokens ?? 0,
      }),
    });
  } catch {
    // El gasto es contabilidad: si no se puede anotar, la pieza igual se produce.
  }
}

/**
 * Llama al modelo y devuelve la respuesta cruda.
 *
 * `etapa` es obligatoria y es lo que después permite saber qué parte del motor
 * consume qué: sin ella el registro es un total sin explicación.
 */
export async function pedirAClaude({ etapa, modelo = MODELO, sistema, herramienta, mensajes, maxTokens = 1200 }) {
  const cuerpo = {
    model: modelo,
    max_tokens: maxTokens,
    messages: mensajes,
    ...(sistema ? { system: sistema } : {}),
    ...(herramienta
      ? { tools: [herramienta], tool_choice: { type: 'tool', name: herramienta.name } }
      : {}),
  };

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  await anotar({ etapa, modelo, uso: data.usage });
  return data;
}

/** Atajo para el caso de siempre: forzar una herramienta y quedarse con su input. */
export async function pedirHerramienta(opciones) {
  const data = await pedirAClaude(opciones);
  const uso = data.content.find((b) => b.type === 'tool_use');
  if (!uso) throw new Error(`el modelo no usó la herramienta en ${opciones.etapa}`);
  return uso.input;
}
