// Matriz de autonomía: qué aplica la plataforma sola y qué espera un visto bueno,
// según el nivel de servicio del cliente. (Versión recortada del módulo real.)
//
// Dos reglas que no se tocan:
// - Las filas que exigen aprobación en los tres niveles son el SUELO de seguridad.
//   No son configurables.
// - Hay cambios que siempre activa una persona: crear o encender una campaña,
//   publicar una página nueva, tocar enlaces internos.
// Y una más, por encima de la matriz: lo que va por SSH nunca es autónomo.

type Tier = 'total' | 'medio' | 'basico';
type Celda = 'autonomo' | 'aprobacion';
type Ejecutor = 'wordpress' | 'ssh' | 'ads';
export type Modo = 'autonomo' | 'aprobacion_interna' | 'aprobacion_cliente' | 'siempre_persona';

interface Fila {
  total: Celda;
  medio: Celda;
  basico: Celda;
  /** El cambio mueve dinero o toca la medición de conversiones. */
  tocaDineroOConversiones: boolean;
  etiqueta: string;
  siemprePersona?: true;
}

const MATRIZ = {
  seo_meta:              { total: 'autonomo',   medio: 'autonomo',   basico: 'aprobacion', tocaDineroOConversiones: false, etiqueta: 'metadatos SEO' },
  image_alt:             { total: 'autonomo',   medio: 'autonomo',   basico: 'aprobacion', tocaDineroOConversiones: false, etiqueta: 'texto alternativo' },
  security_headers:      { total: 'autonomo',   medio: 'autonomo',   basico: 'aprobacion', tocaDineroOConversiones: false, etiqueta: 'cabeceras de seguridad' },
  redirects:             { total: 'autonomo',   medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: false, etiqueta: 'redirecciones' },
  analytics_tags:        { total: 'aprobacion', medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: true,  etiqueta: 'tags de analítica' },
  theme_files:           { total: 'aprobacion', medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: false, etiqueta: 'ficheros del tema' },
  ads_pause:             { total: 'autonomo',   medio: 'autonomo',   basico: 'aprobacion', tocaDineroOConversiones: true,  etiqueta: 'pausar anuncios' },
  ads_budget_below:      { total: 'autonomo',   medio: 'autonomo',   basico: 'aprobacion', tocaDineroOConversiones: true,  etiqueta: 'presupuesto bajo el umbral' },
  ads_budget_above:      { total: 'autonomo',   medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: true,  etiqueta: 'presupuesto sobre el umbral' },
  ads_create_campaign:   { total: 'aprobacion', medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: true,  etiqueta: 'crear campaña', siemprePersona: true },
  content_page:          { total: 'aprobacion', medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: false, etiqueta: 'página nueva', siemprePersona: true },
  ads_activate_campaign: { total: 'aprobacion', medio: 'aprobacion', basico: 'aprobacion', tocaDineroOConversiones: true,  etiqueta: 'activar campaña', siemprePersona: true },
} satisfies Record<string, Fila>;

export type TipoDeCambio = keyof typeof MATRIZ;

export const esSueloDeSeguridad = (tipo: TipoDeCambio) => {
  const f: Fila = MATRIZ[tipo];
  return f.total === 'aprobacion' && f.medio === 'aprobacion' && f.basico === 'aprobacion';
};

export interface Decision {
  modo: Modo;
  razon: string;
}

export function decideAutonomia(tipo: TipoDeCambio, tier: Tier, ejecutor?: Ejecutor, siempreAprobar: string[] = []): Decision {
  const fila: Fila = MATRIZ[tipo];

  // Un fichero mal escrito por SSH deja la web caída sin que ninguna comprobación
  // previa lo avise: siempre pasa por una persona, diga lo que diga la fila.
  if (ejecutor === 'ssh') return { modo: 'aprobacion_interna', razon: 'Los cambios por SSH nunca se aplican solos.' };

  if (fila.siemprePersona) return { modo: 'siempre_persona', razon: `${fila.etiqueta}: lo hace siempre una persona.` };

  const celda: Celda = siempreAprobar.includes(tipo) ? 'aprobacion' : fila[tier];
  if (celda === 'autonomo') return { modo: 'autonomo', razon: `En nivel ${tier}, ${fila.etiqueta} se aplica sin esperar.` };

  // En los niveles medio y básico, si hay dinero o conversiones en juego,
  // además de la agencia aprueba el cliente.
  const conCliente = tier !== 'total' && fila.tocaDineroOConversiones;
  return {
    modo: conCliente ? 'aprobacion_cliente' : 'aprobacion_interna',
    razon: `${fila.etiqueta} exige aprobación${esSueloDeSeguridad(tipo) ? ' en todos los niveles' : ` en nivel ${tier}`}.`,
  };
}

const ORDEN: Record<Modo, number> = { autonomo: 0, aprobacion_interna: 1, aprobacion_cliente: 2, siempre_persona: 3 };

/**
 * Una propuesta entera: manda el cambio más restrictivo. Una propuesta no se
 * aplica sola porque la mayoría de sus cambios sean inocuos.
 */
export function politicaDePropuesta(
  cambios: Array<{ tipo: TipoDeCambio; ejecutor?: Ejecutor }>,
  tier: Tier,
): Decision {
  if (cambios.length === 0) throw new Error('Una propuesta sin cambios no tiene política que aplicar');
  return cambios
    .map((c) => decideAutonomia(c.tipo, tier, c.ejecutor))
    .reduce((peor, d) => (ORDEN[d.modo] > ORDEN[peor.modo] ? d : peor));
}

// La política se evalúa DOS veces: al crear la propuesta (congela el nivel de
// servicio) y otra justo antes de ejecutar, porque entre proponer y aplicar el
// nivel del cliente puede haber cambiado. Manda lo que diga en el momento de tocar.
