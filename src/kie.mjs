/**
 * Cliente mínimo de Kie.ai. Imágenes SIEMPRE con GPT image 2.
 * Base: https://api.kie.ai/api/v1 (kieai.erweima.ai está muerta).
 */

import fs from 'node:fs';
import { env } from './config.mjs';

const BASE = 'https://api.kie.ai/api/v1';

function auth() {
  return { Authorization: `Bearer ${env('KIE_API_KEY')}`, 'Content-Type': 'application/json' };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Crea una tarea de imagen y espera el resultado. Devuelve la URL del PNG. */
export async function generarImagen(prompt, { aspect_ratio = '1:1', resolution = '2K' } = {}) {
  const alta = await fetch(`${BASE}/jobs/createTask`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({
      model: 'gpt-image-2-text-to-image',
      input: { prompt, aspect_ratio, resolution },
    }),
  });

  const creado = await alta.json();
  if (creado.code === 402) throw new Error('Kie sin créditos (402). Recargar antes de seguir.');
  const taskId = creado?.data?.taskId;
  if (!taskId) throw new Error(`Kie no devolvió taskId: ${JSON.stringify(creado).slice(0, 300)}`);

  for (let i = 0; i < 90; i++) {
    await dormir(4000);
    const res = await fetch(`${BASE}/jobs/recordInfo?taskId=${taskId}`, { headers: auth() });
    const info = await res.json();
    const estado = info?.data?.state;

    if (estado === 'success') {
      const urls = JSON.parse(info.data.resultJson).resultUrls;
      return urls[0];
    }
    if (estado === 'fail') throw new Error(`Kie falló: ${info?.data?.failMsg ?? 'sin motivo'}`);
    process.stdout.write('.');
  }
  throw new Error('Kie: se agotó la espera (6 min)');
}

export async function bajar(url, destino) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo bajar ${url}: ${res.status}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
}
