export type RGB = [number, number, number];

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** Average colour of the four image corners (null if the corners are already transparent). */
export async function sampleCornerColor(src: string): Promise<RGB | null> {
  const im = await loadImg(src);
  const k = Math.min(1, 400 / Math.max(im.naturalWidth || 400, im.naturalHeight || 400));
  const w = Math.max(8, Math.round((im.naturalWidth || 400) * k));
  const h = Math.max(8, Math.round((im.naturalHeight || 400) * k));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  g.drawImage(im, 0, 0, w, h);
  let r = 0, gg = 0, b = 0, n = 0;
  const pts: [number, number][] = [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]];
  for (const [x, y] of pts) {
    const d = g.getImageData(x, y, 3, 3).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    }
  }
  return n ? [r / n, gg / n, b / n] : null;
}

/** Colour-key background removal. Returns a PNG data URL. */
export async function removeBackground(
  src: string,
  key: RGB,
  tolerance: number,
  contiguous: boolean,
): Promise<string> {
  const im = await loadImg(src);
  let w = im.naturalWidth || 800;
  let h = im.naturalHeight || 800;
  const k = Math.min(1, 1400 / Math.max(w, h));
  w = Math.round(w * k);
  h = Math.round(h * k);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d")!;
  g.drawImage(im, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const n = w * h;
  const t = tolerance * 4.4;
  const soft = t * 1.35;
  const [kr, kg, kb] = key;

  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const dr = d[p] - kr, dg = d[p + 1] - kg, db = d[p + 2] - kb;
    dist[i] = d[p + 3] < 8 ? 0 : Math.sqrt(dr * dr + dg * dg + db * db);
  }

  const mask = new Uint8Array(n);
  if (contiguous) {
    const st: number[] = [];
    const push = (i: number) => { if (!mask[i] && dist[i] < t) { mask[i] = 1; st.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (st.length) {
      const i = st.pop()!, x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
  } else {
    for (let i = 0; i < n; i++) if (dist[i] < t) mask[i] = 1;
  }

  for (let i = 0; i < n; i++) {
    const p = i * 4 + 3;
    if (mask[i]) d[p] = 0;
    else if (dist[i] < soft) {
      const x = i % w;
      const near = (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (i >= w && mask[i - w]) || (i < n - w && mask[i + w]);
      if (near) d[p] = Math.round((d[p] * (dist[i] - t)) / (soft - t));
    }
  }
  g.putImageData(id, 0, 0);
  return cv.toDataURL("image/png");
}