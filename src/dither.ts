// Floyd-Steinberg dithering for e-ink display simulation

export function ditherImageData(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  // Work on a float32 grayscale buffer to accumulate errors
  const gray = new Float32Array(width * height);

  // Convert to grayscale
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // Luminance
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Floyd-Steinberg
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldVal = Math.max(0, Math.min(255, gray[idx]));
      const newVal = oldVal < 128 ? 0 : 255;
      const err = oldVal - newVal;
      gray[idx] = newVal;

      if (x + 1 < width)            gray[idx + 1]         += err * 7 / 16;
      if (y + 1 < height) {
        if (x - 1 >= 0)             gray[idx + width - 1] += err * 3 / 16;
                                    gray[idx + width]      += err * 5 / 16;
        if (x + 1 < width)          gray[idx + width + 1] += err * 1 / 16;
      }
    }
  }

  // Write back as RGBA
  const out = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = gray[i] < 128 ? 0 : 255;
    out.data[i * 4]     = v;
    out.data[i * 4 + 1] = v;
    out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }

  return out;
}
