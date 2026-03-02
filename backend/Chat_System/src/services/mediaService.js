const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, DetectModerationLabelsCommand } = require('@aws-sdk/client-rekognition');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION });

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_VOICE_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav'];

// Content moderation settings
const MODERATION_CONFIDENCE_THRESHOLD = parseInt(process.env.MODERATION_CONFIDENCE_THRESHOLD) || 60;
const EXPLICIT_LABELS = ['Explicit Nudity', 'Suggestive', 'Violence', 'Visually Disturbing', 'Rude Gestures', 'Drugs'];
const REKOGNITION_ENABLED = process.env.REKOGNITION_ENABLED !== 'false';

/**
 * Validate if a mimetype is allowed for a specific message type
 * @param {string} mimetype - File mimetype
 * @param {string} messageType - Message type (image, video, voice)
 * @returns {boolean} True if allowed, false otherwise
 */
function validateFileType(mimetype, messageType) {
  switch (messageType) {
    case 'image':
      return ALLOWED_IMAGE_TYPES.includes(mimetype);
    case 'video':
      return ALLOWED_VIDEO_TYPES.includes(mimetype);
    case 'voice':
      return ALLOWED_VOICE_TYPES.includes(mimetype);
    default:
      return false;
  }
}

/**
 * Get file extension from mimetype
 * @param {string} mimetype - File mimetype
 * @returns {string} File extension without the dot
 */
function getExtensionFromMimetype(mimetype) {
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
  };

  return mimeMap[mimetype] || 'bin';
}

/**
 * Check image content against AWS Rekognition moderation labels
 * @param {Buffer} imageBuffer - Image buffer to check
 * @returns {Promise<Object>} { isAllowed, violations: [] }
 */
async function checkImageModeration(imageBuffer) {
  try {
    // Skip if Rekognition is disabled
    if (!REKOGNITION_ENABLED) {
      console.log('[mediaService] Rekognition moderation disabled, skipping check');
      return { isAllowed: true, violations: [] };
    }

    console.log('[mediaService] Running Rekognition content moderation check...');

    const command = new DetectModerationLabelsCommand({
      Image: {
        Bytes: imageBuffer,
      },
      MinConfidence: MODERATION_CONFIDENCE_THRESHOLD,
    });

    const response = await rekognitionClient.send(command);
    const violations = [];

    // Check for explicit content labels
    if (response.ModerationLabels && response.ModerationLabels.length > 0) {
      for (const label of response.ModerationLabels) {
        if (EXPLICIT_LABELS.some(explicit => label.Name.includes(explicit))) {
          violations.push({
            label: label.Name,
            confidence: label.Confidence,
          });
        }
      }
    }

    if (violations.length > 0) {
      console.log(`[mediaService] Moderation violations detected:`, violations);
      return {
        isAllowed: false,
        violations,
      };
    }

    console.log('[mediaService] Image passed moderation check ✓');
    return { isAllowed: true, violations: [] };
  } catch (error) {
    // Non-fatal: log error but allow image (fail-open for graceful degradation)
    console.warn('[mediaService] Rekognition check failed (non-fatal):', error.message);
    return { isAllowed: true, violations: [] };
  }
}

/**
 * Upload media to S3 and return CloudFront URLs
 * @param {Object} file - File object from multer { buffer, mimetype, originalname, size }
 * @param {string} roomId - Chat room ID
 * @param {string} messageType - Type of media (image, video, voice)
 * @returns {Promise<Object>} { mediaUrl, mediaThumb, mediaSizeKb }
 */
