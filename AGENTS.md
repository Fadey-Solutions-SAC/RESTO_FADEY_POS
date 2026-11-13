# Instrucciones para agentes

Léase al empezar un chat nuevo, antes de modificar nada. El mapa del sistema está en `PROJECT_CONTEXT.md`. Lo que ya cambió está en `CHANGELOG.md`.

## Al abrir una conversación

1. Leer `PROJECT_CONTEXT.md`.
2. Leer este archivo.
3. Leer solo el tramo reciente de `CHANGELOG.md` (las entradas de arriba).
4. Si la tarea toca una ruta, un rol o un módulo, abrir el archivo que `PROJECT_CONTEXT.md` señala. No rehacer el mapa desde el historial de chats.
5. Si falta un dato, buscarlo en el código. No completarlo por suposición.

Las reglas de `.cursor/rules/` siguen activas y mandan sobre este archivo si chocan: idioma español, versión `A.B.C.D`, remoto GitHub y el formato de comandos git.

## Antes de editar

- Confirmar la versión en los dos `package.json`.
- Localizar la ruta de pantalla (`client/src/App.jsx`) o el prefijo de API (`server/index.js`) que se va a tocar.
- No renombrar ni borrar esas rutas, ni los paths de Socket.IO, sin que la persona lo pida en ese chat.
- No cambiar `JWT_SECRET`, remotos git, ni el esquema de SQLite “de paso”.
- No tratar `README.md` como vigente si contradice el código.
- El asistente Android es otro repositorio. Un cambio de horario o de contrato de API aquí puede exigir el mismo cambio allá; decirlo, no editar ese repo si no está en el workspace.

## Al implementar

- Responder en español. Nombres de archivo y código se quedan como están.
- Cambio pequeño y local. No refactorizar al lado.
- Hora de negocio: `America/Lima` (`server/utils/appDateTime.js`), no `Date` local del servidor en la nube.
- “Usuario activo” para los asistentes es persona distinta con actividad reciente, no cada jornada ni la caja abierta. Las rutas de poll del asistente no deben marcar actividad de personal.
- Si se toca UI, comprobar el flujo. Si no hay navegador, decir qué no se pudo verificar.
- Documentación sola (estos tres archivos, reglas o docs sin release) no sube la versión de producto.

## Al cerrar la tarea

1. Si el cambio es de producto y va a commit con push, subir la versión en **ambos** `package.json` antes del commit, como indica `.cursor/rules/version-sistema.mdc`.
2. Añadir una entrada arriba de `CHANGELOG.md`: versión, qué se hizo, qué quedó pendiente si es real.
3. Si cambió una ruta, un módulo, una tabla o una decisión de arquitectura, actualizar solo la sección afectada de `PROJECT_CONTEXT.md`. No copiar el detalle otra vez en este archivo.
4. Commit y push del repo POS, y dejar al final de la respuesta los cinco comandos git de una línea que pide `.cursor/rules/git-comandos-copia.mdc`.

## Qué no hacer

- Inventar endpoints, tablas o roles.
- Pegar secretos, tokens o contraseñas de demo en estos documentos.
- Publicar un instalador o un APK sin pedirlo en el chat.
- Dar de alta rutas nuevas con el mismo path que una ya existente.
