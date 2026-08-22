/**
 * Abre una ventana con la hoja de encuesta llena y dispara impresión / guardar PDF.
 */
export function printLoyaltySurveySheet(sheetElement, filename = 'encuesta-respuesta') {
  if (!sheetElement || typeof window === 'undefined') return false;
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
  if (!win) return false;

  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join('\n');

  const safeName = String(filename || 'encuesta').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/gi, '_').slice(0, 80);

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${safeName}</title>
  ${styles}
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #f3ead7 !important;
    }
    body {
      padding: 1rem;
    }
    .rf-survey-print-root {
      max-width: 52rem;
      margin: 0 auto;
    }
    @media print {
      html, body { background: #fff !important; padding: 0; }
      .rf-survey-sheet__card { box-shadow: none !important; }
    }
  </style>
</head>
<body>
  <div class="rf-survey-print-root">${sheetElement.outerHTML}</div>
  <script>
    window.onload = function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 250);
    };
  </script>
</body>
</html>`);
  win.document.close();
  return true;
}
