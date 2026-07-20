"""
Convierte los VIEWMODELS (`v_*.mdl`) de Source a GLB, CON esqueleto, brazos y
las secuencias de animación originales.

Es el hermano de `mdl-to-glb.py`, que convierte los modelos de MUNDO (`w_`) y
hace justo lo contrario: descarta el esqueleto y se queda sólo con la malla,
porque esas armas las anima nuestro rig procedural. Los dos scripts conviven a
propósito — las 40 armas CC0 no tienen `v_` y siguen dependiendo del otro
camino.

    blender --background --python scripts/blender/vmdl-to-glb.py -- trabajos.json

Qué decide este script, y el porqué:

1. **Se conserva el esqueleto y el skinning.** Es todo el punto: el `v_` trae
   58 huesos, entre ellos el del cargador (`AK47_clip`), el cerrojo, el
   gatillo y las dos manos con sus dedos. Sin esqueleto no hay animación
   importada, y sin animación importada la recarga vuelve a ser una
   coreografía nuestra que imita a CS en vez de ser la de CS.

2. **Se importan las animaciones a mano, no con SourceIO.** El import de
   animaciones del addon está ROTO en Blender 4.4+ / 5.x: usa
   `action.groups` y `action.fcurves`, que desaparecieron cuando Blender
   pasó a "slotted actions" (una Action ahora tiene slots -> layers ->
   strips -> channelbags, y las curvas cuelgan del channelbag). Levantar el
   addon con `import_animations=True` tira `AttributeError: 'Action' object
   has no attribute 'groups'` y aborta el import entero.

   Así que la conversión de datos de animación se hace acá, contra la API
   nueva. La MATEMÁTICA es la misma que la del addon y no es arbitraria: los
   datos de Source son pos/rot LOCALES al hueso padre, y lo que hay que
   keyframear en Blender es el `matrix_basis` (relativo al reposo). Poner
   `pose_bone.matrix = padre.matrix @ local` con todos los huesos en reposo
   hace que Blender resuelva esa conversión, y de ahí se leen `location` y
   `rotation_quaternion` ya en el espacio correcto.

3. **Los brazos salen como objeto APARTE del arma (`weapon_arms`).** No es un
   capricho de organización: el sistema de camuflajes (`src/game/skins/`)
   parcha el shader del material de la malla del arma. Si los brazos
   estuvieran unidos al cuerpo, el camuflaje pintaría también los guantes.
   Separados, el runtime le engancha la skin al cuerpo y deja los brazos con
   su textura.

4. **Se filtran las secuencias.** El `v_` trae `lookat01` (138 frames de una
   animación de "mirar el arma" que el juego usa en el menú) y variantes de
   fidget que no vamos a reproducir nunca. Exportarlas engorda el GLB sin que
   nada las lea. Se quedan sólo las cuatro que el runtime reproduce, y se les
   pone un NOMBRE CANÓNICO: los 42 modelos las llaman distinto
   (`ak47_reload`, `reload`, `glock_reload`, `start_reload`, `a_reload`...) y
   el runtime no puede tener una tabla de 42 filas para encontrar una recarga.

IMPORTANTE: esto procesa contenido del Workshop, que es local y no se publica.
Ver `docs/WORKSHOP.md`.
"""

import json
import os
import re
import sys
import traceback

import bpy
from mathutils import Matrix, Quaternion, Vector

# Misma escala que el pipeline `w_`: 1 unidad de Source = 0.75 pulgadas.
# Compartirla no es cosmético — las dos familias de armas tienen que medir lo
# mismo en pantalla o el arsenal se ve de dos juegos distintos.
ESCALA_SOURCE = 0.01905

# Nombres de salida. Son el contrato con `convert-source-viewmodels.ts` y con
# `viewmodel/renderer.ts`, que busca el cuerpo por este nombre exacto para
# engancharle el camuflaje (y NO se lo engancha a los brazos).
NOMBRE_CUERPO = "weapon_body"
NOMBRE_BRAZOS = "weapon_arms"

