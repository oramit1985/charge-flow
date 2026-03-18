import * as Joi from 'joi';
import { awsValidationSchema } from '@app/aws';

export const validationSchema = awsValidationSchema.append({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  STRIPE_SECRET_KEY: Joi.string().required(),
  SQS_QUEUE_NAME: Joi.string().required(),
});

export default () => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  stripeSecretKey: process.env['STRIPE_SECRET_KEY'] ?? '',
});