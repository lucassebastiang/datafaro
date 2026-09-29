// Nota de una auditoría: qué proporción del problema POTENCIAL evita el sitio.
//
//   nota = 100 × (1 − penalizaciones ÷ peso total evaluado)
//
// No se resta sobre 100 fijo. Haciéndolo así, ampliar el catálogo de
// comprobaciones hundía la nota aunque el sitio fuera exactamente el mismo: al
// pasar de 22 a 45 comprobaciones, un sitio de prueba sacó 23 con todas sus
// categorías por encima de 75, dos números que no pueden ser ciertos a la vez.
// Repartiendo sobre lo que de verdad se evaluó, la nota significa lo mismo
// cambie o no el catálogo, y las auditorías se pueden comparar en el tiempo.

type Severidad = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const PESO: Record<Severidad, number> = { critical: 15, high: 8, medium: 4, low: 2, info: 0 };

export interface Resultado {
  categoria: string;
  severidad: Severidad;
  alcance: 'site' | 'page';
  resultado: 'pass' | 'fail' | 'not_applicable';
  paginasAfectadas: number;
  paginasRevisadas: number;
}

/**
 * Fallar en 1 de 30 páginas no es lo mismo que en 30 de 30: en las
 * comprobaciones de página el peso se escala con la proporción afectada,
 * pero nunca baja de la mitad. Si falla, falla.
 */
export function penalizacion(r: Resultado): number {
  const base = PESO[r.severidad];
  if (r.alcance !== 'page' || r.paginasRevisadas === 0) return base;
  return base * (0.5 + 0.5 * (r.paginasAfectadas / r.paginasRevisadas));
}

function nota(resultados: Resultado[]): number | null {
  // Lo que no se pudo evaluar queda fuera del reparto.
  const evaluados = resultados.filter((r) => r.resultado !== 'not_applicable' && PESO[r.severidad] > 0);
  const total = evaluados.reduce((s, r) => s + PESO[r.severidad], 0);
  if (total === 0) return null;
  const perdido = evaluados.filter((r) => r.resultado === 'fail').reduce((s, r) => s + penalizacion(r), 0);
  return Math.round(1000 * (1 - perdido / total)) / 10;
}

/**
 * Nota global y por categoría. Una categoría sin nada evaluado NO aparece, en
 * lugar de salir con un 100 que nadie se ha ganado.
 */
export function puntua(resultados: Resultado[]) {
  const porCategoria: Record<string, number> = {};
  for (const cat of new Set(resultados.map((r) => r.categoria))) {
    const n = nota(resultados.filter((r) => r.categoria === cat));
    if (n !== null) porCategoria[cat] = n;
  }
  return {
    global: nota(resultados),
    porCategoria,
    evaluadas: resultados.filter((r) => r.resultado !== 'not_applicable').length,
    superadas: resultados.filter((r) => r.resultado === 'pass').length,
  };
}

// Ciclo de vida de un hallazgo entre auditorías (comprobaciones deterministas,
// comparables entre auditorías):
//  - falla sin hallazgo abierto  → se abre (open)
//  - falla con hallazgo abierto  → no se duplica
//  - pasa con hallazgo abierto   → se cierra (fixed, con resolved_at)
