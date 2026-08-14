/**
 * Genera el presentador de Noti Viral. Se corre UNA vez: el PNG queda en assets/
 * y todos los videos lo reusan. Costo por video: cero.
 *
 * Fotorrealista de verdad, nada de aspecto CGI o render. Encuadre de busto,
 * porque en el video se recorta en círculo sobre la esquina inferior.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generarImagen, bajar } from './kie.mjs';
import { DIRS , esPrincipal } from './config.mjs';

const BASE =
  'Ultra photorealistic studio portrait photograph, shot on 85mm lens at f/2, shallow depth of field. ' +
  'Real human skin with visible pores, fine texture and natural subsurface detail, subtle natural film grain. ' +
  'Absolutely not CGI, not a 3D render, not illustration, not plastic looking. ' +
  'Modern television news studio background, deep navy blue tones with soft blue and red rim lighting, ' +
  'blurred out of focus. Chest-up framing, subject centered, looking straight into the camera, ' +
  'confident and warm expression, mouth closed with a slight professional smile. ' +
  'Crisp broadcast lighting on the face, no text, no logos, no watermark.';

export const VARIANTES = {
  ana: `${BASE} A 29 year old Latin American woman news anchor, shoulder length dark brown hair, ` +
    `natural makeup, wearing a dark navy blazer over a white top.`,
  mateo: `${BASE} A 32 year old Latin American man news anchor, short dark hair, clean shaven, ` +
    `wearing a dark navy suit jacket over a light blue shirt, no tie.`,
  sofia: `${BASE} A 38 year old Latin American woman news anchor with an authoritative presence, ` +
    `dark hair tied back, subtle glasses, wearing a charcoal blazer.`,
};

export async function generarAvatar(nombre) {
  const prompt = VARIANTES[nombre];
  if (!prompt) throw new Error(`Variante desconocida: ${nombre}. Hay: ${Object.keys(VARIANTES).join(', ')}`);

  process.stdout.write(`  ${nombre} `);
  const url = await generarImagen(prompt, { aspect_ratio: '1:1', resolution: '2K' });
  const destino = path.join(DIRS.assets, `avatar-${nombre}.png`);
  await bajar(url, destino);
  console.log(` listo -> ${destino}`);
  return destino;
}

if (esPrincipal(import.meta.url)) {
  const pedidos = process.argv.slice(2);
  const nombres = pedidos.length ? pedidos : Object.keys(VARIANTES);
  console.log(`Generando ${nombres.length} avatar(es) con GPT image 2...`);
  for (const n of nombres) {
    try {
      await generarAvatar(n);
    } catch (e) {
      console.error(`\n  ! ${n}: ${e.message}`);
    }
  }
}
