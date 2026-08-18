"""
Saca el ancho real de cada carácter de las fuentes que se queman en el video.

Contar caracteres para repartir un titular es mentira: en Anton, una "I" mide un
tercio de lo que mide una "M", así que dos renglones con la misma cantidad de
letras salen con anchos muy distintos y uno queda visiblemente corto. Con la
tabla que genera esto, el repartidor mide en píxeles y los renglones salen
parejos de verdad.

Se corre a mano cuando cambia una fuente:

    python scripts/medir-fuentes.py
"""

import json
import os
from PIL import ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUENTES = {
    'anton': 'Anton-Regular.ttf',
    'inter': 'Inter.ttf',
    'montserrat': 'Montserrat.ttf',
}

# Todo lo que puede aparecer en un titular o una bajada en español.
LETRAS = (
    ' !"#$%&\'()*+,-./0123456789:;<=>?@'
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`'
    'abcdefghijklmnopqrstuvwxyz{|}~'
    'áéíóúüñÁÉÍÓÚÜÑ¿¡ºª°'
    '‘’“”–—…'
)

# Se mide a un tamaño grande y se divide: así el resultado es una fracción del
# cuerpo de la fuente y sirve para cualquier tamaño.
BASE = 200


def main():
    tabla = {}
    for nombre, archivo in FUENTES.items():
        ruta = os.path.join(RAIZ, 'assets', 'fonts', archivo)
        fuente = ImageFont.truetype(ruta, BASE)
        anchos = {}
        for c in LETRAS:
            anchos[c] = round(fuente.getlength(c) / BASE, 5)
        # Fallback para cualquier carácter que no esté en la lista.
        tabla[nombre] = {'anchos': anchos, 'porDefecto': round(fuente.getlength('n') / BASE, 5)}
        print(f'{nombre}: {len(anchos)} caracteres, la "M" mide {anchos["M"]:.3f} em')

    destino = os.path.join(RAIZ, 'assets', 'anchos-fuentes.json')
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(tabla, f, ensure_ascii=False, separators=(',', ':'))
    print(f'\nGuardado en {destino}')


if __name__ == '__main__':
    main()
