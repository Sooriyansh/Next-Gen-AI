const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const Student = require('../models/Student');
const { getPythonExecutable, PROJECT_ROOT } = require('./pythonRuntime');

const execFileAsync = promisify(execFile);
const DATASET_ROOT = path.join(PROJECT_ROOT, 'python', 'data', 'dataset');
const MODELS_ROOT = path.join(PROJECT_ROOT, 'python', 'data', 'models');
const EMBEDDINGS_PATH = path.join(MODELS_ROOT, 'face_embeddings.npz');
const TRAIN_SCRIPT = path.join(PROJECT_ROOT, 'python', 'train_model.py');

let modelBuildPromise = null;
let trainPromise = null;

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function trainEmbeddings() {
  if (!trainPromise) {
    trainPromise = (async () => {
      await fs.mkdir(MODELS_ROOT, { recursive: true });

      await execFileAsync(getPythonExecutable(), [TRAIN_SCRIPT], {
        cwd: PROJECT_ROOT,
        timeout: 300000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          TF_CPP_MIN_LOG_LEVEL: '2',
        },
      });
    })().finally(() => {
      trainPromise = null;
    });
  }

  await trainPromise;
}

async function downloadImage(url) {
  if (String(url || '').startsWith('/local-dataset/')) {
    const relativePath = decodeURIComponent(String(url).replace('/local-dataset/', ''));
    const localPath = path.resolve(DATASET_ROOT, relativePath);

    if (!localPath.startsWith(DATASET_ROOT)) {
      throw new Error('Invalid local enrollment image path.');
    }

    return fs.readFile(localPath);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not download enrollment image: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function restoreDatasetFromMongo() {
  await fs.rm(DATASET_ROOT, { recursive: true, force: true });
  await fs.mkdir(DATASET_ROOT, { recursive: true });

  const students = await Student.find({
    enrollmentImages: {
      $exists: true,
      $ne: [],
    },
  })
    .select('faceLabel enrollmentImages')
    .lean();

  let restoredCount = 0;

  for (const student of students) {
    const labelDir = path.join(DATASET_ROOT, student.faceLabel);
    await fs.mkdir(labelDir, { recursive: true });

    for (const [index, image] of student.enrollmentImages.entries()) {
      if (!image.url) {
        continue;
      }

      const fileName = image.fileName || `${String(index).padStart(3, '0')}.jpg`;
      const imageBuffer = await downloadImage(image.url);
      await fs.writeFile(path.join(labelDir, fileName), imageBuffer);
      restoredCount += 1;
    }
  }

  if (!restoredCount) {
    throw new Error('No enrollment images found in MongoDB to train the face model.');
  }
}

async function rebuildFaceModelFromCloud() {
  await restoreDatasetFromMongo();
  await trainEmbeddings();
}

async function ensureFaceModelReady() {
  if (await pathExists(EMBEDDINGS_PATH)) {
    return;
  }

  if (!modelBuildPromise) {
    modelBuildPromise = rebuildFaceModelFromCloud().finally(() => {
      modelBuildPromise = null;
    });
  }

  await modelBuildPromise;
}

module.exports = {
  DATASET_ROOT,
  EMBEDDINGS_PATH,
  ensureFaceModelReady,
  rebuildFaceModelFromCloud,
  trainEmbeddings,
};
