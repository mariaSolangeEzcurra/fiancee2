"""
Simulador de factibilidad de un nuevo contrato.

Antes de aceptar un contrato responde si se puede producir a tiempo,
usando datos reales:
- trabajos ya comprometidos (reservas de los contratos vigentes),
- horas que requiere cada vestido (ruta y tiempos ajustados),
- taller (A, C o tienda),
- disponibilidad real del personal (horarios flexibles y ausencias).

Veredicto:
- FACTIBLE: llega con margen y sin presión.
- FACTIBLE_CON_CONDICIONES: llega, pero con poco margen, en temporada
  alta o con un área muy cargada (se listan las condiciones).
- NO_FACTIBLE: no llega a la fecha o faltan horas. Se sugiere la fecha
  más cercana posible y se indica el área cuello de botella.

No guarda nada en la base de datos.
"""

from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.utils import timezone

from core.models import PlantillaOperacion, RutaProduccion, TipoVestido, Trabajadora
from core.services.planificacion import (
    CERO,
    CapacidadTaller,
    calcular_plan,
    dias_bordado,
    es_bordado,
    evaluar_temporada_alta,
    plantillas_de_ruta,
    vestidos_activos_hasta,
)

MARGEN_DIAS_MINIMO = 7
UTILIZACION_ALTA = Decimal("0.85")
AREA_NOMBRE = dict(Trabajadora.Area.choices)


def _resolver_items(items):
    resueltos = []
    for i, item in enumerate(items, start=1):
        tipo = TipoVestido.objects.filter(pk=item.get("tipo_vestido"), activo=True).first()
        if tipo is None:
            raise ValidationError(f"Vestido {i}: el tipo de vestido no existe.")
        ruta = RutaProduccion.objects.filter(
            tipo_vestido=tipo, taller=item.get("taller"), activa=True
        ).first()
        if ruta is None:
            raise ValidationError(
                f"Vestido {i}: «{tipo}» no tiene ruta activa en el taller {item.get('taller')}."
            )
        plantillas = plantillas_de_ruta(ruta.id)
        validas = {p.id for p in plantillas}
        ajustes = {}
        for proceso in item.get("procesos") or []:
            pid = proceso.get("plantilla")
            if pid not in validas:
                raise ValidationError(f"Vestido {i}: un proceso no pertenece a la ruta.")
            ajustes[pid] = (Decimal(str(proceso.get("horas", 0))), proceso.get("incluido", True))
        for _ in range(max(1, int(item.get("cantidad") or 1))):
            resueltos.append({
                "nombre": f"{tipo.nombre} · {ruta.get_taller_display()}",
                "tipo_vestido": tipo,
                "ruta": ruta,
                "plantillas": plantillas,
                "ajustes": ajustes,
            })
    return resueltos


def _planificar_todos(items, capacidad, inicio, fecha_limite, factor):
    cap = capacidad.clone()
    planes = []
    for item in items:
        plan = calcular_plan(item["plantillas"], item["ajustes"], cap, inicio, fecha_limite, factor)
        plan["nombre"] = item["nombre"]
        plan["taller"] = item["ruta"].taller
        planes.append(plan)
    return planes, cap


def _llega(planes, fecha_limite):
    return all(p["fecha_fin"] <= fecha_limite and p["horas_sin_asignar"] == 0 for p in planes)


