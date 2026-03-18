import * as Joi from 'joi';
import { awsValidationSchema } from '@app/aws';

const dhlSchema = Joi.object({
  DHL_BASE_URL: Joi.string().uri().required(),
  DHL_API_KEY: Joi.string().required(),
  DHL_API_SECRET: Joi.string().required(),
  DHL_ACCOUNT_NUMBER: Joi.string().required(),
  DHL_SHIPPER_NAME: Joi.string().required(),
  DHL_SHIPPER_EMAIL: Joi.string().email().required(),
  DHL_SHIPPER_PHONE: Joi.string().required(),
  DHL_SHIPPER_ADDRESS_LINE1: Joi.string().required(),
  DHL_SHIPPER_CITY: Joi.string().required(),
  DHL_SHIPPER_POSTAL_CODE: Joi.string().required(),
  DHL_SHIPPER_COUNTRY_CODE: Joi.string().length(2).required(),
  DHL_DEFAULT_WEIGHT_KG: Joi.number().positive().default(1),
});

export const validationSchema = awsValidationSchema.append({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  SQS_QUEUE_NAME: Joi.string().required(),
}).concat(dhlSchema);

export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
});