async function uploadChatMedia(file, roomId, messageType) {
  try {
    // Validate file type
    if (!validateFileType(file.mimetype, messageType)) {
      throw new Error(`Invalid file type ${file.mimetype} for ${messageType}`);
    }

    const ext = getExtensionFromMimetype(file.mimetype);
    const fileId = uuidv4();
    const bucketName = process.env.S3_BUCKET_NAME;
    const cloudfrontBase = process.env.CLOUDFRONT_BASE_URL;
    const mediaSizeKb = Math.ceil(file.size / 1024);

    if (messageType === 'image') {
      // Validate image size
      const maxImageSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB) || 10;
      const maxImageSizeBytes = maxImageSizeMb * 1024 * 1024;

      if (file.size > maxImageSizeBytes) {
        throw new Error(`Image exceeds maximum size of ${maxImageSizeMb}MB`);
      }

      // Check image moderation before processing
      const moderationCheck = await checkImageModeration(file.buffer);
      if (!moderationCheck.isAllowed) {
        const violationsList = moderationCheck.violations
          .map(v => `${v.label} (${v.confidence.toFixed(1)}%)`)
          .join(', ');
        throw new Error(`Image contains prohibited content: ${violationsList}`);
      }

      // Compress main image
      const compressedBuffer = await sharp(file.buffer)
        .resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Generate thumbnail
      const thumbBuffer = await sharp(file.buffer)
        .resize(300, 300, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 60 })
        .toBuffer();

      // Upload compressed image
      const imageKey = `chat/${roomId}/${fileId}.jpg`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: imageKey,
          Body: compressedBuffer,
          ContentType: 'image/jpeg',
          ACL: 'private',
        })
      );

      // Upload thumbnail
      const thumbKey = `chat/${roomId}/thumb_${fileId}.jpg`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: thumbKey,
          Body: thumbBuffer,
          ContentType: 'image/jpeg',
          ACL: 'private',
        })
      );

      console.log(`[mediaService] Image uploaded: ${imageKey} (${mediaSizeKb}KB)`);

      return {
        mediaUrl: `${cloudfrontBase}/${imageKey}`,
        mediaThumb: `${cloudfrontBase}/${thumbKey}`,
        mediaSizeKb,
      };
    }

    if (messageType === 'video') {
      // Validate video size
      const maxVideoSizeMb = parseInt(process.env.MAX_VIDEO_SIZE_MB) || 100;
      const maxVideoSizeBytes = maxVideoSizeMb * 1024 * 1024;

      if (file.size > maxVideoSizeBytes) {
        throw new Error(`Video exceeds maximum size of ${maxVideoSizeMb}MB`);
      }

      // Upload raw video
      const videoKey = `chat/${roomId}/${fileId}.${ext}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: videoKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'private',
        })
      );

      console.log(`[mediaService] Video uploaded: ${videoKey} (${mediaSizeKb}KB)`);

      return {
        mediaUrl: `${cloudfrontBase}/${videoKey}`,
        mediaThumb: null,
        mediaSizeKb,
      };
    }

    if (messageType === 'voice') {
      // Validate voice message size (5MB max)
      const maxVoiceSizeBytes = 5 * 1024 * 1024;

      if (file.size > maxVoiceSizeBytes) {
        throw new Error('Voice message exceeds maximum size of 5MB');
      }

      // Upload raw voice
      const voiceKey = `chat/${roomId}/${fileId}.${ext}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: voiceKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'private',
        })
      );

      console.log(`[mediaService] Voice message uploaded: ${voiceKey} (${mediaSizeKb}KB)`);

      return {
        mediaUrl: `${cloudfrontBase}/${voiceKey}`,
        mediaThumb: null,
        mediaSizeKb,
      };
    }

    throw new Error(`Unsupported message type: ${messageType}`);
  } catch (error) {
    console.error('[mediaService] uploadChatMedia error:', error.message);
    throw error;
  }
}

/**
 * Delete media from S3 by key
 * @param {string} s3Key - S3 object key to delete
 * @returns {Promise<boolean>} True if successful, false if failed
 */
async function deleteFromS3(s3Key) {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
      })
    );

    console.log(`[mediaService] Deleted from S3: ${s3Key}`);
    return true;
  } catch (error) {
    console.error(`[mediaService] Failed to delete from S3 (${s3Key}):`, error.message);
    // Non-fatal: don't throw, just log and return false
    return false;
  }
}

module.exports = {
  uploadChatMedia,
  deleteFromS3,
  validateFileType,
};
