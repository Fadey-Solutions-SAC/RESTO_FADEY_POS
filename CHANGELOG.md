# Changelog

Entradas nuevas arriba. El procedimiento para escribirlas está en `AGENTS.md`. El detalle técnico vive en `PROJECT_CONTEXT.md`. Historial anterior a esta lista: `git log`.

## 1.2.0.1 — 2026-11-13

- Consulta de usuarios con el sistema ya cerrado: cada 2 horas hasta las 5:00 (Lima), en `electron/operationWatchSchedule.js`. De 5:00 a 7:00 sigue cada 30 minutos.
- El mismo criterio quedó en el repo del APK (`OperationWatchScheduler`, versión de código 1.0.11). Ese APK no se publicó en esta tarea.

## 1.2.0.0 — 2026-11-13

- `activeUsers` cuenta personas (`COUNT(DISTINCT user_id)`), no cada fila de `user_work_sessions`.
- El poll del asistente ya no abre ni refresca jornadas.
- Jornadas de más duplicadas por el mismo usuario se cierran al consultar el estado.

## 1.1.9.9 — 2026-11-13

- El asistente de PC sigue el horario de Lima: enciende con usuarios y se apaga al confirmar que no queda nadie. La actualización se instala en ese apagado.
- Instalador publicado aparte: tag `v1.1.99`. No incluye 1.2.0.0 ni 1.2.0.1.

## 1.1.9.8 — 2026-11-13

- El asistente de PC dejó de cerrarse al abrir para instalar una actualización ya descargada.

## 1.1.9.7 — 2026-11-13

- El asistente móvil solo permanece activo si hay un usuario activo en el sistema.

## 1.1.9.6 — 2026-11-13

- Copiar URL y token del vínculo Android por separado.
- Enviar boleta o factura por WhatsApp cuando el cliente tiene teléfono.

## 1.1.9.5 — 2026-11-13

- Hora de emisión en zona del restaurante.
- Dirección del cliente vacía si no se escribió. El emisor no repite la línea de distrito.

## 1.1.9.4 — 2026-11-13

- PDF formal de boleta y factura para el flujo del asistente Android.
- Color distinto y persistido al crear un área de producción.

## Pendiente conocido

- El instalador de PC que está en GitHub (`v1.1.99`) no trae el conteo de personas ni la consulta cada 2 horas. Esos cambios están en `main` desde 1.2.0.0 y 1.2.0.1.
- `README.md` de la raíz no coincide con el motor de base ni con el mapa actual. No usarlo como especificación.
