/**
 * Próxima consulta de usuarios, hora de Lima.
 * De 5:00 a 7:00 cada 30 minutos. Desde las 7:00 cada 15.
 * Si está apagado antes de las 5:00, la próxima consulta es a las 5:00.
 * Si sigue encendido de madrugada, consulta cada 15 minutos para poder apagarse.
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

/** Milisegundos hasta la próxima consulta, alineada al reloj. */
function nextOperationDelayMs(now, serviceRunning) {
  const n = limaParts(now instanceof Date ? now : new Date());
  const minuteOfDay = n.hour * 60 + n.minute;
  if (minuteOfDay < 5 * 60 && !serviceRunning) {
    const minsUntil5 = 5 * 60 - minuteOfDay;
    return Math.max(1000, (minsUntil5 * 60 - n.second) * 1000);
  }
  let step = minuteOfDay < 7 * 60 ? 30 : 15;
  if (minuteOfDay < 5 * 60) step = 15;
  const mod = minuteOfDay % step;
  const add = mod === 0 ? step : step - mod;
  return Math.max(1000, (add * 60 - n.second) * 1000);
}

module.exports = { limaParts, nextOperationDelayMs };
