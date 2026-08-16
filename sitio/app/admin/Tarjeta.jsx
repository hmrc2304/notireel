'use client';

import { useActionState, useState } from 'react';
import { pedirPieza, descartarNoticia } from './acciones';

/**
 * Las voces de la locución. Antes acá se elegía la cara del presentador; el
 * presentador se sacó y lo que queda por elegir es quién lee.
 */
const VOCES = [
  { id: 'langa', nombre: 'Langa' },
  { id: 'malena', nombre: 'Malena' },
  { id: 'lionel', nombre: 'Lionel' },
];

const SELLO = {
  A: { texto: 'Base de verificación', clase: 'n-a' },
  B: { texto: 'Contrastar', clase: 'n-b' },
  C: { texto: 'Versión de parte', clase: 'n-c' },
  D: { texto: 'Solo monitoreo', clase: 'n-d' },
};

/**
 * Una noticia del baúl con su botón.
 *
 * El botón abre la elección en el lugar en vez de navegar a otra pantalla: con
 * cien noticias por día, ir y volver por cada una es insoportable.
 */
export default function Tarjeta({ nota }) {
  const [abierto, setAbierto] = useState(false);
  const [voz, setVoz] = useState('langa');
  const [estado, accion, enviando] = useActionState(pedirPieza, null);
  const [estadoDescarte, accionDescarte] = useActionState(descartarNoticia, null);

  const nivel = SELLO[nota.nivel_mejor] ?? SELLO.B;
  const yaSalio = nota.estado === 'publicada' || estado?.ok;
  const descartada = nota.estado === 'descartada' || estadoDescarte?.ok;

  return (
    <article className={`fila ${descartada ? 'apagada' : ''}`}>
      <div className="fila-cuerpo">
        <div className="fila-sellos">
          <span className={`sello-nivel ${nivel.clase}`}>{nivel.texto}</span>
          <span className="cuantos">{nota.medios_count} {nota.medios_count === 1 ? 'medio' : 'medios'}</span>
          {nota.partes_enfrentadas && <span className="cruzado">partes enfrentadas</span>}
          {nota.solo_monitoreo && <span className="ojo">sin confirmar</span>}
        </div>

        <h3>{nota.titular}</h3>
        {nota.bajada && <p>{nota.bajada.slice(0, 190)}</p>}
      </div>

      <div className="fila-acciones">
        {yaSalio ? (
          <span className="ya">{estado?.mensaje ?? 'Publicada'}</span>
        ) : descartada ? (
          <span className="ya">Descartada</span>
        ) : !abierto ? (
          <>
            <button type="button" className="btn-primario" onClick={() => setAbierto(true)}>
              Subir a redes
            </button>
            <form action={accionDescarte}>
              <input type="hidden" name="baulId" value={nota.id} />
              <button type="submit" className="btn-fantasma">Descartar</button>
            </form>
          </>
        ) : (
          <form action={accion} className="elector">
            <input type="hidden" name="baulId" value={nota.id} />

            <div className="opciones">
              <button type="submit" name="modo" value="simple" className="btn-opcion" disabled={enviando}>
                <strong>Carrusel y placa</strong>
                <span>Sin voz: titular y foto, para el feed</span>
              </button>

              <div className="con-avatar">
                <button type="submit" name="modo" value="avatar" className="btn-opcion destacado" disabled={enviando}>
                  <strong>Video</strong>
                  <span>Locución, subtítulos y las fotos de cada cobertura</span>
                </button>

                <div className="avatares">
                  {VOCES.map((v) => (
                    <label key={v.id} className={voz === v.id ? 'elegido' : ''}>
                      <input
                        type="radio"
                        name="avatar"
                        value={v.id}
                        checked={voz === v.id}
                        onChange={() => setVoz(v.id)}
                      />
                      {v.nombre}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <button type="button" className="btn-fantasma" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
          </form>
        )}

        {estado?.error && <span className="error">{estado.error}</span>}
        {enviando && <span className="enviando">Encolando…</span>}
      </div>
    </article>
  );
}
