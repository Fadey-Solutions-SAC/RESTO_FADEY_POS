/**
 * Próxima consulta de usuarios, hora de Lima.
 * Con usuarios: de 5:00 a 7:00 cada 30 minutos, desde las 7:00 cada 15.
 * Si sigue encendido de madrugada, cada 15 minutos para poder apagarse.
 * Si ya cerraron todos: cada 2 horas hasta las 5:00. Ahí arranca el ciclo de la mañana.
 */

function limaParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return {
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function alignedDelayMs(minuteOfDay, second, stepMinutes) {
  const mod = minuteOfDay % stepMinutes;
  const add = mod === 0 ? stepMinutes : stepMinutes - mod;
  return Math.max(1000, (add * 60 - second) * 1000);
}

/** Milisegundos hasta las 5:00 de Lima (hoy si aún no son, si no mañana). */
function delayUntilFiveMs(minuteOfDay, second) {
  const minsUntil5 = minuteOfDay < 5 * 60
    ? (5 * 60 - minuteOfDay)
    : ((24 * 60 - minuteOfDay) + 5 * 60);
  return Math.max(1000, (minsUntil5 * 60 - second) * 1000);
}

/** Milisegundos hasta la próxima consulta, alineada al reloj. */
function nextOperationDelayMs(now, serviceRunning) {
  const n = limaParts(now instanceof Date ? now : new Date());
  const minuteOfDay = n.hour * 60 + n.minute;
  if (!serviceRunning && (minuteOfDay < 5 * 60 || minuteOfDay >= 7 * 60)) {
    const twoHours = alignedDelayMs(minuteOfDay, n.second, 120);
    const untilFive = delayUntilFiveMs(minuteOfDay, n.second);
    return Math.min(twoHours, untilFive);
  }
  let step = minuteOfDay < 7 * 60 ? 30 : 15;
  if (minuteOfDay < 5 * 60) step = 15;
  return alignedDelayMs(minuteOfDay, n.second, step);
}

module.exports = { limaParts, nextOperationDelayMs };
