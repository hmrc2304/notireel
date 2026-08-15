'use client';

import { useActionState } from 'react';
import { entrar } from './acciones';

/** Puerta del panel. La clave vive en PANEL_CLAVE y se compara en el servidor. */
export default function Entrar() {
  const [estado, accion, enviando] = useActionState(entrar, null);

  return (
    <div className="puerta">
      <form action={accion}>
        <h1>Baúl de noticias</h1>
        <p>Panel privado de NotiViral.</p>
        <input
          type="password"
          name="clave"
          placeholder="Clave"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button type="submit" className="btn-primario" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        {estado?.error && <span className="error">{estado.error}</span>}
      </form>
    </div>
  );
}
