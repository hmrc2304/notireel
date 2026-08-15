'use server';

/**
 * Acciones del panel. Corren en el servidor, así que la clave de servicio nunca
 * sale de ahí.
 *
 * Ninguna produce el video: dejan el pedido en la cola y el trabajador lo levanta.
 * Vercel corta a los 60 segundos y no tiene ffmpeg.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { encolar, descartar, cancelar } from '../../lib/admin';

const COOKIE = 'notireel_panel';

async function autorizado() {
  const galleta = await cookies();
  return galleta.get(COOKIE)?.value === process.env.PANEL_CLAVE;
}

export async function entrar(_previo, formulario) {
  const clave = String(formulario.get('clave') ?? '');
  if (!process.env.PANEL_CLAVE) return { error: 'El panel no tiene clave configurada.' };
  if (clave !== process.env.PANEL_CLAVE) return { error: 'Clave incorrecta.' };

  const galleta = await cookies();
  galleta.set(COOKIE, clave, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  revalidatePath('/admin');
  return { ok: true };
}

export async function pedirPieza(_previo, formulario) {
  if (!await autorizado()) return { error: 'Sesión vencida. Volvé a entrar.' };

  const baulId = String(formulario.get('baulId') ?? '');
  const modo = String(formulario.get('modo') ?? 'simple');
  const avatar = String(formulario.get('avatar') ?? 'ana');
  const cuerpo = String(formulario.get('cuerpo') ?? 'foto');

  if (!baulId) return { error: 'Falta la noticia.' };
  if (!['avatar', 'simple'].includes(modo)) return { error: 'Modo inválido.' };

  try {
    const r = await encolar({ baulId, modo, avatar, cuerpo });
    revalidatePath('/admin');
    return r.yaEstaba
      ? { ok: true, mensaje: 'Ya estaba en la cola.' }
      : { ok: true, mensaje: modo === 'avatar' ? 'En cola: video con presentador.' : 'En cola: carrusel y placa.' };
  } catch (e) {
    return { error: e.message.slice(0, 160) };
  }
}

export async function cancelarPedido(_previo, formulario) {
  if (!await autorizado()) return { error: 'Sesión vencida. Volvé a entrar.' };

  const trabajoId = String(formulario.get('trabajoId') ?? '');
  if (!trabajoId) return { error: 'Falta el pedido.' };

  try {
    const salio = await cancelar(trabajoId);
    revalidatePath('/admin');
    return salio
      ? { ok: true, mensaje: 'Cancelado.' }
      : { error: 'Ya lo tomó la máquina que produce: no se puede cancelar.' };
  } catch (e) {
    return { error: e.message.slice(0, 160) };
  }
}

export async function descartarNoticia(_previo, formulario) {
  if (!await autorizado()) return { error: 'Sesión vencida. Volvé a entrar.' };

  const baulId = String(formulario.get('baulId') ?? '');
  if (!baulId) return { error: 'Falta la noticia.' };

  try {
    await descartar(baulId);
    revalidatePath('/admin');
    return { ok: true, mensaje: 'Descartada.' };
  } catch (e) {
    return { error: e.message.slice(0, 160) };
  }
}
