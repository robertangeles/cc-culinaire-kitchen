import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { X, Check } from "lucide-react";

interface ImageCropModalProps {
  imageSrc: string;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

export function ImageCropModal({ imageSrc, onCrop, onCancel }: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedArea(croppedAreaPixels);
  }, []);

  async function handleCrop() {
    if (!croppedArea) return;
    const blob = await getCroppedBlob(imageSrc, croppedArea);
    if (blob) onCrop(blob);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <h3 className="text-sm font-semibold text-stone-800">Crop Photo</h3>
          <button onClick={onCancel} className="p-1 text-stone-400 hover:text-stone-600">
            <X className="size-5" />
          </button>
        </div>
        <div className="relative h-72 bg-stone-900">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-500">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-amber-600"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCrop}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              <Check className="size-4" />
              Crop & Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Maximum output dimension for avatar images (width and height). */
const MAX_AVATAR_SIZE = 512;

// Helper: create a cropped image blob from source
async function getCroppedBlob(imageSrc: string, crop: Area): Promise<Blob | null> {
  const image = new Image();
  image.crossOrigin = "anonymous";

  return new Promise((resolve) => {
    image.onload = () => {
      // Cap output dimensions to avoid oversized files
      const outSize = Math.min(crop.width, crop.height, MAX_AVATAR_SIZE);

      const canvas = document.createElement("canvas");
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }

      ctx.drawImage(
        image,
        crop.x, crop.y, crop.width, crop.height,
        0, 0, outSize, outSize,
      );

      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
    };
    image.onerror = () => resolve(null);
    image.src = imageSrc;
  });
}