# El exportador de glTF traduce frames a segundos con el fps de la ESCENA, no
# con el de cada animación. Las secuencias de Source no comparten fps (la
# recarga del AK va a 30, su disparo a 20), así que con el fps de escena
# tal cual salía todo con la duración equivocada: la recarga del AK-47, que
# dura 2,43 s en CS, se exportaba como 3,04 s (74 frames / 24 fps de escena).
#
# La solución es fijar UN fps de escena y colocar cada keyframe en el instante
# que le corresponde traducido a ese reloj: frame_escena = i * FPS_ESCENA / fps.
# Así el .glb sale con la duración real de cada clip sin importar a qué fps se
# animó el original.
FPS_ESCENA = 30.0

# SourceIO nombra cada malla `<modelo>.mdl_<bodypart>_<smd>_MESH` y al objeto
# `<smd>`. El bodypart `arms` es el que trae manos, guantes y mangas; todo lo
# demás (`body`, `magazine`, `silencer`, `bullets`, `shells`, `bullet01..20`)
# es arma. Se detecta por el nombre del DATABLOCK de malla, que es el único de
# los dos que conserva el bodypart.
PATRON_BRAZOS = re.compile(r"_arms_", re.IGNORECASE)

# Fallback por MATERIAL, para los modelos que no separan los brazos en un
# bodypart. No es un caso hipotético: `v_knife_t.mdl` (los cuchillos de
# GameBanana) trae UN solo bodypart `studio` con un solo `ref.smd` adentro que
# fusiona hoja, manos y mangas, así que PATRON_BRAZOS no encuentra nada y las
# 22.484 caras caen enteras en `weapon_body`.
#
# Eso importa porque `weapon_body` es la malla a la que el runtime le engancha
# el camuflaje: con los brazos adentro, la skin del cuchillo pintaría también
# los guantes. La única costura que queda en ese modelo es el MATERIAL --el
# .smd usa uno para la hoja y otros para manga y piel-- así que se clasifica
# por ahí.
#
# Va como FALLBACK y no como criterio principal a propósito: para las 39 armas
# de fuego el bodypart ya funciona y es más confiable (un arma puede tener un
# material llamado "hand_grip" en la empuñadura y no es un brazo). Sólo se
# consulta cuando el bodypart no separó nada.
PATRON_BRAZOS_MATERIAL = re.compile(r"sleeve|arm|hand|glove|skin", re.IGNORECASE)

# Secuencias que el runtime reproduce, en orden de prioridad de match. La
# clave es el nombre canónico de salida; el valor es la lista de patrones que
# se prueban EN ORDEN sobre el nombre crudo (ya sin el `@` que Source le
# antepone). El primero que engancha gana.
#
# Por qué hay varios patrones por clip y no uno solo: los 42 modelos no
# comparten convención. Un `reload` puede llamarse `reload`, `ak47_reload`,
# `glock_reload`, `a_reload` o `reload_hammer`, y además conviven variantes
# que NO queremos (`empty_reload` del Negev, `reload2` de la CZ, el
# `after_reload` de las escopetas de bombeo). Los patrones están ordenados de
# más específico a más laxo justamente para que la variante buena gane.
SECUENCIAS = {
    # `start_reload` va ANTES que el laxo porque en las escopetas de bombeo
    # (nova, sawedoff, xm1014) la recarga real es `start_reload` + un bucle por
    # cartucho + `after_reload`; sin esta línea el patrón laxo engancharía
    # `after_reload`, que es sólo el remate y se ve como media recarga.
    "reload": [r"^start_reload$", r"^(\w+_)?reload$", r"reload"],
    "draw": [r"^(\w+_)?draw$", r"draw"],
    "idle": [r"^(\w+_)?idle$", r"idle$"],
    # Los tres últimos son de CUERPO A CUERPO y van AL FINAL a propósito: un
    # arma de fuego nunca los engancha (ningún `.mdl` de los 42 tiene "slash"
    # ni "stab" en el nombre de una secuencia), así que agregarlos no puede
    # cambiar qué clip elige ninguna de las 39 que ya funcionan.
    #
    # `midslash1` va antes que `stab` porque en el `v_knife_*` de Source el
    # ataque PRIMARIO (click izquierdo) es el tajo y el secundario (click
    # derecho) es la puñalada. `fire` es el clip que el runtime dispara al
    # atacar, así que le corresponde el tajo. Los `@stab_miss` y `@stab_miss2`
    # (el mismo gesto sin impacto) quedan afuera por el ANCLA `$` de estos
    # patrones, no por PATRON_EXCLUIDO: si acá se aflojara el ancla, el laxo
    # engancharía el "miss" y el cuchillo atacaría con la animación de fallar.
    "fire": [
        r"^(\w+_)?fire1$",
        r"^(\w+_)?fire$",
        r"^shoot1$",
        r"fire",
        r"^midslash1$",
        r"^(\w+_)?slash1?$",
        r"^stab$",
    ],
}

