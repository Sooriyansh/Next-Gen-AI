const { v2: cloudinary } = require('cloudinary');

const CLOUDINARY_CLOUD_NAME = 'dpb0mwete';
const CLOUDINARY_API_KEY = '155177776544667';
const CLOUDINARY_API_SECRET = 'sGKj5YrpnXD6V5rrYlvGkgFz_eM';
const hasNamedCredentials = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

if (hasNamedCredentials) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

function isConfigured() {
  return hasNamedCredentials;
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
  }
}

function uploadImageBuffer(buffer, options) {
  assertConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        public_id: options.publicId,
        resource_type: 'image',
        overwrite: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

async function deleteImages(publicIds) {
  const ids = publicIds.filter(Boolean);

  if (!ids.length || !isConfigured()) {
    return;
  }

  await Promise.all(
    ids.map((publicId) =>
      cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
      })
    )
  );
}

module.exports = {
  deleteImages,
  isConfigured,
  uploadImageBuffer,
};
