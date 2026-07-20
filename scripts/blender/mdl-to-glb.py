"""
Convierte modelos .mdl de Source a GLB, corriendo dentro de Blender con SourceIO.

No se invoca a mano: lo llama `scripts/mdl-to-glb.ts`, que arma el archivo de
trabajos y levanta Blender una sola vez para todo el lote (arrancar Blender
cuesta ~5s, no se paga 84 veces).

    blender --background --python scripts/blender/mdl-to-glb.py -- trabajos.json

El archivo de trabajos es una lista de {"mdl": ruta, "out": ruta} y, opcional,
{"keep": [nombres de malla]} — ver `filtrar_bodygroups`.

Tres cosas que este script decide, y el porqué:

1. **Se usa el modelo de mundo (`w_`), no el viewmodel (`v_`).** El `v_` de Source
   trae brazos modelados y rig de viewmodel; nuestro viewmodel anima por código
   en seis capas y pone su propia cámara. Importar brazos ajenos sería pelear
   contra el rig propio.

2. **Se descarta el esqueleto.** Se borra el armature, sus modificadores y los
   grupos de vértices, así el GLB sale sin JOINTS_0/WEIGHTS_0. Es la decisión de
   Santiago: de estos modelos se usa sólo la malla.

3. **Se unen las mallas de cada arma EN DOS PARTES: cuerpo y cargador.** Un AK
   viene como `w_ak47.smd` + `w_ak47_mag.smd`. Antes se unía todo en un solo
   objeto para dejar un draw call; el costo era que la recarga no podía animar
   el cargador, porque después del join el cargador ya no existía como cosa
   separada — se leía como el arma agachándose, no como alguien cambiando un
   cargador.

   Ahora el cargador se preserva como objeto aparte con un nombre estable
   (`weapon_mag`), y todo lo demás —cuerpo, silenciador, mira— se une en
   `weapon_body`. Son dos draw calls por arma equipada en vez de uno, y
   `viewmodel/rig.ts` puede sacar el cargador, dejarlo caer y meter uno nuevo.

   No todas las armas lo traen: un revólver o una escopeta de bombeo no tienen
   cargador extraíble y salen con un solo objeto. El renderer y el rig
   degradan a la coreografía procedural sola cuando `weapon_mag` no está.

IMPORTANTE: esto procesa contenido del Workshop, que es local y no se publica.
La salida va a `workshop-assets/`, gitignoreado. Ver `docs/WORKSHOP.md`.
"""

import json
import os
import re
import sys
import traceback

import bpy

# 1 unidad de Source = 0.75 pulgadas = 0.01905 m. Es el default de SourceIO y
# sale a escala correcta: el AK-47 mide 0.80m, que es su largo real.
ESCALA_SOURCE = 0.01905

# Nombres de salida de las dos partes. Son el contrato con el resto del
# pipeline: `convert-source-weapons.ts` los usa para no fusionar las dos
# mallas (join con keepNamed) y `viewmodel/renderer.ts` busca el cargador por
# este nombre exacto. Si se cambian acá hay que cambiarlos en esos dos lados.
NOMBRE_CUERPO = "weapon_body"
NOMBRE_CARGADOR = "weapon_mag"

# El cargador llega como una malla llamada `w_<arma>_mag.smd`. Se detecta por
# SUFIJO del nombre de malla y no por el slug del arma porque los dos no
# siempre coinciden: `w_aug_scopeless.smd` convive con `w_aug_mag.smd`, así que
# derivar "aug_scopeless_mag" del slug no encontraría nada. El `.smd` y el
# `.001` opcionales cubren la extensión que deja SourceIO y el sufijo que
# agrega Blender ante nombres repetidos.
PATRON_CARGADOR = re.compile(r"_mag(\.smd)?(\.\d+)?$", re.IGNORECASE)

# Blender le agrega `.001`, `.002`... a un nombre repetido, y SourceIO deja la
# extensión `.smd`. Las dos cosas sobran para comparar contra la lista de
# piezas elegidas, que viene con nombres pelados (`stock_h`).
PATRON_SUFIJO_BLENDER = re.compile(r"(\.smd)?(\.\d+)?$", re.IGNORECASE)


