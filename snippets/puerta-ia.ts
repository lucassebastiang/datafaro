// Puerta única a la capa de IA: aquí se comprueba el presupuesto, se valida la
// respuesta contra un contrato y se registra el coste. Ninguna tarea llama al
// proveedor por su cuenta. (Versión simplificada: persistencia y avisos abstraídos.)
import type { z } from 'zod';

export interface ConsumoTokens { entrada: number; salida: number; cacheEscritura?: number; cacheLectura?: number }

export interface ProveedorIA {
  pide(args: { modelo: string; sistema: string; entrada: string; esquema: z.ZodTypeAny; maxTokens?: number }):
    Promise<{ datos: unknown | null; texto: string; consumo: ConsumoTokens }>;
}

export interface Dependencias {
  proveedor: ProveedorIA;                                  // sustituible en pruebas: probar no debería costar dinero
  estadoPresupuesto(agencia: string): Promise<{ gastado: number; tope: number; proporcion: number; agotado: boolean }>;
  registraCoste(args: { runId: string; modelo: string; consumo: ConsumoTokens }): Promise<void>;
  avisa(titulo: string, cuerpo: string): Promise<void>;
}

export class PresupuestoAgotado extends Error {}

const UMBRAL_AVISO = 0.8; // avisar al 80 % da margen; al 100 % ya no hay nada que hacer

/**
 * Pide algo al modelo con CONTRATO DE SALIDA (esquema zod).
 * Si la respuesta no encaja se reintenta UNA vez y luego se falla:
 * una respuesta sin validar no se consume nunca.
 */
export async function pideAlModelo<T>(
  deps: Dependencias,
  op: { tarea: string; runId: string; agencia: string; modelo: string; sistema: string; entrada: string; esquema: z.ZodType<T>; maxTokens?: number },
): Promise<T> {
  const antes = await deps.estadoPresupuesto(op.agencia);
  if (antes.agotado) {
    await deps.avisa('Presupuesto de IA agotado este mes', 'Las tareas de IA quedan paradas hasta subir el tope.');
    throw new PresupuestoAgotado(`Presupuesto agotado (${antes.gastado} de ${antes.tope})`);
  }

  let detalle = '';
  for (let intento = 1; intento <= 2; intento++) {
    const entrada = intento === 1
      ? op.entrada
      : `${op.entrada}\n\nLa respuesta anterior no encajaba en el esquema pedido. Devuelve exactamente la estructura solicitada, sin texto alrededor.`;

    const r = await deps.proveedor.pide({ modelo: op.modelo, sistema: op.sistema, entrada, esquema: op.esquema, maxTokens: op.maxTokens });

    // El coste se anota nada más gastarlo, en su propia escritura: si la
    // transacción del resultado se deshiciera, el dinero ya se habría gastado.
    await deps.registraCoste({ runId: op.runId, modelo: op.modelo, consumo: r.consumo });

    if (r.datos !== null) {
      // Validación propia además de la del proveedor: el contrato lo define esta
      // capa, no la biblioteca de turno.
      const ok = op.esquema.safeParse(r.datos);
      if (ok.success) {
        await avisaSiCruzaUmbral(deps, op.agencia, antes.proporcion);
        return ok.data;
      }
      detalle = ok.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } else {
      detalle = r.texto.slice(0, 500);
    }
  }

  await avisaSiCruzaUmbral(deps, op.agencia, antes.proporcion);
  throw new Error(`El modelo no devolvió la forma esperada para «${op.tarea}» (${detalle}). Se reintentó una vez.`);
}

async function avisaSiCruzaUmbral(deps: Dependencias, agencia: string, proporcionAntes: number) {
  const despues = await deps.estadoPresupuesto(agencia);
  if (proporcionAntes < UMBRAL_AVISO && despues.proporcion >= UMBRAL_AVISO && despues.proporcion < 1) {
    await deps.avisa(
      `El gasto en IA va por el ${Math.round(despues.proporcion * 100)} % del mes`,
      'Al llegar al tope, las tareas de IA se paran hasta el mes que viene.',
    );
  }
}

// Reparto del trabajo: el MOTOR DETERMINISTA detecta hechos (¿existe GA4?, ¿hay
// tags sin trigger?, ¿faltan cabeceras?) y la IA solo prioriza, explica y
// redacta sobre esos hechos. Un modelo detectando problemas sería caro, lento,
// no reproducible y a veces se los inventaría.
