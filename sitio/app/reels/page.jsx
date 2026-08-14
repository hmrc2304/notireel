import { portada } from '../../lib/datos';
import Feed from './Feed';

export const revalidate = 300;

export const metadata = {
  title: 'Reels',
  description: 'Las noticias del día en video vertical, una atrás de otra.',
  alternates: { canonical: '/reels' },
};

export default async function Reels() {
  const notas = await portada({ limite: 30 });
  // Sin video no hay feed: una tarjeta fija entre videos corta el ritmo del scroll.
  const conVideo = notas.filter((n) => n.video_url);

  if (!conVideo.length) {
    return (
      <div className="contenedor vacio">
        <strong>Todavía no hay notas en video</strong>
        En cuanto el motor produzca las primeras, aparecen acá.
      </div>
    );
  }

  return <Feed notas={conVideo} />;
}
