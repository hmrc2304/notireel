import { todasParaIndice } from '../../lib/datos';

const SITIO = process.env.NEXT_PUBLIC_SITIO ?? 'https://notiviral.gemasdigitales.com';

export const revalidate = 900;

/** Los & sueltos y los < rompen el XML sin dar error visible. */
function escapar(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function GET() {
  const notas = await todasParaIndice(60);

  const items = notas.map((n) => `    <item>
      <title>${escapar(n.titular)}</title>
      <link>${SITIO}/nota/${n.slug}</link>
      <guid isPermaLink="true">${SITIO}/nota/${n.slug}</guid>
      <description>${escapar(n.bajada)}</description>
      <category>${escapar(n.seccion)}</category>
      <pubDate>${new Date(n.publicada_en).toUTCString()}</pubDate>
    </item>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>NotiReel</title>
    <link>${SITIO}</link>
    <description>Noticias del mundo con las fuentes a la vista.</description>
    <language>es-AR</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITIO}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=900',
    },
  });
}
