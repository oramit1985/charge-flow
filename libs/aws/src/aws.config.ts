import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export const awsConfig = registerAs('aws', () => ({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
  accessKeyId: process.env['AWS_ACCESS_KEY_ID'] ?? '',
  secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
  endpointUrl: process.env['AWS_ENDPOINT_URL'],
  eventBusName: process.env['ORDER_EVENT_BUS_NAME'] ?? 'ecommerce-orders',
}));

export const awsValidationSchema = Joi.object({
  AWS_REGION: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_ENDPOINT_URL: Joi.string().uri().optional(),
  ORDER_EVENT_BUS_NAME: Joi.string().required(),
});