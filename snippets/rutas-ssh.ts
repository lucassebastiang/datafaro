// Qué fichero se puede tocar por SSH y cuál no.
//
// Al otro lado hay un servidor ajeno y un fichero mal escrito deja una web caída.
// Por eso esto es código puro, sin red: se puede leer entero, probar entero y
// razonar sobre él. El conector solo habla SFTP (librería ssh2): no existe
// `exec`, ni shell, ni forma de montar una línea de comandos.
//
// Regla del fichero: TODO se decide sobre la ruta ya resuelta contra la raíz del
// sitio. Comprobar la cadena que llega sería comprobar una intención, no un destino.
import { normalize, posix } from 'node:path';

/** Lo que se puede editar. Lo que no esté aquí, no se toca. */
export const EXTENSIONES = ['.html', '.htm', '.js', '.css', '.php', '.txt', '.xml'] as const;

/** Lo que no se toca ni con aprobación: son las llaves de la casa. */
export const PROHIBIDOS = [
  'wp-config.php', '.env', '.htaccess', '.htpasswd', 'php.ini', '.user.ini', 'web.config',
  'id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json',
] as const;

/** Carpetas cuyo contenido no se toca, estén donde estén. */
export const CARPETAS_PROHIBIDAS = ['.git', '.svn', 'node_modules', 'vendor', '.ssh', 'wp-admin', 'wp-includes'] as const;

export const MAX_BYTES = 512 * 1024; // por fichero
export const MAX_FICHEROS = 20;      // por ejecución

export class RutaNoPermitida extends Error {
  constructor(readonly ruta: string, readonly motivo: string) {
    super(`No se puede tocar «${ruta}»: ${motivo}`);
  }
}

/**
 * Resuelve una ruta contra la raíz del sitio y decide si se puede tocar.
 * Rechaza, por este orden: rutas absolutas, saltos fuera de la raíz, ficheros
 * de la lista negra, carpetas prohibidas y extensiones fuera de la lista blanca.
 */
export function resuelve(raiz: string, ruta: string) {
  const limpia = ruta.trim();
  if (limpia === '') throw new RutaNoPermitida(ruta, 'no dice qué fichero es');
  if (limpia.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(limpia)) {
    throw new RutaNoPermitida(ruta, 'las rutas van dentro del sitio, no desde la raíz del servidor');
  }
  if (limpia.includes('\0')) throw new RutaNoPermitida(ruta, 'lleva caracteres que no son de una ruta');

  // Separadores POSIX: al otro lado hay un servidor Linux.
  const relativa = posix.normalize(limpia.replace(/\\/g, '/'));
  if (relativa === '..' || relativa.startsWith('../') || relativa.includes('/../')) {
    throw new RutaNoPermitida(ruta, 'sale del directorio del sitio');
  }

  const trozos = relativa.split('/').filter((t) => t !== '' && t !== '.');
  const nombre = trozos.at(-1);
  if (!nombre) throw new RutaNoPermitida(ruta, 'no dice qué fichero es');
  if ((PROHIBIDOS as readonly string[]).includes(nombre)) {
    throw new RutaNoPermitida(ruta, 'es un fichero de configuración o de credenciales');
  }
  const carpeta = trozos.slice(0, -1).find((t) => (CARPETAS_PROHIBIDAS as readonly string[]).includes(t));
  if (carpeta) throw new RutaNoPermitida(ruta, `está dentro de «${carpeta}», que no se toca`);

  const punto = nombre.lastIndexOf('.');
  const extension = punto > 0 ? nombre.slice(punto).toLowerCase() : '';
  if (!(EXTENSIONES as readonly string[]).includes(extension)) {
    throw new RutaNoPermitida(ruta, extension ? `los ficheros «${extension}» no se editan` : 'no tiene extensión');
  }

  const raizLimpia = normalize(raiz).replace(/\/+$/, '');
  return { relativa: trozos.join('/'), absoluta: `${raizLimpia}/${trozos.join('/')}`, extension };
}

/** Cuántas veces aparece `busca` en `texto`. */
export function cuenta(texto: string, busca: string): number {
  if (busca === '') return 0;
  let n = 0;
  for (let i = texto.indexOf(busca); i !== -1; i = texto.indexOf(busca, i + busca.length)) n += 1;
  return n;
}

/**
 * Reemplaza EXACTAMENTE las ocurrencias declaradas, o no reemplaza nada.
 * Una operación que dice cambiar una cosa y cambia siete es un desastre silencioso.
 *
 * El modelo nunca escribe un `sed`: propone una operación tipada
 *   { operation: 'replace_in_file', file, search, replace, occurrences }
 * y el ejecutor la valida con `resuelve`, hace snapshot del fichero, aplica esto
 * con código propio y verifica.
 */
export function reemplaza(texto: string, busca: string, pon: string, ocurrencias: number): string {
  const hay = cuenta(texto, busca);
  if (hay !== ocurrencias) {
    throw new Error(`El texto aparece ${hay} ${hay === 1 ? 'vez' : 'veces'} y la operación declara ${ocurrencias}. No se toca nada.`);
  }
  return texto.split(busca).join(pon);
}
