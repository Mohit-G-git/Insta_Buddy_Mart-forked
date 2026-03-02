const Joi = require('joi');

/**
 * Schema for Socket.io send_message event
 */
const sendMessageSchema = Joi.object({
  roomId: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'roomId must be a valid UUID',
      'any.required': 'roomId is required',
    }),

  content: Joi.string()
    .max(4000)
    .allow(null)
    .messages({
      'string.max': 'content cannot exceed 4000 characters',
    }),

  type: Joi.string()
    .valid('text', 'image', 'video', 'voice', 'system')
    .required()
    .messages({
      'any.only': 'type must be one of: text, image, video, voice, system',
      'any.required': 'type is required',
    }),

  mediaUrl: Joi.string()
    .uri()
    .max(500)
    .allow(null)
    .messages({
      'string.uri': 'mediaUrl must be a valid URI',
      'string.max': 'mediaUrl cannot exceed 500 characters',
    }),

  replyToId: Joi.string()
    .uuid({ version: 'uuidv4' })
    .allow(null)
    .messages({
      'string.guid': 'replyToId must be a valid UUID',
    }),
}).custom((value, helpers) => {
  // Custom validation: content OR mediaUrl must be present
  if (!value.content && !value.mediaUrl) {
    return helpers.error('any.custom', {
      message: 'Either content or mediaUrl must be provided',
    });
  }
  return value;
}, 'content_or_media_check');

/**
 * Schema for POST /rooms/direct
 */
const createDirectRoomSchema = Joi.object({
  target_user_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'target_user_id must be a valid UUID',
      'any.required': 'target_user_id is required',
    }),
});

/**
 * Schema for GET /rooms/:roomId/messages query parameters
 */
const paginationSchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'page must be a number',
      'number.min': 'page must be at least 1',
    }),

  limit: Joi.number()
    .integer()
    .min(10)
    .max(100)
    .default(50)
    .messages({
      'number.base': 'limit must be a number',
      'number.min': 'limit must be at least 10',
      'number.max': 'limit cannot exceed 100',
    }),
}).unknown(false);

/**
 * Schema for multipart media upload
 */
const mediaUploadSchema = Joi.object({
  message_type: Joi.string()
    .valid('image', 'video', 'voice')
    .required()
    .messages({
      'any.only': 'message_type must be one of: image, video, voice',
      'any.required': 'message_type is required',
    }),

  reply_to_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .allow(null)
    .optional()
    .messages({
      'string.guid': 'reply_to_id must be a valid UUID',
    }),
});

/**
 * Schema for POST /rooms/:roomId/messages (text message)
 */
const sendTextMessageSchema = Joi.object({
  content: Joi.string()
    .min(1)
    .max(4000)
    .required()
    .messages({
      'string.empty': 'content cannot be empty',
      'string.max': 'content cannot exceed 4000 characters',
      'any.required': 'content is required',
    }),

  reply_to_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .allow(null)
    .optional()
    .messages({
      'string.guid': 'reply_to_id must be a valid UUID',
    }),
});

/**
 * Schema for POST /rooms/group
 */
const createGroupRoomSchema = Joi.object({
  room_name: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': 'room_name cannot be empty',
      'string.max': 'room_name cannot exceed 100 characters',
      'any.required': 'room_name is required',
    }),

  member_ids: Joi.array()
    .items(Joi.string().uuid({ version: 'uuidv4' }))
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one member must be included',
      'any.required': 'member_ids is required',
    }),

  room_photo: Joi.string()
    .uri()
    .max(500)
    .allow(null)
    .optional()
    .messages({
      'string.uri': 'room_photo must be a valid URI',
    }),
});

/**
 * Schema for POST /rooms/:roomId/members
 */
const addMemberSchema = Joi.object({
  user_id: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid': 'user_id must be a valid UUID',
      'any.required': 'user_id is required',
    }),
});

/**
 * Schema for POST /notifications/register
 */
const registerFCMSchema = Joi.object({
  fcm_token: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.empty': 'fcm_token cannot be empty',
      'string.max': 'fcm_token cannot exceed 500 characters',
      'any.required': 'fcm_token is required',
    }),
});

/**
 * Validate data against a Joi schema
 * @param {Joi.Schema} schema - The Joi schema to validate against
 * @param {any} data - The data to validate
 * @returns {Object} { value, error } where error is null on success or error object on failure
 */
function validate(schema, data) {
  const { value, error } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    // Format error details
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
    }));

    return {
      value,
      error: {
        isJoi: true,
        message: error.message,
        details,
      },
    };
  }

  return { value, error: null };
}

module.exports = {
  sendMessageSchema,
  createDirectRoomSchema,
  paginationSchema,
  mediaUploadSchema,
  sendTextMessageSchema,
  createGroupRoomSchema,
  addMemberSchema,
  registerFCMSchema,
  validate,
};