def simular(items, fecha_entrega, fecha_evento=None):
    hoy = timezone.localdate()
    if not items:
        raise ValidationError("Agrega al menos un vestido.")
    if fecha_entrega < hoy:
        raise ValidationError("La fecha de entrega no puede estar en el pasado.")
    if fecha_evento and fecha_entrega > fecha_evento:
        raise ValidationError("La fecha de entrega no puede ser posterior al evento.")

    resueltos = _resolver_items(items)

    # Horizonte amplio para poder sugerir una fecha alternativa.
    capacidad = CapacidadTaller(hoy, dias=max(400, (fecha_entrega - hoy).days + 400))

    temporada = evaluar_temporada_alta(capacidad, hoy, fecha_entrega)
    factor = Decimal(str(temporada["factor"]))

    planes, cap_final = _planificar_todos(resueltos, capacidad, hoy, fecha_entrega, factor)
    llega = _llega(planes, fecha_entrega)
    fecha_fin = max(p["fecha_fin"] for p in planes)
    margen = (fecha_entrega - fecha_fin).days
    sin_asignar = sum((p["horas_sin_asignar"] for p in planes), CERO)

    # ---- Áreas: capacidad entre hoy y la entrega, antes y después.
    antes = capacidad.resumen_por_area(hoy, fecha_entrega)
    despues = cap_final.resumen_por_area(hoy, fecha_entrega)
    necesarias = {}
    sin_asignar_area = {}
    trabajadoras_area = {}
    for plan in planes:
        for op in plan["operaciones"]:
            if op.get("omitido") or op["tipo_tiempo"] != PlantillaOperacion.TipoTiempo.TRABAJO:
                continue
            horas = Decimal(op.get("horas_con_holgura") or op["horas"])
            necesarias[op["area"]] = necesarias.get(op["area"], CERO) + horas
            for a in op["asignaciones"]:
                trabajadoras_area.setdefault(op["area"], set()).add(a["trabajadora"])
        for area, h in plan["sin_asignar_por_area"].items():
            sin_asignar_area[area] = sin_asignar_area.get(area, CERO) + h

    areas = []
    for area in sorted(set(antes) | set(necesarias)):
        cap_a = antes.get(area, {"capacidad": CERO, "comprometidas": CERO, "trabajadoras": set()})
        cap_d = despues.get(area, cap_a)
        capacidad_h = cap_a["capacidad"]
        comprometidas = cap_a["comprometidas"]
        libres = max(CERO, capacidad_h - comprometidas)
        necesita = necesarias.get(area, CERO)
        util_actual = (comprometidas / capacidad_h) if capacidad_h > 0 else (Decimal("1") if necesita else CERO)
        util_despues = (cap_d["comprometidas"] / capacidad_h) if capacidad_h > 0 else (Decimal("1") if necesita else CERO)
        falta = sin_asignar_area.get(area, CERO)
        if falta > 0 or (necesita > libres):
            estado = "bad"
        elif util_despues >= UTILIZACION_ALTA:
            estado = "risk"
        else:
            estado = "ok"
        if necesita == 0 and capacidad_h == 0:
            continue
        areas.append({
            "area": area,
            "nombre": AREA_NOMBRE.get(area, area.title()),
            "capacidad": float(round(capacidad_h, 2)),
            "comprometidas": float(round(comprometidas, 2)),
            "disponibles": float(round(libres, 2)),
            "necesarias": float(round(necesita, 2)),
            "sin_asignar": float(round(falta, 2)),
            "margen": float(round(libres - necesita, 2)),
            "utilizacion_actual": round(float(util_actual), 4),
            "utilizacion_despues": round(float(util_despues), 4),
            "estado": estado,
            "trabajadoras": sorted(cap_a["trabajadoras"]),
            "trabajadoras_asignadas": sorted(trabajadoras_area.get(area, set())),
        })

    # ---- Cuello de botella: área con horas sin asignar o más cargada.
    con_necesidad = [a for a in areas if a["necesarias"] > 0]
    cuello = None
    if con_necesidad:
        cuello = max(
            con_necesidad,
            key=lambda a: (a["sin_asignar"], a["necesarias"] > a["disponibles"], a["utilizacion_despues"]),
        )

    # ---- Cola: vestidos que ya están antes en el taller.
    en_cola = vestidos_activos_hasta(fecha_entrega)
    horas_cola = sum(
        (max(CERO, a["comprometidas"]) for a in antes.values()), CERO
    )

    # ---- Veredicto.
    condiciones = []
    motivos = []
    notas = []

    # Con bordado, el vestido termina cerca de la entrega por regla del
    # taller; el margen real es el tiempo libre antes de empezar el bordado.
    holguras = [p["holgura_bordado"] for p in planes if p["holgura_bordado"] is not None]
    margen_real = min(holguras) if holguras else margen
    inicios_bordado = [p["inicio_bordado"] for p in planes if p["inicio_bordado"]]
    if inicios_bordado:
        notas.append(
            f"El bordado empieza el {min(inicios_bordado):%d/%m/%Y} "
            f"({dias_bordado()} días antes de la entrega)."
        )

    # ---- Diagnóstico por vestido: ¿llega? y si no, ¿por qué?
    def _dias(op):
        return (op["fin"] - op["inicio"]).days

    resumen_vestidos = []
    causas = []
    def _llegaria_sin_espera(item, espera, cap_base):
        """Vuelve a calcular el vestido con esa espera en cero, con el taller
        tal como queda después de los vestidos anteriores del mismo pedido."""
        ajustes = dict(item["ajustes"])
        ajustes[espera["plantilla_id"]] = (Decimal("0"), True)
        prueba = calcular_plan(item["plantillas"], ajustes, cap_base.clone(), hoy, fecha_entrega, factor)
        return prueba["fecha_fin"] <= fecha_entrega and prueba["horas_sin_asignar"] == 0

    cap_seq = capacidad.clone()
    for item, plan in zip(resueltos, planes):
        cap_base = cap_seq.clone()
        calcular_plan(item["plantillas"], item["ajustes"], cap_seq, hoy, fecha_entrega, factor)
        limite = plan["inicio_bordado"] or fecha_entrega
        a_tiempo = plan["fecha_fin"] <= fecha_entrega and plan["horas_sin_asignar"] == 0
        ops = [o for o in plan["operaciones"] if not o.get("omitido")]
        causa = None
        espera = next(
            (o for o in ops if o["tipo_tiempo"] == PlantillaOperacion.TipoTiempo.ESPERA
             and Decimal(o["horas"]) > 0 and o["fin"] > limite),
            None,
        )
        if not a_tiempo and espera and _llegaria_sin_espera(item, espera, cap_base):
            causa = {
                "tipo": "ESPERA",
                "area": None,
                "texto": (
                    f"solo la espera de «{espera['operacion']}» toma {_dias(espera)} días "
                    f"(hasta el {espera['fin']:%d/%m/%Y})."
                ),
            }
        elif plan["horas_sin_asignar"] > 0:
            area = max(plan["sin_asignar_por_area"].items(), key=lambda x: x[1])[0]
            causa = {
                "tipo": "CAPACIDAD",
                "area": area,
                "texto": (
                    f"faltan {round(float(plan['horas_sin_asignar']), 1)} h de "
                    f"{AREA_NOMBRE.get(area, area).lower()}: no hay personal disponible."
                ),
            }
        elif not a_tiempo:
            trabajo = [o for o in ops if o["tipo_tiempo"] == PlantillaOperacion.TipoTiempo.TRABAJO]
            larga = max(trabajo, key=_dias) if trabajo else None
            area = larga["area"] if larga else None
            area_info = next((a for a in areas if a["area"] == area), None)
            libres_b = None
            if larga and es_bordado(larga["operacion"]) and plan["inicio_bordado"]:
                ini = plan["inicio_bordado"]
                ventana = capacidad.resumen_por_area(ini, fecha_entrega).get(area, {})
                libres_b = max(CERO, ventana.get("capacidad", CERO) - ventana.get("comprometidas", CERO))
            if libres_b is not None and libres_b < necesarias.get(area, CERO):
                causa = {
                    "tipo": "TIEMPO",
                    "area": area,
                    "titulo": "No alcanzan las horas de bordado",
                    "texto": (
                        f"por regla, el bordado se hace en los últimos {dias_bordado()} días antes de la "
                        f"entrega (desde el {ini:%d/%m/%Y}). En esos días el personal de bordado tiene "
                        f"{round(float(libres_b))} h libres y este pedido necesita "
                        f"{round(float(necesarias.get(area, CERO)))} h de bordado."
                    ),
                }
            elif area_info and area_info["estado"] == "bad":
                causa = {
                    "tipo": "CAPACIDAD",
                    "area": area,
                    "texto": (
                        f"{area_info['nombre'].lower()} necesita {round(area_info['necesarias'])} h para este pedido "
                        f"y solo le quedan {round(area_info['disponibles'])} h libres hasta la entrega."
                    ),
                }
            else:
                causa = None
        if not a_tiempo and causa is None:
            dias_espera = sum(
                _dias(o) for o in ops if o["tipo_tiempo"] == PlantillaOperacion.TipoTiempo.ESPERA
            )
            causa = {
                "tipo": "TIEMPO",
                "area": None,
                "texto": (
                    f"personal sí hay, pero el vestido no puede ir más rápido: cada paso empieza "
                    f"cuando termina el anterior"
                    + (f" y hay {dias_espera} día(s) de espera de proveedor" if dias_espera else "")
                    + f". Así, lo más pronto que queda listo es el {plan['fecha_fin']:%d/%m/%Y}, "
                    f"y la entrega es el {fecha_entrega:%d/%m/%Y}."
                ),
            }
        if causa:
            causas.append({**causa, "vestido": plan["nombre"]})
        resumen_vestidos.append({
            "nombre": plan["nombre"],
            "taller": plan["taller"],
            "listo": plan["fecha_fin"],
            "a_tiempo": a_tiempo,
            "dias_margen": (fecha_entrega - plan["fecha_fin"]).days,
            "motivo": causa["texto"] if causa else None,
        })

    # Causa principal: la espera del proveedor manda (no depende del personal).
    causa_principal = None
    for tipo in ("ESPERA", "CAPACIDAD", "TIEMPO"):
        c = next((x for x in causas if x["tipo"] == tipo), None)
        if c:
            area_nombre = AREA_NOMBRE.get(c["area"], c["area"] or "")
            causa_principal = {
                "tipo": tipo,
                "titulo": c.get("titulo") or {
                    "ESPERA": "Lo retrasa la espera del proveedor",
                    "CAPACIDAD": f"Falta personal en {area_nombre.lower()}",
                    "TIEMPO": "No alcanzan los días",
                }[tipo],
                "detalle": (
                    f"{c['vestido']}: {c['texto']} No es falta de personal: aunque el taller "
                    "esté libre, no puede estar listo antes."
                    if tipo == "ESPERA" else f"{c['vestido']}: {c['texto']}"
                ),
                "vestido": c["vestido"],
                "texto": c["texto"],
                "area": c["area"],
            }
            break

    # El cuello de botella solo se muestra si de verdad es un área.
    if causa_principal and causa_principal["tipo"] == "ESPERA":
        cuello = None
    elif causa_principal and causa_principal["area"]:
        cuello = next((a for a in areas if a["area"] == causa_principal["area"]), cuello)
    elif cuello and cuello["estado"] == "ok" and cuello["utilizacion_despues"] < float(UTILIZACION_ALTA):
        cuello = None

    if not llega:
        veredicto = "NO_FACTIBLE"
        if causa_principal:
            motivos.append(causa_principal["detalle"])
    else:
        if 0 <= margen_real < MARGEN_DIAS_MINIMO:
            condiciones.append(
                f"Pocos días de sobra: {margen_real} (lo ideal son {MARGEN_DIAS_MINIMO})."
            )
        if margen_real < 0:
            condiciones.append(
                f"El bordado empezaría {abs(margen_real)} día(s) más tarde de lo que indica la regla."
            )
        if temporada["activa"]:
            condiciones.append(temporada["motivo"])
        for a in areas:
            if a["necesarias"] > 0 and a["estado"] in ("risk", "bad"):
                condiciones.append(
                    f"{a['nombre']} quedaría al {round(a['utilizacion_despues'] * 100)} % de su capacidad."
                )
        veredicto = "FACTIBLE_CON_CONDICIONES" if condiciones else "FACTIBLE"

    # ---- Fecha alternativa (la más cercana que sí llega).
    fecha_alternativa = None
    if veredicto == "NO_FACTIBLE":
        candidata = max(fecha_entrega, fecha_fin) + timedelta(days=MARGEN_DIAS_MINIMO)
        for _ in range(60):
            planes_alt, _ = _planificar_todos(resueltos, capacidad, hoy, candidata, factor)
            if _llega(planes_alt, candidata):
                fecha_alternativa = candidata
                break
            fin_alt = max(p["fecha_fin"] for p in planes_alt)
            candidata = max(candidata + timedelta(days=7), fin_alt + timedelta(days=MARGEN_DIAS_MINIMO))
        if fecha_alternativa and fecha_evento and fecha_alternativa > fecha_evento:
            motivos.append(
                "La fecha más cercana posible es después del evento: no conviene aceptar con este taller."
            )

    textos = {
        "FACTIBLE": ("Factible", "El taller llega a tiempo con su personal y carga actuales."),
        "FACTIBLE_CON_CONDICIONES": (
            "Factible con condiciones",
            "Llega a tiempo, pero con condiciones que vigilar.",
        ),
        "NO_FACTIBLE": ("No factible", "No se llega a la fecha de entrega pedida."),
    }
    criterios = _criterios(
        llega=llega, planes=planes, fecha_entrega=fecha_entrega, fecha_fin=fecha_fin,
        margen=margen, margen_real=margen_real, inicios_bordado=inicios_bordado,
        areas=areas, temporada=temporada, causa=causa_principal, sin_asignar=sin_asignar,
        capacidad=capacidad,
    )
    # El veredicto siempre coincide con la explicación: si algo quedó en
    # amarillo, no puede salir "Factible" a secas.
    if veredicto == "FACTIBLE" and any(c["estado"] == "risk" for c in criterios):
        veredicto = "FACTIBLE_CON_CONDICIONES"
        condiciones += [c["titulo"] for c in criterios if c["estado"] == "risk"]

    titulo, mensaje = textos[veredicto]
    if veredicto == "NO_FACTIBLE" and causa_principal:
        mensaje = f"No se llega a la fecha pedida: {causa_principal['titulo'].lower()}."
    elif veredicto == "FACTIBLE_CON_CONDICIONES":
        mensaje = f"Llega a tiempo, pero hay {len(condiciones)} punto(s) en amarillo que vigilar."


    estado = {"FACTIBLE": "ok", "FACTIBLE_CON_CONDICIONES": "risk", "NO_FACTIBLE": "bad"}[veredicto]

    advertencias = []
    for plan in planes:
        advertencias += [f"{plan['nombre']}: {a}" for a in plan["advertencias"]]

    return {
        "veredicto": veredicto,
        "estado": estado,
        "titulo": titulo,
        "mensaje": mensaje,
        "condiciones": condiciones,
        "criterios": criterios,
        "motivos": motivos,
        "advertencias": advertencias,
        "fecha_inicio": min(p["fecha_inicio"] for p in planes),
        "fecha_fin_estimada": fecha_fin,
        "fecha_entrega": fecha_entrega,
        "fecha_evento": fecha_evento,
        "margen_dias": margen,
        "margen_real_dias": margen_real,
        "causa": causa_principal,
        "resumen_vestidos": resumen_vestidos,
        "notas": notas,
        "horas_trabajo": float(sum((p["horas_trabajo"] for p in planes), CERO)),
        "horas_espera": float(sum((p["horas_espera"] for p in planes), CERO)),
        "horas_sin_asignar": float(sin_asignar),
        "cuello_botella": cuello,
        "areas": areas,
        "temporada_alta": temporada,
        "cola": {
            "vestidos_antes": en_cola.count(),
            "horas_comprometidas": float(round(horas_cola, 2)),
        },
        "fecha_alternativa": fecha_alternativa,
        "vestidos": [
            {
                "nombre": p["nombre"],
                "taller": p["taller"],
                "fecha_inicio": p["fecha_inicio"],
                "fecha_fin": p["fecha_fin"],
                "horas_trabajo": float(p["horas_trabajo"]),
                "horas_espera": float(p["horas_espera"]),
                "horas_sin_asignar": float(p["horas_sin_asignar"]),
                "operaciones": [
                    {k: v for k, v in op.items() if k != "asignaciones"} | {
                        "trabajadoras": sorted({a["trabajadora"] for a in op["asignaciones"]}),
                    }
                    for op in p["operaciones"]
                ],
            }
            for p in planes
        ],
    }


