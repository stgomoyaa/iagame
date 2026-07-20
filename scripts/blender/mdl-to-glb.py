"""
Convierte modelos .mdl de Source a GLB, corriendo dentro de Blender con SourceIO.

No se invoca a mano: lo llama `scripts/mdl-to-glb.ts`, que arma el archivo de
trabajos y levanta Blender una sola vez para todo el lote (arrancar Blender
cuesta ~5s, no se paga 84 veces).

    blender --background --python scripts/blender/mdl-to-glb.py -- trabajos.json

El archivo de trabajos es una lista de {"mdl": ruta, "out": ruta}.

Tres cosas que este script decide, y el porqué:

1. **Se usa el modelo de mundo (`w_`), no el viewmodel (`v_`).** El `v_` de Source
   trae brazos modelados y rig de viewmodel; nuestro viewmodel anima por código
   en seis capas y pone su propia cámara. Importar brazos ajenos sería pelear
   contra el rig propio.

2. **Se descarta el esqueleto.** Se borra el armature, sus modificadores y los
   grupos de vértices, así el GLB sale sin JOINTS_0/WEIGHTS_0. Es la decisión de
   Santiago: de estos modelos se usa sólo la malla.

3. **Se unen las mallas de cada arma.** Un AK viene como cuerpo + cargador con el
   mismo material; unirlas deja un draw call en vez de dos.

IMPORTANTE: esto procesa contenido del Workshop, que es local y no se publica.
La salida va a `workshop-assets/`, gitignoreado. Ver `docs/WORKSHOP.md`.
"""

import json
import os
import sys
import traceback

import bpy

# 1 unidad de Source = 0.75 pulgadas = 0.01905 m. Es el default de SourceIO y
# sale a escala correcta: el AK-47 mide 0.80m, que es su largo real.
ESCALA_SOURCE = 0.01905


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


def unir_mallas() -> int:
    """Une todas las mallas en un solo objeto. Devuelve cuántas había."""
    mallas = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(mallas) < 2:
        return len(mallas)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mallas:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mallas[0]
    bpy.ops.object.join()
    return len(mallas)


def convertir(mdl: str, out: str) -> dict:
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
    partes = unir_mallas()

    mallas = [o for o in bpy.data.objects if o.type == "MESH"]
    if not mallas:
        raise RuntimeError("el import no dejó ninguna malla")

    malla = mallas[0]
    malla.data.calc_loop_triangles()
    dims = malla.dimensions

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
        "tris": len(malla.data.loop_triangles),
        "partes": partes,
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
            resultados.append(convertir(trabajo["mdl"], trabajo["out"]))
        except Exception as e:
            traceback.print_exc()
            resultados.append({"mdl": trabajo["mdl"], "ok": False, "error": str(e)})

    # El driver parsea esta línea. Blender escupe mucho ruido en stdout, así que
    # va marcada para poder aislarla.
    print("RESULTADOS_JSON:" + json.dumps(resultados))


main()