def nombre_pelado(nombre: str) -> str:
    """`new/stock_h.smd.001` -> `stock_h`.

    La CARPETA también se pela, y no es cosmético: 3 de los 103 modelos
    (`c_mw3e_m4a1`, `c_mw3e_m16a4`, `c_mw2e_m9`) declaran sus piezas con ruta
    (`new/m4.smd`, `25chunk/m92.smd`) y Blender la conserva en el nombre del
    objeto. Con la carpeta puesta de un lado y no del otro, la comparación
    fallaba para TODAS las piezas y el filtro borraba el arma entera.

    Los dos lados de la comparación pasan por esta misma función justamente
    para que no puedan normalizar distinto.
    """
    sin_carpeta = nombre[nombre.rfind("/") + 1 :]
    return PATRON_SUFIJO_BLENDER.sub("", sin_carpeta, count=1)


def filtrar_bodygroups(keep) -> int:
    """Borra las mallas que NO son parte del arma elegida. Devuelve cuántas.

    Un `.mdl` con bodygroups declara piezas MUTUAMENTE EXCLUYENTES ("culata
    corta O culata larga O ninguna"), pero SourceIO las importa todas juntas y
    encimadas: el `c_cod4_ak47.mdl` entra con un AK normal Y un AK táctico
    completo ocupando el mismo espacio, más un lanzagranadas y dos culatas.
    Convertirlo así da un arma con el cuerpo duplicado.

    Cuál es la pieza buena no se puede ver en la malla —es un dato de la
    cabecera del `.mdl`—, así que la decide `scripts/lib/mdl-bodyparts.ts` y
    llega acá ya resuelta en `keep`. Este script sólo la aplica.

    Si `keep` viene vacío o ausente (los `w_` de CS, que no tienen bodygroups
    encimados) no se toca nada: el filtro es opt-in.
    """
    if not keep:
        return 0

    permitidas = {nombre_pelado(n).lower() for n in keep}
    borradas = 0
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        if nombre_pelado(obj.name).lower() not in permitidas:
            bpy.data.objects.remove(obj, do_unlink=True)
            borradas += 1

    # Si el filtro se comió todo, algo no coincide entre lo que dice la
    # cabecera y lo que nombró SourceIO. Fallar acá es MUY preferible a
    # exportar un GLB vacío: un arma invisible en el juego se descubre tarde y
    # se confunde con un problema de render.
    if not [o for o in bpy.data.objects if o.type == "MESH"]:
        raise RuntimeError(
            f"el filtro de bodygroups borró todas las mallas (keep={sorted(permitidas)})"
        )

    return borradas


def limpiar_escena() -> None:
    """Vacía la escena SIN tocar preferencias.

    `wm.read_factory_settings` haría lo mismo pero además desactiva los addons,
    o sea deja a SourceIO afuera y el import falla en silencio con FINISHED.
    """
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for bloque in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.armatures,
    ):
        for dato in list(bloque):
            bloque.remove(dato)


def descartar_esqueleto() -> None:
    """Borra armatures, modificadores de armature y grupos de vértices."""
    for obj in list(bpy.data.objects):
        if obj.type == "ARMATURE":
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if obj.type == "MESH":
            for mod in list(obj.modifiers):
                if mod.type == "ARMATURE":
                    obj.modifiers.remove(mod)
            obj.vertex_groups.clear()
            obj.parent = None


def _unir_grupo(objetos: list, nombre: str):
    """Une `objetos` en uno solo y lo renombra a `nombre`. Devuelve el objeto.

    Un grupo de uno no se une (join necesita al menos dos), pero sí se
    renombra: el nombre es el contrato, no el join.
    """
    if not objetos:
        return None
    if len(objetos) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objetos:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objetos[0]
        bpy.ops.object.join()
    resultado = objetos[0]
    resultado.name = nombre
    # El nombre del DATABLOCK de malla también: el exportador de glTF nombra la
    # malla con éste y el nodo con el del objeto. Dejarlos coherentes evita
    # tener que adivinar cuál de los dos miró un consumidor río abajo.
    resultado.data.name = nombre
    return resultado


