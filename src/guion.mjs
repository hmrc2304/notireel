/**
 * Guion: convierte una nota de notiviral en libreto de 30-40s + copy para redes.
 *
 * Español neutro a propósito: el objetivo es alcance mundial, no solo AR.
 * Sin rayas (—) ni comillas raras: el texto va a TTS y a subtítulos quemados.
 */

import { pathToFileURL } from 'node:url';
import { env , esPrincipal } from './config.mjs';

const MODELO = 'claude-sonnet-5';

const SISTEMA = `Redactás guiones de video para Noti Viral, un medio de noticias que publica
en formato vertical. Los libretos se leen en voz alta en 30 a 40 segundos.
Es trabajo periodístico: cubrís lo que la nota reporta, incluidos hechos duros o polémicos,
con el tono sobrio de un noticiero.

REGLAS DURAS:
- Español NEUTRO. Nada de voseo, "vos", "tenés", "che". Usá "tú" implícito o impersonal.
- 80 a 95 palabras exactas. Ni una más.
- Primera frase: el GANCHO. Un dato concreto y fuerte, no una introducción.
- Nada de "hoy te contamos", "en el video de hoy", "bienvenidos".
- Frases cortas. Máximo 15 palabras por frase.
- Números en cifras (5, 281, 800 mil), no en letras.
- PROHIBIDO el guion largo (—). Usá coma o punto.
- No inventes NADA. Solo datos que estén en la nota.
- Cerrá con una frase que deje tensión o una consecuencia, no con "seguinos".
- Sin emojis ni hashtags dentro del libreto.
- El caption también va en neutro. Nada de "mirá", "seguinos", "enterate".
- Releé la ortografía antes de entregar: el texto se locuta tal cual, un typo se escucha.`;

// Herramienta forzada: garantiza el JSON. Pedirlo en prosa devolvía texto suelto.
const HERRAMIENTA = {
  name: 'entregar_guion',
  description: 'Entrega el libreto y el copy de redes para una noticia.',
  input_schema: {
    type: 'object',
    properties: {
      hook: { type: 'string', description: '3 a 6 palabras en MAYÚSCULAS para el cartel de arranque' },
      libreto: { type: 'string', description: 'texto de 80 a 95 palabras para locutar' },
      caption: { type: 'string', description: '2 o 3 frases para el pie del posteo, invitando a leer la nota' },
      hashtags: {
        type: 'array',
        items: { type: 'string' },
        description: '8 a 12 hashtags sin el signo #, del tema puntual y de noticias en general',
      },
    },
    required: ['hook', 'libreto', 'caption', 'hashtags'],
  },
};

function prompt(nota) {
  return `Escribí el guion de video para esta nota periodística ya publicada en Noti Viral.

TITULAR: ${nota.titular}
SECCIÓN: ${nota.seccion}
BAJADA: ${nota.bajada}

CUERPO:
${nota.cuerpo}`;
}

export async function escribirGuion(nota, apiKey = env('ANTHROPIC_API_KEY')) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 1200,
      system: SISTEMA,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: 'entregar_guion' },
      messages: [{ role: 'user', content: prompt(nota) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const uso = data.content.find((b) => b.type === 'tool_use');
  if (!uso) throw new Error(`el modelo no usó la herramienta: ${JSON.stringify(data.content).slice(0, 300)}`);

  const g = uso.input;
  // El modelo a veces se olvida y mete una raya igual.
  g.libreto = g.libreto.replace(/\s*—\s*/g, ', ');
  g.caption = g.caption.replace(/\s*—\s*/g, ', ');
  // hashtags a veces llega como string separado por comas o espacios.
  if (!Array.isArray(g.hashtags)) g.hashtags = String(g.hashtags).split(/[,\s]+/);
  g.hashtags = g.hashtags.map((h) => h.replace(/^#/, '').trim()).filter(Boolean);
  g.palabras = g.libreto.split(/\s+/).length;
  g.segundos = Math.round((g.palabras / 2.6) * 10) / 10;
  return g;
}

if (esPrincipal(import.meta.url)) {
  const { ultimas } = await import('./fuente.mjs');
  const [nota] = await ultimas(1);
  console.log(`NOTA: ${nota.titular}\n`);
  const g = await escribirGuion(nota);
  console.log(`HOOK: ${g.hook}`);
  console.log(`\nLIBRETO (${g.palabras} palabras, ~${g.segundos}s):\n${g.libreto}`);
  console.log(`\nCAPTION:\n${g.caption}`);
  console.log(`\nHASHTAGS: ${g.hashtags.map((h) => '#' + h).join(' ')}`);
}