# Secuencias que nunca entran, pase lo que pase. `lookat*` son las más caras
# del archivo (138 frames) y el juego no las usa; `ironsight_*` y `*fidget*`
# son gestos de menú. El filtro va por separado del match de arriba porque
# `ironsight_fire` engancharía el patrón laxo de `fire`.
PATRON_EXCLUIDO = re.compile(r"lookat|fidget|ironsight|silencer_", re.IGNORECASE)


def limpiar_escena() -> None:
    """Vacía la escena SIN tocar preferencias (ver mdl-to-glb.py)."""
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for bloque in (
        bpy.data.actions,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.armatures,
    ):
        for dato in list(bloque):
            bloque.remove(dato)


def elegir_secuencias(nombres: list) -> dict:
    """Mapea nombre canónico -> índice en `anim_descs`.

    Devuelve sólo los que encontró: un arma sin `fire` propio (varias comparten
    la de disparo con otra secuencia) simplemente no trae esa entrada, y el
    runtime cae a su capa de kick procedural, que ya existe.
    """
    limpios = [n.lstrip("@") for n in nombres]
    elegidas = {}
    usados = set()

    for canonico, patrones in SECUENCIAS.items():
        for patron in patrones:
            encontrado = None
            for i, nombre in enumerate(limpios):
                if i in usados or PATRON_EXCLUIDO.search(nombre):
                    continue
                if re.search(patron, nombre, re.IGNORECASE):
                    encontrado = i
                    break
            if encontrado is not None:
                elegidas[canonico] = encontrado
                usados.add(encontrado)
                break

    return elegidas


