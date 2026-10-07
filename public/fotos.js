// Tratamiento de fotos en el celular: reducción de tamaño y marca de agua.
// Marca de agua: escribe los datos de la gestión sobre la foto (abajo a la derecha), para que
// la imagen conserve fecha, lugar, contenedor y usuario aunque circule fuera del sistema.
export function estampar(dataUrl, lineas) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const margen = Math.round(cv.width * 0.025);
      let tam = Math.round(Math.max(cv.width, cv.height) / 36);
      const fuente = () => { g.font = `500 ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; };
      fuente();
      // Si alguna línea no entra en el ancho, se achica la letra
      const ancho = Math.max(...lineas.map((l) => g.measureText(l).width));
      if (ancho > cv.width - 2 * margen) { tam = Math.floor(tam * (cv.width - 2 * margen) / ancho); fuente(); }
      const alto = Math.round(tam * 1.25);
      g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
      const base = cv.height - margen - (lineas.length - 1) * alto;
      const sombra = g.createLinearGradient(0, base - alto * 2, 0, cv.height);
      sombra.addColorStop(0, 'rgba(0,0,0,0)'); sombra.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = sombra; g.fillRect(0, base - alto * 2, cv.width, cv.height - base + alto * 2);
      lineas.forEach((l, i) => {
        const y = base + i * alto;
        g.lineWidth = Math.max(2, tam / 7); g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(l, cv.width - margen, y);
        g.fillStyle = '#fff'; g.fillText(l, cv.width - margen, y);
      });
      ok(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = mal;
    img.src = dataUrl;
  });
}

export function reducirFoto(archivo, max = 1600) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      ok(cv.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = mal;
    img.src = URL.createObjectURL(archivo);
  });
}
