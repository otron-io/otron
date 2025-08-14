import { env } from '../env.js';

export type ImageSize = '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
export type AspectRatio = '1:1' | '16:9' | '9:16';
export type ImageFormat = 'png' | 'webp' | 'jpeg';
export type ImageBackground = 'transparent' | 'white';

export const aspectToSize = (aspect?: AspectRatio): ImageSize => {
  switch (aspect) {
    case '16:9':
      return '1792x1024';
    case '9:16':
      return '1024x1792';
    case '1:1':
    default:
      return '1024x1024';
  }
};

export const normalizeParams = (params: {
  prompt: string;
  size?: ImageSize;
  aspect_ratio?: AspectRatio;
  background?: ImageBackground;
  format?: ImageFormat;
}) => {
  if (!params.prompt || !params.prompt.trim()) {
    throw new Error('prompt is required');
  }

  const size: ImageSize = params.size || aspectToSize(params.aspect_ratio) || '1024x1024';
  const background: ImageBackground = params.background || 'white';
  const format: ImageFormat = params.format || 'png';

  return { size, background, format };
};

export const mimeTypeForFormat = (format: ImageFormat): string => {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
};

export async function generateImageBytes({
  prompt,
  size,
  background,
  format,
}: {
  prompt: string;
  size: ImageSize;
  background: ImageBackground;
  format: ImageFormat;
}): Promise<Buffer> {
  const apiKey = env.OPENAI_API_KEY;
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size,
      n: 1,
      background,
      response_format: 'b64_json',
      // Newer APIs accept `format`; include if provided
      ...(format ? { format } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI image generation failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    data: Array<{ b64_json: string }>;
  };

  if (!data?.data?.length || !data.data[0]?.b64_json) {
    throw new Error('Invalid image response from OpenAI');
  }

  const bytes = Buffer.from(data.data[0].b64_json, 'base64');
  return bytes;
}

