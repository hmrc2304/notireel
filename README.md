# Motor de Noti Viral

Dos sistemas que comparten la misma marca y las mismas herramientas:

1. **El motor de video** toma las noticias que ya publica notiviral.com y las
   convierte en Reels con presentador, carruseles y placas, y los sube a las redes.
2. **El recolector** lee 24 medios internacionales y redacta notas propias que
   contrastan lo que dice cada uno.

El sitio no se toca. El motor lo lee desde afuera, así que puede seguir viviendo
en Lovable sin riesgo de romper nada.

---

## El motor de video

```
sitemap.xml de notiviral.com
        │
        ▼
  elegir noticia          descarta lo ya publicado
        │
        ▼
  guion (Claude)          libreto de 80-95 palabras + caption + hashtags
        │
        ▼
  control de imagen       ¿la foto sirve de fondo? mide resolución y la mira
        │                 si no: se genera una propia con GPT image 2
        ▼                 y la pieza lleva el sello "imagen ilustrativa"
  locución (ElevenLabs)   audio + posición temporal de cada palabra
        │
        ▼
  video (ffmpeg)          1080x1920, foto + marco + subtítulos sincronizados
        │
        ▼
  Instagram Reels + Facebook        (TikTok y YouTube, listos y sin credenciales)
```

De la misma nota salen además un **carrusel 1:1** y una **placa 4:5**, con
`src/tarjetas.mjs`. Tres piezas por noticia sin necesitar una noticia más.

## El recolector

```
24 feeds RSS            AP, EFE, Reuters, BBC, NYT, Guardian, Al Jazeera, DW,
      │                 France 24, Euronews, El País, ABC, El Mundo, NBC, CBS,
      │                 Sky, RT, CNN, Infobae, Clarín, La Nación, Google News
      ▼
  recolectar            ~770 noticias en las últimas 24 h, en 3 segundos
      │
      ▼
  agrupar               TF-IDF por coseno, después Claude fusiona lo que cruza
      │                 idiomas ("Earthquake in Colombia" = "Terremoto en Colombia")
      ▼
  rankear               que 7 medios cubran lo mismo es la mejor señal de que importa
      │
      ▼
  redactar              nota propia que atribuye cada dato y marca en qué difieren
```

## El sitio: NotiReel

**https://notiviral.gemasdigitales.com** — código en `sitio/`, Next.js sobre Vercel,
datos en el Supabase `notireel`.

Es un medio propio, no un espejo de notiviral.com. Lo que lo define, y conviene no
romper, es que las fuentes están a la vista: el sello de certeza, el conteo de medios,
el bloque "Qué dice cada fuente" y el aviso cuando la imagen es generada.

```bash
node src/sitio.mjs --preparar     # el bucket de imágenes, una sola vez
node src/publicar-notas.mjs 7     # recolecta, redacta y publica 7 notas
node src/sitio.mjs                # ver las últimas publicadas
```

El circuito quedó cerrado sin depender de Lovable:
`feeds → agrupar → redactar → sitio → video → redes`.

## Puesta en marcha

```bash
# 1. el presentador y su marco: se hacen una sola vez
node src/avatar.mjs ana        # o mateo / sofia
node src/marco.mjs ana

# 2. el bucket donde el video espera a que Meta lo baje
node src/publicar.mjs --preparar

# 3. probar que el token de Meta ve la página y la cuenta de Instagram
node src/publicar.mjs --verificar

# 4. una corrida completa sin publicar, para mirar el resultado
node src/motor.mjs --sin-publicar

# 5. la corrida de verdad
node src/motor.mjs
```

## Comandos útiles

| Comando | Para qué |
|---|---|
| `node src/seleccion.mjs` | ver qué noticia saldría ahora |
| `node src/imagen.mjs 6` | auditar si las imágenes de las últimas 6 notas sirven |
| `node src/previsualizar.mjs <id>` | rehacer un video sin volver a pagar la locución |
| `node src/voz.mjs` | ver cuántos créditos de ElevenLabs quedan |
| `node src/motor.mjs --forzar` | saltear la guarda de 45 minutos |
| `node src/recolector.mjs 24` | bajar todo lo publicado en las últimas 24 h |
| `node src/agrupar.mjs` | ver qué hechos cubren varios medios a la vez |
| `node src/redactar.mjs 3` | redactar 3 notas contrastando fuentes |
| `node src/tarjetas.mjs` | armar el carrusel y la placa de la última nota |
| `node src/publicar-video.mjs` | ver qué falta para TikTok y YouTube |

## Credenciales

Lo que ya está en `~/.env.apihub` se lee solo. Lo que falta va en un `.env`
propio: copiá `.env.ejemplo` y completá.

En GitHub Actions todo va como *secrets* del repositorio, con los mismos nombres.

## Decisiones que conviene conocer antes de tocar el código

- **La fuente son el sitemap y el JSON-LD del sitio**, no la base de Lovable. Sin
  claves de por medio y sin acoplarse a su esquema.
- **El texto dinámico se dibuja con libass, no con `drawtext`.** El marco fijo se
  captura una vez con Chrome headless y se reusa: rehacerlo por video sería caro
  y no cambia nada.
- **Los subtítulos usan los timestamps de ElevenLabs**, no un transcriptor. Un STT
  sería un segundo costo y una segunda fuente de error.
- **Los bloques de subtítulo son de una sola línea corta** (20 caracteres). Así no
  hay wrap automático y nunca queda una palabra huérfana colgando.
- **Se recorta el 18% inferior de la foto**: ahí es donde notiviral quema su marca
  de agua.
- **El video se borra del bucket apenas Meta lo baja.** Solo tiene que estar
  accesible dos minutos, así que 24 videos por día entran en el plan gratuito.
- **Si la imagen se generó, la pieza lo dice.** Publicar una recreación como si
  fuera una foto del hecho quema la credibilidad del medio.
- **Las imágenes se miden antes de mirarlas.** Muchos feeds entregan thumbnails de
  240 píxeles de ancho: descartarlos por tamaño cuesta nada y ahorra la llamada de visión.
- **El recolector usa RSS, no scraping de HTML.** El feed lo publica el medio para
  que se consuma: no se rompe con cada rediseño y no hay que esquivar nada.
- **Las notas se reescriben enteras y citan al medio.** Los hechos no tienen
  copyright, el texto sí. Copiar el cuerpo de un artículo no es una opción.
- **El texto de las tarjetas va en flujo, no con `bottom` fijo.** Con posiciones
  absolutas, un titular de cuatro líneas se montaba encima de la bajada.

## Lo que hay que vigilar

- **Créditos de ElevenLabs.** Cada video consume unos 550 caracteres. El motor se
  niega a arrancar por debajo de 700 y avisa, en vez de fallar a mitad de camino.
- **El cron de GitHub llega tarde y a veces se saltea corridas.** Por eso dispara
  en el minuto 7 y el motor tiene su propia guarda de 45 minutos para no publicar
  dos veces en la misma hora.
- **Instagram limita a 50 publicaciones por API cada 24 horas.** Con 24 por día
  hay margen, pero no para duplicar la frecuencia sin pensarlo.
