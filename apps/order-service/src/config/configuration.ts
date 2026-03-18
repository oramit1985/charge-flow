import * as Joi from 'joi';
import { awsValidationSchema } from '@app/aws';

export const validationSchema = awsValidationSchema.append({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  ORDERS_TABLE: Joi.string().required(),
  SES_FROM_EMAIL: Joi.string().email().required(),
});

export interface AppConfig {
  port: number;
  nodeEnv: string;
  ordersTable: string;
}

export default (): AppConfig => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  ordersTable: process.env['ORDERS_TABLE'] ?? 'orders',
});