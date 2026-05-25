const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const Student = require('../models/Student');
const User = require('../models/User');
const { deleteImages, isConfigured: isCloudinaryConfigured, uploadImageBuffer } = require('../services/cloudinary');
const { DATASET_ROOT, trainEmbeddings } = require('../services/faceModel');

const router = express.Router();
const MAX_ENROLLMENT_IMAGES = 8;

function assertSafeFaceLabel(faceLabel) {
  const clean = String(faceLabel || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(clean)) {
    throw new Error('Face label can contain only letters, numbers, hyphen and underscore.');
  }
  return clean;
}

async function saveEnrollmentImages(faceLabel, images, savedImages) {
  const cleanFaceLabel = assertSafeFaceLabel(faceLabel);
  const labelDir = path.join(DATASET_ROOT, cleanFaceLabel);
  await fs.rm(labelDir, { recursive: true, force: true });
  await fs.mkdir(labelDir, { recursive: true });

  const selectedImages = images.slice(0, MAX_ENROLLMENT_IMAGES);
  await Promise.all(selectedImages.map(async (image, index) => {
    const [, encoded] = String(image).split(',');
    if (!encoded) {
      throw new Error(`Invalid image payload at index ${index}`);
    }

    const fileName = `${String(index).padStart(3, '0')}.jpg`;
    const filePath = path.join(labelDir, fileName);
    const imageBuffer = Buffer.from(encoded, 'base64');

    await fs.writeFile(filePath, imageBuffer);

    const localUrl = `/local-dataset/${encodeURIComponent(cleanFaceLabel)}/${fileName}`;
    let imageRecord = {
      url: localUrl,
      publicId: `local:${cleanFaceLabel}/${fileName}`,
      fileName,
    };

    if (isCloudinaryConfigured()) {
      const publicId = `${String(index).padStart(3, '0')}`;
      const uploadResult = await uploadImageBuffer(imageBuffer, {
        folder: `faceAttendance/dataset/${cleanFaceLabel}`,
        publicId,
      });

      imageRecord = {
        url: uploadResult.secure_url || uploadResult.url || localUrl,
        publicId: uploadResult.public_id || `faceAttendance/dataset/${cleanFaceLabel}/${publicId}`,
        fileName,
      };
    }

    savedImages.push(imageRecord);
  }));

  return savedImages;
}

router.get('/', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can view all employees',
      });
    }

    const students = await Student.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, students });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can create employee records',
      });
    }

    const { name, faceLabel, rollNumber, joiningDate, department, email, enrollmentImages = [] } = req.body;
    const cleanFaceLabel = assertSafeFaceLabel(faceLabel);

    if (!name || !cleanFaceLabel || !joiningDate) {
      return res.status(400).json({
        success: false,
        message: 'name and faceLabel are required',
      });
    }

    if (!Array.isArray(enrollmentImages) || enrollmentImages.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'At least 6 face scan images are required',
      });
    }

    const existingStudent = await Student.findOne({ faceLabel: cleanFaceLabel }).lean();

    if (existingStudent) {
      return res.status(409).json({
        success: false,
        message: 'faceLabel already exists',
      });
    }

    let savedImages = [];

    try {
      savedImages = await saveEnrollmentImages(cleanFaceLabel, enrollmentImages, savedImages);
      await trainEmbeddings();

      const student = await Student.create({
        name,
        faceLabel: cleanFaceLabel,
        rollNumber,
        joiningDate,
        department,
        email,
        enrollmentImages: savedImages,
      });

      return res.status(201).json({ success: true, student });
    } catch (error) {
      await fs.rm(path.join(DATASET_ROOT, cleanFaceLabel), { recursive: true, force: true });
      await deleteImages(savedImages.map((image) => image.publicId).filter((publicId) => !String(publicId).startsWith('local:')));

      return res.status(500).json({
        success: false,
        message:
          'Student could not be saved because images could not be stored locally or the face model could not be trained. Check Python setup.',
        details: error.message,
      });
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'faceLabel already exists',
      });
    }

    next(error);
  }
});

router.put('/me/enrollment', async (req, res, next) => {
  try {
    if (req.user?.role !== 'employee') {
      return res.status(403).json({
        success: false,
        message: 'Only employees can update their own face enrollment',
      });
    }

    const {
      name = req.user.name,
      faceLabel,
      rollNumber = '',
      joiningDate,
      department = req.user.department || '',
      email = req.user.email,
      enrollmentImages = [],
    } = req.body;

    const cleanFaceLabel = assertSafeFaceLabel(faceLabel || req.user.student?.faceLabel || '');

    if (!name || !cleanFaceLabel) {
      return res.status(400).json({
        success: false,
        message: 'name and faceLabel are required',
      });
    }

    if (!Array.isArray(enrollmentImages) || enrollmentImages.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'At least 6 face scan images are required',
      });
    }

    const existingLabelOwner = await Student.findOne({ faceLabel: cleanFaceLabel }).lean();
    const linkedStudentId = req.user.student?._id || req.user.student || null;

    if (existingLabelOwner && (!linkedStudentId || String(existingLabelOwner._id) !== String(linkedStudentId))) {
      return res.status(409).json({
        success: false,
        message: 'faceLabel already exists',
      });
    }

    let savedImages = [];

    try {
      savedImages = await saveEnrollmentImages(cleanFaceLabel, enrollmentImages, savedImages);
      await trainEmbeddings();

      const studentPayload = {
        name,
        faceLabel: cleanFaceLabel,
        rollNumber,
        joiningDate: joiningDate || new Date(),
        department,
        email,
        enrollmentImages: savedImages,
      };

      let student;
      if (linkedStudentId) {
        student = await Student.findByIdAndUpdate(linkedStudentId, studentPayload, {
          returnDocument: 'after',
          runValidators: true,
        });
      } else {
        student = await Student.create(studentPayload);
        await User.findByIdAndUpdate(req.user._id, { student: student._id, department });
      }

      return res.json({
        success: true,
        message: 'Face data registered successfully',
        student,
      });
    } catch (error) {
      await fs.rm(path.join(DATASET_ROOT, cleanFaceLabel), { recursive: true, force: true });
      await deleteImages(savedImages.map((image) => image.publicId).filter((publicId) => !String(publicId).startsWith('local:')));

      return res.status(500).json({
        success: false,
        message:
          'Face data could not be saved because images could not be stored locally or the face model could not be trained. Check Python setup.',
        details: error.message,
      });
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'faceLabel already exists',
      });
    }

    next(error);
  }
});

module.exports = router;