def unir_por_parte() -> dict:
    """Une las mallas en dos objetos: `weapon_body` y `weapon_mag`.

    Todo lo que no sea el cargador (cuerpo, silenciador, mira) va al cuerpo:
    esas piezas no se animan por separado, así que separarlas sólo costaría
    draw calls. El cargador sí, y por eso es la única que se preserva.
    """
    mallas = [o for o in bpy.data.objects if o.type == "MESH"]
    cargadores = [o for o in mallas if PATRON_CARGADOR.search(o.name)]
    cuerpos = [o for o in mallas if o not in cargadores]

    # Un arma sin cuerpo no existe; si el patrón se comiera la única malla,
    # mejor fallar fuerte acá que exportar un GLB con sólo un cargador.
    if not cuerpos:
        raise RuntimeError(
            f"ninguna malla quedó como cuerpo (mallas: {[o.name for o in mallas]})"
        )

    cuerpo = _unir_grupo(cuerpos, NOMBRE_CUERPO)
    cargador = _unir_grupo(cargadores, NOMBRE_CARGADOR)

    return {
        "partes": len(mallas),
        "cuerpo": cuerpo,
        "cargador": cargador,
    }


def convertir(mdl: str, out: str, keep=None) -> dict:
    limpiar_escena()

    # El operador ignora `filepath` a secas: usa `directory` + `files`.
    directorio = os.path.dirname(mdl) + os.sep
    nombre = os.path.basename(mdl)
    bpy.ops.sourceio.mdl(
        directory=directorio,
        files=[{"name": nombre}],
        scale=ESCALA_SOURCE,
        import_physics=False,
        import_animations=False,
        import_textures=True,
        write_qc=False,
    )

    descartar_esqueleto()

    if not [o for o in bpy.data.objects if o.type == "MESH"]:
        raise RuntimeError("el import no dejó ninguna malla")

    # Antes de unir nada: unir primero fusionaría la variante descartada con la
    # buena y ya no habría forma de separarlas.
    descartadas = filtrar_bodygroups(keep)

    piezas = unir_por_parte()
    cuerpo = piezas["cuerpo"]
    cargador = piezas["cargador"]

    def tris(obj) -> int:
        obj.data.calc_loop_triangles()
        return len(obj.data.loop_triangles)

    # Las dimensiones reportadas son las del arma entera (cuerpo + cargador),
    # no las del cuerpo solo: es el número que se compara contra el largo real
    # del arma para validar la escala, y un AK sin cargador mide distinto.
    dims = cuerpo.dimensions
    tris_total = tris(cuerpo)
    if cargador is not None:
        tris_total += tris(cargador)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_skins=False,
        export_animations=False,
    )

    return {
        "mdl": mdl,
        "out": out,
        "ok": True,
        "tris": tris_total,
        "partes": piezas["partes"],
        "descartadas": descartadas,
        "cargador": cargador is not None,
        "dims": [round(dims.x, 4), round(dims.y, 4), round(dims.z, 4)],
        "texturas": len(bpy.data.images),
        "bytes": os.path.getsize(out),
    }


def main() -> None:
    bpy.ops.preferences.addon_enable(module="SourceIO")

    separador = sys.argv.index("--")
    with open(sys.argv[separador + 1]) as f:
        trabajos = json.load(f)

    resultados = []
    for trabajo in trabajos:
        try:
            resultados.append(
                convertir(trabajo["mdl"], trabajo["out"], trabajo.get("keep"))
            )
        except Exception as e:
            traceback.print_exc()
            resultados.append({"mdl": trabajo["mdl"], "ok": False, "error": str(e)})

    # El driver parsea esta línea. Blender escupe mucho ruido en stdout, así que
    # va marcada para poder aislarla.
    print("RESULTADOS_JSON:" + json.dumps(resultados))


main()