def _f(d):
    return f"{d:%d/%m/%Y}"


def _dias_txt(n):
    return f"{n} día" if n == 1 else f"{n} días"


def _criterios(*, llega, planes, fecha_entrega, fecha_fin, margen, margen_real,
               inicios_bordado, areas, temporada, causa, sin_asignar, capacidad):
    """
    Explicación paso a paso del veredicto, en palabras simples.

    Cada punto es ok (verde), risk (amarillo), bad (rojo) o info.
    Regla: algún rojo → No factible; algún amarillo → Con condiciones;
    todo verde → Factible.
    """
    criterios = []

    # 1. ¿Llega a la fecha?
    if llega:
        criterios.append({
            "clave": "fecha", "estado": "ok",
            "titulo": "Llega a la fecha de entrega",
            "detalle": (
                f"Con el trabajo que ya tiene el taller, estaría listo el {_f(fecha_fin)} "
                f"y la entrega es el {_f(fecha_entrega)}."
            ),
        })
    else:
        if sin_asignar > 0:
            detalle = (
                f"Faltan {round(float(sin_asignar), 1)} h de trabajo que nadie puede hacer antes "
                f"del {_f(fecha_entrega)}: el personal ya está ocupado con otros vestidos."
            )
        else:
            detalle = (
                f"Estaría listo recién el {_f(fecha_fin)}, "
                f"{_dias_txt(abs(margen))} después de la entrega ({_f(fecha_entrega)})."
            )
        if causa and causa["tipo"] == "TIEMPO" and not causa.get("area"):
            detalle += " Personal sí hay: lo que falta son días (mira «El camino del vestido»)."
        elif causa:
            if len(planes) == 1 and causa["tipo"] != "ESPERA":
                texto = causa["texto"]
                detalle += f" Motivo: {texto[0].upper()}{texto[1:]}"
            else:
                detalle += f" Motivo: {causa['detalle']}"
        criterios.append({
            "clave": "fecha", "estado": "bad",
            "titulo": "No llega a la fecha de entrega",
            "detalle": detalle,
        })

    # 1b. El camino del vestido (solo si no llega): cada paso con sus fechas.
    if not llega:
        tarde = next((p for p in planes if p["fecha_fin"] > fecha_entrega or p["horas_sin_asignar"] > 0), planes[0])
        lineas = []
        for op in tarde["operaciones"]:
            if op.get("omitido"):
                continue
            ini_d, fin_d = op["inicio"], op["fin"]
            ini_d = ini_d.date() if hasattr(ini_d, "date") else ini_d
            fin_d = fin_d.date() if hasattr(fin_d, "date") else fin_d
            nombre = op["operacion"][:1].upper() + op["operacion"][1:]
            if op["tipo_tiempo"] == PlantillaOperacion.TipoTiempo.ESPERA:
                nombre += " (espera del proveedor)"
            elif es_bordado(op["operacion"]) and tarde.get("inicio_bordado"):
                nombre += f" (regla: últimos {dias_bordado()} días)"
            fechas = f"{ini_d:%d/%m}" if ini_d == fin_d else f"{ini_d:%d/%m} al {fin_d:%d/%m}"
            estado_paso = "pasa la entrega" if fin_d > fecha_entrega else "a tiempo"
            lineas.append(f"{nombre} · {fechas} → {estado_paso}")
        hoy = timezone.localdate()
        criterios.append({
            "clave": "camino", "estado": "bad",
            "titulo": "El camino del vestido" + (f" ({tarde['nombre']})" if len(planes) > 1 else ""),
            "detalle": (
                f"Desde hoy hasta la entrega hay {_dias_txt((fecha_entrega - hoy).days)}. "
                f"Siguiendo los pasos en orden, el vestido quedaría listo el {_f(tarde['fecha_fin'])}."
            ),
            "lineas": lineas,
        })

    # 2. ¿Alcanzan las horas del personal en cada área?
    # "Horas libres" = horas de trabajo del personal desde hoy hasta la
    # entrega, menos lo que ya está ocupado con otros vestidos. El bordado
    # solo se puede hacer en sus últimos días, así que se cuenta esa ventana.
    usadas = [a for a in areas if a["necesarias"] > 0]
    filas = []
    for a in sorted(usadas, key=lambda a: -a["utilizacion_despues"]):
        necesita = round(a["necesarias"])
        libres = round(a["disponibles"])
        ventana = ""
        if inicios_bordado and es_bordado(a["nombre"]):
            ini_b = min(inicios_bordado)
            v = capacidad.resumen_por_area(ini_b, fecha_entrega).get(a["area"], {})
            libres = round(float(max(CERO, v.get("capacidad", CERO) - v.get("comprometidas", CERO))))
            ventana = f" en sus {dias_bordado()} días (desde el {_f(ini_b)})"
        diferencia = libres - necesita
        filas.append({
            "area": a,
            "falta": diferencia < 0,
            "uso": (necesita / libres) if libres > 0 else 1,
            "ventana": bool(ventana),
            "texto": (
                f"{a['nombre']}: necesita {necesita} h y tiene {libres} h libres{ventana} → "
                + (f"le sobran {diferencia} h" if diferencia >= 0 else f"le faltan {abs(diferencia)} h")
            ),
        })
    explicacion = (
        "Horas libres = lo que puede trabajar el personal de cada área desde hoy hasta la entrega, "
        "descontando lo que ya tiene ocupado con otros vestidos."
    )
    faltan = [f for f in filas if f["falta"] or f["area"]["estado"] == "bad"]
    llenas = [
        f for f in filas
        if f not in faltan and (f["area"]["estado"] == "risk" or (f["ventana"] and f["uso"] >= float(UTILIZACION_ALTA)))
    ]
    lineas = [f["texto"] for f in filas]
    if faltan:
        nombres = ", ".join(f["area"]["nombre"].lower() for f in faltan)
        criterios.append({
            "clave": "personal", "estado": "bad" if not llega else "risk",
            "titulo": f"No alcanzan las horas de {nombres}" if not llega else f"Horas muy justas en {nombres}",
            "detalle": explicacion,
            "lineas": lineas,
        })
    elif llenas:
        partes = [
            f"El área de {f['area']['nombre'].lower()} quedaría ocupada al "
            f"{round((f['uso'] if f['ventana'] else f['area']['utilizacion_despues']) * 100)} %"
            + (f" en sus {dias_bordado()} días" if f["ventana"] else "")
            for f in llenas
        ]
        criterios.append({
            "clave": "personal", "estado": "risk",
            "titulo": "Alguna área queda muy llena",
            "detalle": "; ".join(partes) + ". Desde el 85 % es arriesgado: si alguien falta, se atrasa todo lo de esa área.",
            "lineas": lineas,
        })
    elif usadas and not llega:
        criterios.append({
            "clave": "personal", "estado": "info",
            "titulo": "Personal sí hay; lo que faltan son días",
            "detalle": (
                "Las horas libres alcanzan, así que no es falta de personal. El problema es que el vestido "
                "no puede ir más rápido: cada paso espera a que termine el anterior (mira «El camino del vestido»)."
            ),
            "lineas": lineas,
        })
    elif usadas:
        criterios.append({
            "clave": "personal", "estado": "ok",
            "titulo": "Alcanzan las horas del personal",
            "detalle": explicacion,
            "lineas": lineas,
        })

    # 3. ¿Sobran días por si algo sale mal?
    if llega:
        if inicios_bordado:
            ini_b = min(inicios_bordado)
            que = (
                f"Todo lo que va antes del bordado (corte, confección, compras…) estaría listo "
                f"{_dias_txt(margen_real)} antes del {_f(ini_b)}, que es cuando debe empezar el bordado "
                f"(siempre en los últimos {dias_bordado()} días antes de la entrega)."
            ) if margen_real >= 0 else ""
        else:
            que = f"Estaría listo {_dias_txt(margen_real)} antes de la entrega."
        if margen_real >= MARGEN_DIAS_MINIMO:
            criterios.append({
                "clave": "margen", "estado": "ok",
                "titulo": f"Sobran {_dias_txt(margen_real)}",
                "detalle": f"{que} Pedimos mínimo {MARGEN_DIAS_MINIMO} días de sobra por si alguien falta o algo se atrasa.",
            })
        elif margen_real >= 0:
            criterios.append({
                "clave": "margen", "estado": "risk",
                "titulo": f"Solo sobran {_dias_txt(margen_real)}",
                "detalle": (
                    f"{que} Lo recomendado son {MARGEN_DIAS_MINIMO} días: si alguien falta o un "
                    "proveedor se demora, ya no llegaría."
                ),
            })
        else:
            criterios.append({
                "clave": "margen", "estado": "risk",
                "titulo": "El bordado empezaría tarde",
                "detalle": (
                    f"Llega a la entrega, pero el bordado empezaría {_dias_txt(abs(margen_real))} "
                    f"más tarde de lo que pide la regla ({dias_bordado()} días antes de la entrega)."
                ),
            })

    # 4. Esperas de proveedor (no dependen del personal).
    esperas = {}
    for plan in planes:
        for op in plan["operaciones"]:
            if op.get("omitido") or op["tipo_tiempo"] != PlantillaOperacion.TipoTiempo.ESPERA:
                continue
            dias = (op["fin"] - op["inicio"]).days
            if dias > 0:
                esperas[op["operacion"]] = max(esperas.get(op["operacion"], 0), dias)
    if esperas:
        lista = ", ".join(f"{nombre} ({_dias_txt(d)})" for nombre, d in esperas.items())
        es_causa = bool(causa and causa["tipo"] == "ESPERA")
        criterios.append({
            "clave": "espera", "estado": "bad" if es_causa else "info",
            "titulo": "La espera del proveedor no alcanza" if es_causa else "Incluye esperas de proveedor",
            "detalle": (
                f"{lista}. Ese tiempo no depende del taller: aunque haya personal libre, "
                "el vestido no puede avanzar mientras tanto."
            ),
        })

    # 5. Temporada alta.
    if temporada["activa"]:
        criterios.append({
            "clave": "temporada", "estado": "risk",
            "titulo": "Temporada alta",
            "detalle": temporada["motivo"],
        })
    else:
        criterios.append({
            "clave": "temporada", "estado": "ok",
            "titulo": "Carga normal del taller",
            "detalle": (
                f"El taller tiene ocupado el {round(temporada['carga'] * 100)} % de sus horas hasta esa fecha "
                f"(se considera temporada alta desde el {round(temporada['umbral_carga'] * 100)} %)."
            ),
        })

    return criterios
