(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MechanicInspectionCatalog = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const SYSTEM_STATUS = [
    { value: "bueno", label: "Bueno", tone: "ok", score: 100 },
    { value: "regular", label: "Regular", tone: "warn", score: 60 },
    { value: "malo", label: "Malo", tone: "bad", score: 20 },
    { value: "no", label: "No", tone: "bad", score: 25 },
    { value: "no_aplica", label: "No aplica", tone: "ok", score: null },
  ];

  const FLUID_STATUS = [
    { value: "normal", label: "Normal", tone: "ok", score: 100 },
    { value: "bajo", label: "Bajo", tone: "warn", score: 50 },
    { value: "vacio", label: "Vacío / no", tone: "bad", score: 15 },
    { value: "no_aplica", label: "No aplica", tone: "ok", score: null },
  ];

  const BODY_STATUS = [
    { value: "bueno", label: "Bueno", tone: "ok", score: 100 },
    { value: "rayon", label: "Rayón", tone: "warn", score: 55 },
    { value: "rayado", label: "Rayado", tone: "warn", score: 50 },
    { value: "picado", label: "Picado", tone: "warn", score: 50 },
    { value: "sumido", label: "Sumido", tone: "warn", score: 35 },
    { value: "def_leve", label: "Def. leve", tone: "warn", score: 55 },
    { value: "def_media", label: "Def. media", tone: "warn", score: 40 },
    { value: "def_grave", label: "Def. grave", tone: "bad", score: 15 },
    { value: "buena_reparacion", label: "Buena reparación", tone: "ok", score: 70 },
    { value: "mala_reparacion", label: "Mala reparación", tone: "bad", score: 30 },
    { value: "repintado", label: "Repintado", tone: "warn", score: 65 },
    { value: "no_aplica", label: "No aplica", tone: "ok", score: null },
  ];

  const PAINT_DEFECT = [
    { value: "no", label: "No" },
    { value: "1_4", label: "De 1 a 4 piezas" },
    { value: "5_plus", label: "5 o más piezas" },
  ];

  const INSPECTION_GROUPS = [
    {
      id: "functions",
      title: "Funciones eléctricas y confort",
      kind: "system",
      items: [
        ["ac", "Aire acondicionado"],
        ["central_lock", "Bloqueo central"],
        ["heater", "Calefacción"],
        ["power_windows", "Elevavidrios eléctricos"],
        ["power_mirrors", "Espejos eléctricos"],
        ["temp_gauge", "Indicador de temperatura"],
        ["wiper_front", "Limpiabrisas delantero"],
        ["wiper_rear", "Limpiabrisas trasero"],
        ["horn", "Pito"],
        ["radio", "Radio"],
        ["clock", "Reloj"],
        ["tachometer", "Tacómetro"],
      ],
    },
    {
      id: "lights",
      title: "Luces",
      kind: "system",
      items: [
        ["high_beam", "Altas"],
        ["fog", "Antiniebla"],
        ["low_beam", "Bajas"],
        ["position", "Cocuyos"],
        ["turn_signals", "Direccionales"],
        ["parking_lights", "Estacionamiento"],
        ["aux_lights", "Exploradoras"],
        ["brake_lights", "Freno"],
        ["dome_light", "Luz de techo"],
        ["plate_light", "Placa"],
        ["reverse_light", "Reverso"],
      ],
    },
    {
      id: "fluids",
      title: "Fluidos",
      kind: "fluid",
      items: [
        ["engine_oil", "Aceite de motor"],
        ["power_steering", "Dirección hidráulica"],
        ["clutch_fluid", "Embrague hidráulico"],
        ["washer_fluid", "Lavaparabrisas"],
        ["brake_fluid", "Líquido de frenos"],
        ["coolant", "Refrigerante"],
      ],
    },
    {
      id: "mechanical",
      title: "Mecánica, tren y escape",
      kind: "system",
      items: [
        ["ac_compressor_oil", "Aceite compresor A/A"],
        ["shocks", "Amortiguadores"],
        ["clutch_pump", "Bomba de embrague"],
        ["trans_diff", "Transmisión / diferencial"],
        ["stabilizer_bushings", "Bujes estabilizadora"],
        ["control_arm_bushings", "Bujes de tijeras"],
        ["catalytic", "Catalizador"],
        ["u_joints", "Crucetas"],
        ["engine_cradle", "Cuna de motor"],
        ["axial_boots", "Guardapolvos brazo axial"],
        ["axle_boots", "Guardapolvos de ejes"],
        ["underbody_protectors", "Protectores inferiores"],
        ["muffler", "Silenciador"],
        ["control_arms", "Tijeras"],
        ["exhaust_pipe", "Tubo de escape"],
      ],
    },
    {
      id: "interior",
      title: "Interior",
      kind: "system",
      items: [
        ["floor_mats", "Alfombra de piso"],
        ["storage_tray", "Bandeja portaobjetos"],
        ["door_cards", "Carteras de puertas"],
        ["seatbelts", "Cinturón de seguridad"],
        ["center_console", "Consola central"],
        ["front_seats", "Función asientos delanteros"],
        ["glovebox", "Guantera"],
        ["headliner_trim", "Millare"],
        ["sun_visors", "Parasoles"],
        ["seat_upholstery", "Tapicería de asientos"],
        ["roof_upholstery", "Tapicería de techo"],
      ],
    },
    {
      id: "engine_bay",
      title: "Bahía de motor y otros",
      kind: "system",
      items: [
        ["hood_trunk_struts", "Amortiguadores capot / baúl"],
        ["gas_conversion", "Conversión gas-gasolina"],
        ["accessory_belt", "Correa de accesorios"],
        ["radiator", "Radiador"],
      ],
    },
    {
      id: "body",
      title: "Carrocería y exterior",
      kind: "body",
      items: [
        ["bumper_front", "Bomper delantero"],
        ["bumper_rear", "Bomper trasero"],
        ["hood", "Capot"],
        ["roof", "Capota"],
        ["side_right", "Costado derecho"],
        ["side_left", "Costado izquierdo"],
        ["headlight_right", "Farola derecha"],
        ["headlight_left", "Farola izquierda"],
        ["front_upper", "Frontal superior"],
        ["fender_front_right", "Guardafango delantero derecho"],
        ["fender_front_left", "Guardafango delantero izquierdo"],
        ["fender_rear_right", "Guardafango trasero derecho"],
        ["fender_rear_left", "Guardafango trasero izquierdo"],
        ["windshield", "Panorámico delantero"],
        ["rear_glass", "Panorámico trasero"],
        ["door_front_right", "Puerta delantera derecha"],
        ["door_front_left", "Puerta delantera izquierda"],
        ["door_rear_right", "Puerta trasera derecha"],
        ["door_rear_left", "Puerta trasera izquierda"],
        ["mirror_right", "Retrovisor derecho"],
        ["mirror_left", "Retrovisor izquierdo"],
        ["tail_right", "Stop derecho"],
        ["tail_left", "Stop izquierdo"],
        ["tailgate", "Tapa baúl / compuerta"],
        ["pillar_center_right", "Paral central derecho"],
        ["pillar_center_left", "Paral central izquierdo"],
        ["sill_right", "Estribo derecho"],
        ["sill_left", "Estribo izquierdo"],
        ["windshield_pillar_right", "Paral parabrisas derecho"],
        ["windshield_pillar_left", "Paral parabrisas izquierdo"],
        ["door_pillar_right", "Parales puerta derecha"],
        ["door_pillar_left", "Parales puerta izquierda"],
        ["roof_rail_right", "Larguero capota derecho"],
        ["roof_rail_left", "Larguero capota izquierdo"],
        ["metal_dust_front_right", "G/polvo metal delantero derecho"],
        ["metal_dust_front_left", "G/polvo metal delantero izquierdo"],
      ],
    },
  ];

  const ITEM_INDEX = {};
  INSPECTION_GROUPS.forEach((group) => {
    group.items.forEach(([id, label]) => {
      ITEM_INDEX[id] = { id, label, groupId: group.id, kind: group.kind };
    });
  });

  function statusListForKind(kind) {
    if (kind === "fluid") return FLUID_STATUS;
    if (kind === "body") return BODY_STATUS;
    return SYSTEM_STATUS;
  }

  function statusMeta(kind, value) {
    return statusListForKind(kind).find((item) => item.value === value) || null;
  }

  function defaultFillValue(kind) {
    return kind === "fluid" ? "normal" : "bueno";
  }

  return {
    SYSTEM_STATUS,
    FLUID_STATUS,
    BODY_STATUS,
    PAINT_DEFECT,
    INSPECTION_GROUPS,
    ITEM_INDEX,
    statusListForKind,
    statusMeta,
    defaultFillValue,
  };
});
