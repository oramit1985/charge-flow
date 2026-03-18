import * as Joi from 'joi';
import { awsValidationSchema } from '@app/aws';

export const validationSchema = awsValidationSchema.append({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  SES_FROM_EMAIL: Joi.string().email().required(),
  SQS_QUEUE_NAME: Joi.string().required(),
});

export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  sesFromEmail: process.env['SES_FROM_EMAIL'] ?? 'no-reply@ecommerce.example.com',
});
