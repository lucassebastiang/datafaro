# Seguridad: cómo se deja que una IA toque webs y cuentas publicitarias ajenas

Datafaro no solo lee: aplica cambios en las webs y en las cuentas de publicidad de los clientes de una agencia. Todo el diseño parte de una idea: **la IA propone, una política decide y una persona aprueba lo que importa**. Este documento resume las piezas que lo hacen posible.

## 1. Matriz de autonomía

Qué se aplica solo y qué espera un visto bueno, según el nivel de servicio contratado:

| Tipo de cambio | Total | Medio | Básico |
|---|---|---|---|
| Metadatos SEO, texto alternativo, cabeceras de seguridad | Autónomo | Autónomo | Aprobación |
| Redirecciones | Autónomo | Aprobación | Aprobación |
| Tags de analítica, formularios, ficheros del tema | Aprobación | Aprobación | Aprobación |
| Pausar anuncios, palabras negativas, presupuesto bajo el umbral | Autónomo | Autónomo | Aprobación |
| Presupuesto sobre el umbral | Autónomo | Aprobación | Aprobación |
| Estrategia de puja | Aprobación | Aprobación | Aprobación |
| Crear o activar una campaña, página nueva, enlaces internos | **Siempre una persona** | **Siempre una persona** | **Siempre una persona** |

- Las filas con aprobación en los tres niveles son el **suelo de seguridad**: no se pueden configurar.
- En los niveles medio y básico, si el cambio toca **dinero o conversiones**, además de la agencia aprueba el cliente.
- **Todo lo que va por SSH necesita aprobación**, diga lo que diga la fila.
- **En una propuesta con varios cambios manda el más restrictivo.**
- La política se evalúa **dos veces**: al proponer y justo antes de ejecutar, por si el nivel del cliente ha cambiado entre medias.

→ [snippets/politica-autonomia.ts](../snippets/politica-autonomia.ts)

## 2. Ciclo de ejecución de un cambio

```
PROPUESTA → POLÍTICA → APROBACIÓN → SNAPSHOT → EJECUCIÓN → VERIFICACIÓN → RESULTADO
```

- **El snapshot se lee justo antes de aplicar**, nunca antes: entre un snapshot viejo y el cambio cabe media web.
- **La ejecución es serial** (cola con concurrencia 1) **y no se reintenta**. Un cambio a medio aplicar se revisa a mano.
- **Verificar es responder a tres preguntas**, de la más barata a la más cara:
  1. ¿Quedó escrito lo que se pidió?
  2. ¿La portada sigue respondiendo 200?
  3. ¿La nueva auditoría ve más hallazgos críticos que antes?
  
  Si la respuesta a cualquiera es mala, **se deshace todo**, aunque los cambios se aplicaran sin error.
- El aviso de un cambio revertido es el único que **se salta las preferencias de notificación**.

## 3. El plugin de WordPress

- **Catálogo cerrado de operaciones tipadas:** `set_meta_title`, `set_image_alt`, `set_redirect`, `inject_header_snippet`… Además, `snapshot`, `rollback` y `verify`. **No existe `run_php`, ni `write_file`, ni `exec`.** Si el plugin ejecutase código recibido por la red sería una puerta trasera en la web de todos los clientes.
- **Peticiones firmadas** con HMAC-SHA256 sobre el método, la ruta, la marca de tiempo, un nonce y el cuerpo. Cada nonce se usa una sola vez y la marca de tiempo tiene ventana. No hay sesión ni usuario de WordPress.
- **Clave por sitio**, rotable, que se enseña una sola vez. Tiene **límite de operaciones por minuto**, **se autobloquea tras tres fallos de clave** y el plugin guarda su propio registro de lo que hace.
- **Las validaciones van por partida doble**, en la plataforma y en el plugin:
  - un fragmento inyectado no puede llevar PHP;
  - una cabecera no puede llevar saltos de línea;
  - una redirección solo puede apuntar al propio sitio.
  
  El plugin vive en la web de un cliente y no da por hecho que el otro lado sea de fiar.
- **Lo que enseñó probarlo contra un WordPress real:**
  - WordPress llama al `permission_callback` **dos veces** por petición, así que cada petición gastaba el nonce dos veces. Ahora el veredicto se recuerda durante la petición.
  - Si el sitio usa Yoast o Rank Math, las metas se escriben en sus campos. Si no, el sitio acabaría con dos `description`.

## 4. El ejecutor SSH (sitios que no son WordPress)

- **Solo habla SFTP**, con la librería `ssh2`. No hay `exec` ni shell: no existe forma de montar una línea de comandos.
- **El modelo no genera comandos.** Genera operaciones tipadas, como `{ operation: "replace_in_file", file, search, replace, occurrences }`, que el ejecutor valida y aplica con código propio.
- **Las rutas se deciden sobre la ruta ya resuelta** contra la raíz del sitio. Hay lista blanca de extensiones, lista negra de ficheros (`wp-config.php`, `.env`, `.htaccess`, claves…) y carpetas prohibidas (`.git`, `.ssh`, `wp-admin`…), además de un límite de bytes y de ficheros por ejecución.
- **Todas las rutas se resuelven antes de abrir la conexión.** Si una no vale, no se toca ninguna.
- **El reemplazo cuenta las ocurrencias y exige las declaradas**, o no cambia nada.
- **`.htaccess` no se toca ni con aprobación.** Uno roto tumba el sitio entero y no se puede comprobar antes de escribirlo.

→ [snippets/rutas-ssh.ts](../snippets/rutas-ssh.ts)

## 5. Guardarraíles de publicidad

- **Toda campaña creada por el sistema nace en pausa.** Encenderla es otra decisión, siempre de una persona.
- **Hay un límite de gasto diario por cliente**, que se comprueba sobre el total de la cuenta justo antes de cualquier cambio de presupuesto.
- **La simulación previa es obligatoria:** estado actual, estado propuesto e impacto estimado.
- **Hay una ventana horaria para los cambios**, para que siempre haya alguien disponible si algo va mal, y un **límite de cambios por día y cuenta**.
- **Todo cambio guarda el estado previo.**

## 6. Guardia de destinos (SSRF)

El auditor sigue enlaces de webs ajenas desde dentro del servidor. Antes de cada petición:
1. se resuelve el nombre y se rechaza si **alguna** de sus direcciones es interna (privadas, enlace local y metadatos de la nube, CGNAT, IPv6 locales o IPv4 dentro de IPv6);
2. las redirecciones se siguen **a mano**, validando cada salto.

El mismo guardia se aplica al guardar y al usar una conexión SSH.

→ [snippets/guardia-de-destinos.ts](../snippets/guardia-de-destinos.ts)

## 7. IA con contrato y con tope

- **Una única puerta** para todas las llamadas al modelo.
- **Contrato de salida con zod**, validado también en la propia aplicación. Si falla se reintenta una vez y luego se falla: **una respuesta sin validar no se consume nunca**.
- **Tope de gasto mensual por agencia**, con aviso al 80 % y parada al 100 %. El coste se anota nada más gastarlo.

→ [snippets/puerta-ia.ts](../snippets/puerta-ia.ts)

## 8. Otras capas

- **Aislamiento entre clientes** en el modelo de datos. Los secretos de las conexiones van cifrados.
- **Sesión propia con cookies `httpOnly`**, contraseñas con argon2 y segundo factor TOTP.
- **Consentimiento explícito** de acceso a las cuentas de cada cliente.
