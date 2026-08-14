import { todasParaIndice, SECCIONES } from '../lib/datos';

const SITIO = process.env.NEXT_PUBLIC_SITIO ?? 'https://notiviral.gemasdigitales.com';

export const revalidate = 1800;

export default async function sitemap() {
  const notas = await todasParaIndice();

  return [
    { url: SITIO, lastModified: new Date(), changeFrequency: 'hourly', priority: 1 },
    ...SECCIONES.map((s) => ({
      url: `${SITIO}/seccion/${s.toLowerCase()}`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.8,
    })),
    ...notas.map((n) => ({
      url: `${SITIO}/nota/${n.slug}`,
      lastModified: new Date(n.actualizada_en ?? n.publicada_en),
      changeFrequency: 'daily',
      priority: 0.7,
    })),
  ];
}
