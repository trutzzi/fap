/** Member photos are stored as small square JPEGs (~30–60 KB). */
export const PHOTO_SIZE = 480;
const QUALITY = 0.85;

/**
 * Center-crops `source` to a square and scales it to `size`×`size`, as JPEG.
 * Accepts an uploaded file (EXIF rotation is applied by `createImageBitmap`) or a camera frame.
 */
export async function squareJpeg(
  source: Blob | HTMLVideoElement,
  size = PHOTO_SIZE,
): Promise<Blob> {
  const image: ImageBitmap | HTMLVideoElement =
    source instanceof Blob ? await createImageBitmap(source) : source;
  const width = image instanceof HTMLVideoElement ? image.videoWidth : image.width;
  const height = image instanceof HTMLVideoElement ? image.videoHeight : image.height;
  if (!width || !height) throw new Error('Imaginea nu poate fi citită.');

  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(size, side);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Imaginea nu poate fi procesată.');
  context.drawImage(
    image,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  if (image instanceof ImageBitmap) image.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Imaginea nu poate fi salvată.'))),
      'image/jpeg',
      QUALITY,
    ),
  );
}
