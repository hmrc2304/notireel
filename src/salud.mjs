/**
 * Revisa que el motor pueda trabajar, y falla fuerte si no.
 *
 * La alarma anterior esperaba que algún workflow se cayera solo, y eso no pasa:
 * el baúl sigue guardando hechos aunque el modelo no responda, porque traducir y
 * fusionar están en try/catch y lo importante es no perder la recolección del
 * día. Resultado: el motor estuvo veintiuna horas sin publicar una nota, con
 * cuatro corridas en verde y ningún mail.
 *
 * Acá no se espera a que algo falle: se pregunta. Cada servicio se prueba de
 * verdad y, si alguno no está en condiciones de producir, el proceso termina con
 * error para que GitHub mande el aviso.
 *
 *   node src/salud.mjs           informa y falla si algo está caído
 *   node src/salud.mjs --avisar  igual, pero además lo manda por mail
 */

import { env, esPrincipal } from './config.mjs';

/** Anthropic: lo que redacta la nota. Sin esto no hay nada que publicar. */
async function anthropic() {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 4, messages: [{ role: 'user', content: 'ok' }] }),
    });

    if (r.ok) return { bien: true, detalle: 'responde' };
    const texto = await r.text();
    if (/credit balance/i.test(texto)) return { bien: false, detalle: 'SIN SALDO' };
    return { bien: false, detalle: `error ${r.status}` };
  } catch (e) {
    return { bien: false, detalle: `no responde (${e.message.slice(0, 40)})` };
  }
}

/**
 * ElevenLabs: la voz. Sin créditos la nota igual sale, pero sin video, así que
 * avisa sin marcar la corrida como caída.
 */
async function elevenlabs() {
  try {
    const d = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') },
    }).then((r) => r.json());

    const quedan = (d.character_limit ?? 0) - (d.character_count ?? 0);
    // Una locución ronda los 280 créditos: menos de mil es menos de cuatro videos.
    return { bien: quedan > 1000, grave: false, detalle: `${quedan} créditos` };
  } catch (e) {
    return { bien: false, grave: false, detalle: `no responde (${e.message.slice(0, 40)})` };
  }
}

/** Kie: solo hace falta cuando ninguna cobertura trae una foto usable. */
async function kie() {
  try {
    const d = await fetch('https://api.kie.ai/api/v1/chat/credit', {
      headers: { Authorization: `Bearer ${env('KIE_API_KEY')}` },
    }).then((r) => r.json());
    return { bien: (d.data ?? 0) > 50, grave: false, detalle: `${d.data} créditos` };
  } catch (e) {
    return { bien: false, grave: false, detalle: `no responde (${e.message.slice(0, 40)})` };
  }
}

/** Que la base conteste y que se haya publicado algo en las últimas horas. */
async function sitio() {
  try {
    const u = env('SUPABASE_NOTIREEL_URL');
    const k = env('SUPABASE_NOTIREEL_SERVICE_KEY');
    const r = await fetch(`${u}/rest/v1/notas?select=publicada_en&order=publicada_en.desc&limit=1`, {
      headers: { apikey: k, Authorization: `Bearer ${k}` },
    });
    if (!r.ok) return { bien: false, detalle: `Supabase ${r.status}` };

    const [ultima] = await r.json();
    if (!ultima) return { bien: false, detalle: 'no hay ninguna nota' };

    const horas = (Date.now() - new Date(ultima.publicada_en).getTime()) / 3600000;
    // El cron publica cada hora: seis sin nada nuevo ya es un problema.
    return { bien: horas < 6, detalle: `última nota hace ${horas.toFixed(1)} h` };
  } catch (e) {
    return { bien: false, detalle: `no responde (${e.message.slice(0, 40)})` };
  }
}

export async function revisar() {
  const [a, e, k, s] = await Promise.all([anthropic(), elevenlabs(), kie(), sitio()]);

  return [
    { que: 'Anthropic', ...a, grave: true },
    { que: 'ElevenLabs', ...e },
    { que: 'Kie', ...k },
    { que: 'Publicación', ...s, grave: true },
  ];
}

if (esPrincipal(import.meta.url)) {
  const partes = await revisar();
  for (const p of partes) {
    console.log(`${p.bien ? '✓' : '✗'} ${p.que.padEnd(12)} ${p.detalle}`);
  }

  const rotos = partes.filter((p) => !p.bien && p.grave);
  const flojos = partes.filter((p) => !p.bien && !p.grave);

  if (flojos.length) console.log(`\nPara mirar: ${flojos.map((p) => p.que).join(', ')}.`);

  if (rotos.length) {
    console.error(`\n✖ El motor NO puede producir: ${rotos.map((p) => `${p.que} (${p.detalle})`).join(', ')}`);
    process.exit(1);
  }

  console.log('\nEl motor está en condiciones de producir.');
}
