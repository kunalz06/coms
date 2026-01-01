export const compressImage = (file, maxSizeInBytes = 500 * 1024) => {
    return new Promise((resolve, reject) => {
        // If already smaller, return as is
        if (file.size <= maxSizeInBytes && !file.type.startsWith('image/png')) {
            // Optional: Convert PNG to JPEG if we really want to force compression, 
            // but usually size check is enough. 
            // However, large PNGs might need conversion.
            // Let's always run compression workflow for large images.
            resolve(file);
            return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Resize if huge
                const MAX_DIMENSION = 1920;
                if (width > height) {
                    if (width > MAX_DIMENSION) {
                        height *= MAX_DIMENSION / width;
                        width = MAX_DIMENSION;
                    }
                } else {
                    if (height > MAX_DIMENSION) {
                        width *= MAX_DIMENSION / height;
                        height = MAX_DIMENSION;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Recursive compression to target size
                const attemptCompression = (quality) => {
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            reject(new Error("Compression failed"));
                            return;
                        }

                        if (blob.size <= maxSizeInBytes || quality <= 0.1) {
                            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
                                type: 'image/jpeg',
                                lastModified: Date.now(),
                            });
                            resolve(newFile);
                        } else {
                            // Try lower quality
                            attemptCompression(quality - 0.1);
                        }
                    }, 'image/jpeg', quality);
                };

                attemptCompression(0.9); // Start at 90%
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
};
