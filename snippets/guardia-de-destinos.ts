// Guardia de destinos: qué direcciones puede pedir el auditor.
//
// El motor sigue enlaces escritos en webs ajenas y corre dentro del servidor,
// junto a PostgreSQL, Redis y el resto del stack. Sin este filtro bastaría con
// que una web enlazara a una IP interna o a la dirección de metadatos de un
// proveedor cloud para que el worker hiciera esa petición desde dentro (SSRF).
import { lookup } from 'node:dns/promises';

/** Rangos que nunca están al otro lado de una web pública. */
export function esIpPrivada(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // enlace local, incluida la de metadatos
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast y reservadas
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
  const mapeada = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v6);
  if (mapeada) return esIpPrivada(mapeada[1]!);
  return false;
}

export interface Veredicto {
  permitido: boolean;
  motivo: string | null;
}

/**
 * ¿Se puede pedir esta URL? Se resuelve el nombre y se mira dónde apunta DE
 * VERDAD: un dominio público puede resolver a una dirección interna.
 */
export async function destinoPermitido(url: string): Promise<Veredicto> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { permitido: false, motivo: 'URL ilegible' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { permitido: false, motivo: `esquema no permitido (${u.protocol})` };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { permitido: false, motivo: 'nombre interno' };
  }
  try {
    const direcciones = await lookup(host, { all: true });
    if (direcciones.length === 0) return { permitido: false, motivo: 'el nombre no resuelve' };
    // Basta con que UNA de las direcciones sea interna para no arriesgarse.
    const interna = direcciones.find((d) => esIpPrivada(d.address));
    if (interna) return { permitido: false, motivo: 'apunta a una dirección interna' };
  } catch {
    return { permitido: false, motivo: 'el nombre no resuelve' };
  }
  return { permitido: true, motivo: null };
}

const MAX_SALTOS = 5;

/**
 * Petición con las redirecciones seguidas A MANO, validando cada salto.
 * Seguirlas automáticamente dejaría el filtro en nada: una URL pública puede
 * responder 302 hacia una dirección interna, y para cuando se mirase la
 * respuesta final la petición interna ya se habría hecho.
 */
export async function fetchValidado(
  url: string,
  { method = 'GET', headers = {}, timeoutMs = 20_000, body }: {
    method?: 'GET' | 'HEAD' | 'POST';
    headers?: Record<string, string>;
    timeoutMs?: number;
    body?: string;
  } = {},
): Promise<Response> {
  let actual = url;
  for (let salto = 0; salto <= MAX_SALTOS; salto += 1) {
    const v = await destinoPermitido(actual);
    if (!v.permitido) throw new Error(`destino no permitido: ${v.motivo}`);

    const res = await fetch(actual, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status < 300 || res.status >= 400) return res;

    // Una petición con cuerpo (p. ej. firmada) no se reenvía a otra parte.
    if (body !== undefined) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    try {
      actual = new URL(location, actual).toString();
    } catch {
      return res;
    }
  }
  throw new Error(`demasiadas redirecciones (más de ${MAX_SALTOS})`);
}
