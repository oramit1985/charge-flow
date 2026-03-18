import * as Joi from 'joi';
import { awsValidationSchema } from '@app/aws';

export const validationSchema = awsValidationSchema.append({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  MOCK_CARRIER_BASE_URL: Joi.string().uri().optional().default('http://localhost:3000'),
  SQS_QUEUE_NAME: Joi.string().required(),
});

export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  mockCarrierBaseUrl: process.env['MOCK_CARRIER_BASE_URL'] ?? 'http://localhost:3000',
});