def construir_accion(
    arm, mdl, indice: int, nombre: str, frames: int, fps: float
) -> None:
    """Crea una Action de Blender 5 con las curvas de `mdl.anim_descs[indice]`.

    Ver el punto 2 del encabezado para el porqué de la matemática y de no usar
    el importador del addon.
    """
    datos = mdl.animations[indice]
    # Ver FPS_ESCENA: el keyframe i del original va al instante i/fps, que en el
    # reloj de la escena es ese instante por FPS_ESCENA.
    paso = FPS_ESCENA / fps if fps else 1.0

    accion = bpy.data.actions.new(nombre)
    # Sin fake user, una Action sin nadie que la referencie se descarta al
    # asignar la siguiente y el GLB sale con una sola animación.
    accion.use_fake_user = True
    slot = accion.slots.new(id_type="OBJECT", name=nombre)
    canal_bolsa = (
        accion.layers.new("capa")
        .strips.new(type="KEYFRAME")
        .channelbag(slot, ensure=True)
    )

    arm.animation_data.action = accion
    arm.animation_data.action_slot = slot

    curvas = {}
    for hueso in mdl.bones:
        pose_bone = arm.pose.bones.get(hueso.name)
        if pose_bone is None:
            continue
        pose_bone.rotation_mode = "QUATERNION"
        prefijo = f'pose.bones["{hueso.name}"].'
        pos = []
        rot = []
        for i in range(3):
            c = canal_bolsa.fcurves.new(data_path=prefijo + "location", index=i)
            c.keyframe_points.add(frames)
            pos.append(c)
        for i in range(4):
            c = canal_bolsa.fcurves.new(
                data_path=prefijo + "rotation_quaternion", index=i
            )
            c.keyframe_points.add(frames)
            rot.append(c)
        curvas[hueso.name] = (pos, rot)

    # Los huesos se recorren en el orden del MDL, que es padres antes que
    # hijos. Importa: la conversión de cada hueso lee `pose_bone.parent.matrix`,
    # y ese valor tiene que ser el de REPOSO — por eso cada hueso se devuelve a
    # identidad al terminar (`matrix = Identity`), y no queda posado
    # contaminando a sus hijos.
    for id_hueso, hueso in enumerate(mdl.bones):
        pose_bone = arm.pose.bones.get(hueso.name)
        if pose_bone is None:
            continue
        curvas_pos, curvas_rot = curvas[hueso.name]
        for frame in range(frames):
            muestra = datos[frame, id_hueso]
            pose_bone.matrix_basis.identity()
            traslacion = Vector(muestra["pos"]) * ESCALA_SOURCE
            x, y, z, w = muestra["rot"]
            local = (
                Matrix.Translation(traslacion)
                @ Quaternion((w, x, y, z)).to_matrix().to_4x4()
            )

            if pose_bone.parent:
                pose_bone.matrix = pose_bone.parent.matrix @ local
                p, r = pose_bone.location, pose_bone.rotation_quaternion
            else:
                p, r, _ = (pose_bone.matrix.inverted() @ local).decompose()

            instante = frame * paso
            for i in range(3):
                curvas_pos[i].keyframe_points[frame].co = (instante, p[i])
            for i in range(4):
                curvas_rot[i].keyframe_points[frame].co = (instante, r[i])

            pose_bone.matrix = Matrix.Identity(4)

    for curvas_pos, curvas_rot in curvas.values():
        for c in curvas_pos + curvas_rot:
            c.update()


def importar_animaciones(arm, mdl) -> list:
    """Convierte las secuencias elegidas en Actions. Devuelve su metadata."""
    elegidas = elegir_secuencias([a.name for a in mdl.anim_descs])
    if not elegidas:
        return []

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.context.scene.render.fps = int(FPS_ESCENA)
    bpy.ops.object.mode_set(mode="POSE")
    if not arm.animation_data:
        arm.animation_data_create()

    hechas = []
    for canonico, indice in elegidas.items():
        desc = mdl.anim_descs[indice]
        # Un clip de 1 frame no es una animación, es una pose. El `idle` de
        # varias armas tiene 2 frames idénticos y eso está bien (el runtime lo
        # usa como pose de reposo), pero exportar uno de 0 frames rompería el
        # exportador de glTF.
        if desc.frame_count < 1:
            continue
        construir_accion(arm, mdl, indice, canonico, desc.frame_count, desc.fps)
        hechas.append(
            {
                "clip": canonico,
                "origen": desc.name.lstrip("@"),
                "frames": desc.frame_count,
                "fps": desc.fps,
                # Duración en segundos. La escribe el índice y el runtime la
                # usa para decidir a qué velocidad reproducir cada clip contra
                # el `reloadTime` que ya tienen las estadísticas del arma.
                "duracion": round((desc.frame_count - 1) / desc.fps, 4)
                if desc.fps
                else 0.0,
            }
        )

    bpy.ops.object.mode_set(mode="OBJECT")
    return hechas


