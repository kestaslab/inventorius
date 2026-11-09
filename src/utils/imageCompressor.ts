/**
 * Client-side photo compression utility for inventory mobile capture.
 * Downscales photos to max 800x800 resolution at 0.72 quality, reducing 5-10MB phone photos to ~40-80KB.
 */
export async function compressPhoto(file: File, maxDimension: number = 800, quality: number = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nepavyko nuskaityti nuotraukos failo'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Netinkamas nuotraukos formatas'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect ratio
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Nepavyko sukurti drobės suspaudimui'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Export as JPEG with controlled quality
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
