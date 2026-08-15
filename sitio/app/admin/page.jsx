import { cookies } from 'next/headers';
import { listarBaul, diasConNoticias, listarTrabajos } from '../../lib/admin';
import Tarjeta from './Tarjeta';
import EnCola from './EnCola';
import Entrar from './Entrar';
import './panel.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Baúl de noticias', robots: { index: false, follow: false } };

const COOKIE = 'notireel_panel';

function fechaCorta(dia) {
  const [a, m, d] = dia.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(d)} ${meses[Number(m) - 1]}`;
}

export default async function Panel({ searchParams }) {
  const galleta = await cookies();
  if (galleta.get(COOKIE)?.value !== process.env.PANEL_CLAVE) return <Entrar />;

  const params = await searchParams;
  const dia = params?.dia ?? null;
  const estado = params?.estado ?? 'guardada';

  const [noticias, dias, trabajos] = await Promise.all([
    listarBaul({ dia, estado }),
    diasConNoticias(),
    listarTrabajos(12),
  ]);

  const enCurso = trabajos.filter((t) => t.estado === 'pendiente' || t.estado === 'tomado');

  return (
    <div className="panel">
      <header className="panel-cabecera">
        <div>
          <h1>Baúl de noticias</h1>
          <p>{noticias.length} noticias · elegí cuáles salen y en qué formato</p>
        </div>
        <a href="/" className="btn-fantasma">Ver el sitio</a>
      </header>

      {enCurso.length > 0 && (
        <section className="cola">
          <h2>Produciendo ahora</h2>
          <ul>
            {enCurso.map((t) => <EnCola key={t.id} trabajo={t} />)}
          </ul>
          <p className="aclara">
            El video se produce en una máquina con ffmpeg, no acá. Tarda entre uno y tres minutos:
            actualizá la página para ver cómo avanza.
          </p>
        </section>
      )}

      <nav className="filtros">
        <div className="grupo-filtro">
          <span>Estado</span>
          {[['guardada', 'Sin usar'], ['publicada', 'Publicadas'], ['descartada', 'Descartadas'], ['todas', 'Todas']].map(([v, t]) => (
            <a key={v} href={`/admin?estado=${v}${dia ? `&dia=${dia}` : ''}`} className={estado === v ? 'activo' : ''}>{t}</a>
          ))}
        </div>

        {dias.length > 1 && (
          <div className="grupo-filtro">
            <span>Día</span>
            <a href={`/admin?estado=${estado}`} className={!dia ? 'activo' : ''}>Todos</a>
            {dias.slice(0, 8).map((d) => (
              <a key={d.dia} href={`/admin?estado=${estado}&dia=${d.dia}`} className={dia === d.dia ? 'activo' : ''}>
                {fechaCorta(d.dia)} <b>{d.total}</b>
              </a>
            ))}
          </div>
        )}
      </nav>

      {noticias.length === 0 ? (
        <div className="vacio-panel">
          <strong>No hay noticias con ese filtro</strong>
          Corré <code>node src/baul.mjs</code> para llenar el baúl con lo del día.
        </div>
      ) : (
        <div className="lista">
          {noticias.map((n) => <Tarjeta key={n.id} nota={n} />)}
        </div>
      )}
    </div>
  );
}