def _imagen_del_material(material) -> bool:
    """True si el material ya tiene una textura enchufada al COLOR BASE.

    La pregunta no es "¿tiene alguna imagen?" sino "¿tiene una imagen donde el
    exportador de glTF la va a buscar?". Cuando SourceIO falla a mitad de armar
    el shader deja el árbol con nodos de imagen sueltos —el normal map, la
    máscara de phong— que nunca llegan al Base Color: preguntando por "alguna
    imagen" el material parecería sano y el rescate no se dispararía, que es
    exactamente el bug que tuvo la primera versión de esta función.
    """
    if not material.use_nodes or material.node_tree is None:
        return False
    for nodo in material.node_tree.nodes:
        if nodo.type != "BSDF_PRINCIPLED":
            continue
        entrada = nodo.inputs.get("Base Color")
        if entrada is not None and entrada.is_linked:
            return True
    return False


def _basetexture_del_vmt(ruta_vmt: str):
    """Lee `$basetexture` de un .vmt sin depender del loader de shaders."""
    with open(ruta_vmt, encoding="latin1") as f:
        for linea in f:
            partes = re.findall(r'"([^"]+)"', linea)
            if len(partes) >= 2 and partes[0].lower() == "$basetexture":
                return partes[1]
    return None


def rescatar_materiales_sin_textura(raiz_materiales: str) -> int:
    """Le engancha la textura base a los materiales que SourceIO dejó en blanco.

    Por qué hace falta. Los brazos de CS:GO usan el shader `character`, que
    SourceIO no implementa: al importarlos tira `NotImplementedError:
    create_nodes method should be implemented by Source1ShaderBase`, se traga
    la excepción y deja el material SIN textura. Con `baseColorFactor` en
    blanco, el horneado de color por vértice (convert-source-viewmodels.ts)
    hornea blanco, y los brazos salen como una silueta blanca brillante — que
    es peor que no tener brazos, porque se lee como un error de render.

    El rescate no intenta reimplementar el shader: sólo abre el `.vmt` como
    texto, saca `$basetexture` y carga ese `.vtf` con el importador de texturas
    del addon, que sí funciona. Se pierde el phong, la máscara de rimlight y el
    normal map — nada de lo cual sobrevive de todos modos al horneado a
    `COLOR_0`, porque el viewmodel se dibuja sin iluminación.

    Devuelve cuántos materiales rescató.
    """
    from SourceIO.blender_bindings.source1.vtf import import_texture
    from SourceIO.library.utils import FileBuffer, TinyPath

    vmts = {}
    for carpeta, _, archivos in os.walk(raiz_materiales):
        for archivo in archivos:
            if archivo.lower().endswith(".vmt"):
                vmts.setdefault(
                    os.path.splitext(archivo)[0].lower(), os.path.join(carpeta, archivo)
                )

    rescatados = 0
    for material in bpy.data.materials:
        if _imagen_del_material(material):
            continue
        ruta_vmt = vmts.get(material.name.lower())
        if ruta_vmt is None:
            continue
        base = _basetexture_del_vmt(ruta_vmt)
        if base is None:
            continue
        ruta_vtf = os.path.join(raiz_materiales, base.replace("\\", "/") + ".vtf")
        if not os.path.exists(ruta_vtf):
            continue

        try:
            with FileBuffer(ruta_vtf) as buf:
                imagen = import_texture(TinyPath(ruta_vtf), buf)
        except Exception:
            traceback.print_exc()
            continue
        if imagen is None:
            continue

        material.use_nodes = True
        arbol = material.node_tree

        # Cuando SourceIO se cae armando el shader deja el árbol COMPLETAMENTE
        # vacío: ni BSDF ni nodo de salida. Un árbol sin salida no exporta
        # nada, así que hay que reconstruir la cadena entera y no sólo colgar
        # la textura de un BSDF que se da por existente — ése fue el motivo por
        # el que la primera versión de este rescate corría sin efecto.
        bsdf = next((n for n in arbol.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            bsdf = arbol.nodes.new("ShaderNodeBsdfPrincipled")
        salida = next((n for n in arbol.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if salida is None:
            salida = arbol.nodes.new("ShaderNodeOutputMaterial")
        if not salida.inputs["Surface"].is_linked:
            arbol.links.new(bsdf.outputs["BSDF"], salida.inputs["Surface"])

        nodo_tex = arbol.nodes.new("ShaderNodeTexImage")
        nodo_tex.image = imagen
        arbol.links.new(nodo_tex.outputs["Color"], bsdf.inputs["Base Color"])
        rescatados += 1

    return rescatados


def _unir_grupo(objetos: list, nombre: str):
    """Une `objetos` en uno y lo renombra. Igual que en mdl-to-glb.py."""
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
    resultado.data.name = nombre
    return resultado


def _material_de(obj) -> str:
    """Nombre del material que usa la malla, leído de su primera cara.

    Se lee de la CARA y no de `data.materials[0]` porque `separate(MATERIAL)`
    conserva todos los slots en cada pedazo y sólo cambia a cuál apunta cada
    cara: mirar el slot 0 devolvería el mismo material para todos los pedazos.
    """
    if not obj.data.materials or not obj.data.polygons:
        return ""
    indice = obj.data.polygons[0].material_index
    material = obj.data.materials[indice] if indice < len(obj.data.materials) else None
    return material.name if material else ""


def _separar_por_material(mallas: list) -> list:
    """Parte cada malla en una por material. Las de un solo material pasan igual."""
    salida = []
    for obj in mallas:
        if len(obj.data.materials) <= 1:
            salida.append(obj)
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="MATERIAL")
        bpy.ops.object.mode_set(mode="OBJECT")
        # `separate` deja seleccionados el original y los pedazos nuevos.
        salida.extend([o for o in bpy.context.selected_objects if o.type == "MESH"])
    return salida


def unir_por_parte() -> dict:
    """Une las mallas en `weapon_body` y `weapon_arms`.

    El join de Blender preserva grupos de vértices y el modificador de
    armature, así que las dos partes siguen skinneadas al mismo esqueleto
    después de unirse. Es lo que permite colapsar los 20 objetos `bullet01..20`
    de una escopeta en un solo draw call sin perder la animación de cada
    cartucho.
    """
    mallas = [o for o in bpy.data.objects if o.type == "MESH"]
    brazos = [o for o in mallas if PATRON_BRAZOS.search(o.data.name)]

    # Fallback por material (ver PATRON_BRAZOS_MATERIAL): sólo si el bodypart
    # no separó NADA. Se parte por material y se reclasifica; si aún así no
    # aparece ningún brazo, se sigue con todo como cuerpo, que es exactamente
    # lo que hacía antes este código. O sea: no puede empeorar ningún caso que
    # hoy funcione, sólo agrega separación donde no había ninguna.
    if not brazos:
        piezas = _separar_por_material(mallas)
        brazos = [o for o in piezas if PATRON_BRAZOS_MATERIAL.search(_material_de(o))]
        mallas = piezas

    cuerpos = [o for o in mallas if o not in brazos]

    if not cuerpos:
        raise RuntimeError(
            f"ninguna malla quedó como cuerpo ({[o.data.name for o in mallas]})"
        )

    return {
        "partes": len(mallas),
        "cuerpo": _unir_grupo(cuerpos, NOMBRE_CUERPO),
        "brazos": _unir_grupo(brazos, NOMBRE_BRAZOS),
    }


def convertir(mdl_path: str, out: str, melee: bool = False) -> dict:
    from SourceIO.library.models.mdl.v49.mdl_file import MdlV49
    from SourceIO.library.utils import FileBuffer

    limpiar_escena()

    directorio = os.path.dirname(mdl_path) + os.sep
    nombre = os.path.basename(mdl_path)
    # `import_animations=False` a propósito: el importador del addon está roto
    # en Blender 5 (punto 2 del encabezado) y aborta el import ENTERO, no sólo
    # las animaciones. Las traemos nosotros abajo.
    bpy.ops.sourceio.mdl(
        directory=directorio,
        files=[{"name": nombre}],
        scale=ESCALA_SOURCE,
        import_physics=False,
        import_animations=False,
        import_textures=True,
        write_qc=False,
    )

    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("el import no dejó armature: sin esqueleto no hay animación")

    with FileBuffer(mdl_path) as buf:
        mdl = MdlV49.from_buffer(buf)

    # El pack tiene sus materiales en `<pack>/materials`, hermano de `models`.
    # Se deriva de la ruta del .mdl para no depender de un argumento más.
    raiz_pack = mdl_path
    for _ in range(4):
        raiz_pack = os.path.dirname(raiz_pack)
    rescatados = rescatar_materiales_sin_textura(os.path.join(raiz_pack, "materials"))

    clips = importar_animaciones(arm, mdl)
    if not melee and not any(c["clip"] == "reload" for c in clips):
        # Falla fuerte: un viewmodel sin recarga no cumple el único motivo por
        # el que se trae. Mejor enterarse acá que en pantalla.
        #
        # La excepción es el CUERPO A CUERPO, y es una excepción real, no una
        # forma de apagar el guard cuando molesta: un cuchillo no recarga, así
        # que exigirle recarga es pedirle un clip que el archivo no puede
        # tener. `v_knife_t.mdl` trae `@idle @draw @stab @midslash1 @midslash2`
        # y ninguna recarga, y eso es correcto, no un modelo incompleto.
        #
        # Sigue siendo opt-in POR TRABAJO (`"melee": true`) y no un `try`
        # alrededor: para las 39 armas de fuego el guard queda igual de duro, y
        # un `v_` de fusil al que se le perdió la recarga sigue fallando acá.
        raise RuntimeError(
            f"no se encontró recarga entre {[a.name for a in mdl.anim_descs]}"
        )
    if melee and not any(c["clip"] == "fire" for c in clips):
        # El equivalente melee del guard de arriba: si un cuchillo entra sin
        # clip de ataque, queda un arma que no hace nada al hacer click.
        raise RuntimeError(
            f"melee sin clip de ataque entre {[a.name for a in mdl.anim_descs]}"
        )

    piezas = unir_por_parte()
    cuerpo = piezas["cuerpo"]
    brazos = piezas["brazos"]

    def tris(obj) -> int:
        obj.data.calc_loop_triangles()
        return len(obj.data.loop_triangles)

    tris_cuerpo = tris(cuerpo)
    tris_brazos = tris(brazos) if brazos is not None else 0

    os.makedirs(os.path.dirname(out), exist_ok=True)
    # `export_apply=False` es obligatorio acá y NO es el default que usa el
    # pipeline `w_`: aplicar modificadores sobre una malla con modificador de
    # armature la congela en la pose de reposo y borra el skinning.
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_bake_animation=False,
        export_optimize_animation_size=False,
    )

    return {
        "mdl": mdl_path,
        "out": out,
        "ok": True,
        "tris": tris_cuerpo + tris_brazos,
        "tris_cuerpo": tris_cuerpo,
        "tris_brazos": tris_brazos,
        "brazos": brazos is not None,
        "huesos": len(arm.pose.bones),
        "clips": clips,
        "partes": piezas["partes"],
        "dims": [round(d, 4) for d in cuerpo.dimensions],
        "texturas": len(bpy.data.images),
        "rescatados": rescatados,
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
                convertir(trabajo["mdl"], trabajo["out"], trabajo.get("melee", False))
            )
        except Exception as e:
            traceback.print_exc()
            resultados.append({"mdl": trabajo["mdl"], "ok": False, "error": str(e)})

    print("RESULTADOS_JSON:" + json.dumps(resultados))


main()
