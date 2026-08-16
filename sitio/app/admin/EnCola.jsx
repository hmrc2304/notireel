'use client';

import { useActionState } from 'react';
import { cancelarPedido } from './acciones';

const ESTADO = {
  pendiente: 'en cola',
  tomado: 'produciendo',
};

/**
 * Una línea de la cola con su botón para cancelar.
 *
 * Cancelar solo sirve mientras el pedido está esperando. Una vez que la máquina
 * lo tomó ya está redactando y gastando voz, y no hay forma de frenarla desde
 * acá: en ese caso el botón no se muestra, en vez de ofrecer algo que no va a
 * pasar.
 */
export default function EnCola({ trabajo }) {
  const [estado, accion, enviando] = useActionState(cancelarPedido, null);

  if (estado?.ok) return null;

  return (
    <li>
      <span className={`chip ${trabajo.estado}`}>{ESTADO[trabajo.estado] ?? trabajo.estado}</span>
      <span className="cola-titulo">{trabajo.baul?.titular?.slice(0, 70)}</span>
      <span className="cola-modo">
        {trabajo.modo === 'avatar' ? `video · voz ${trabajo.avatar}` : 'carrusel y placa'}
      </span>

      {trabajo.estado === 'pendiente' && (
        <form action={accion} className="cola-cancelar">
          <input type="hidden" name="trabajoId" value={trabajo.id} />
          <button type="submit" className="btn-texto" disabled={enviando}>
            {enviando ? 'Cancelando…' : 'Cancelar'}
          </button>
        </form>
      )}

      {estado?.error && <span className="error">{estado.error}</span>}
    </li>
  );
}
