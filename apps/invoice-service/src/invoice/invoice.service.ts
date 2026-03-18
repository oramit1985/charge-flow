import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import * as PDFDocument from 'pdfkit';
import { EventBridgeService, awsConfig } from '@app/aws';
import {
  OrderEventType,
  OrderCreatedPayload,
  OrderInvoicedPayload,
} from '@app/common/common-types';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/common-types/enums/error-codes';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
    @Inject(awsConfig.KEY) private readonly aws: ConfigType<typeof awsConfig>,
    private readonly configService: ConfigService,
    private readonly eventBridgeService: EventBridgeService,
  ) {
    this.bucketName = this.configService.getOrThrow<string>('S3_INVOICES_BUCKET');

    this.s3Client = new S3Client({
      region: aws.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
      ...(aws.endpointUrl ? { endpoint: aws.endpointUrl, forcePathStyle: true } : {}),
    });
  }

  /**
   * Ensures the S3 invoices bucket exists.
   */
  async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`S3 bucket already exists: ${this.bucketName}`);
    } catch {
      await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`S3 bucket created: ${this.bucketName}`);
    }
  }

  /**
   * Processes an OrderCreated event: generates a PDF invoice, stores it in S3,
   * and publishes an OrderInvoiced event.
   */
  async processOrderCreated(payload: OrderCreatedPayload): Promise<void> {
    this.logger.log('Processing OrderCreated', { orderId: payload.orderId });

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.generatePdfInvoice(payload);
    } catch (error: unknown) {
      this.logger.error('PDF generation failed', { orderId: payload.orderId, error });
      throw new AppError(
        ErrorCode.INVOICE_GENERATION_FAILED,
        'Failed to generate invoice PDF',
        500,
        { orderId: payload.orderId },
      );
    }

    const s3Key = `invoices/${payload.orderId}/invoice.pdf`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }),
    );

    const invoiceUrl = this.aws.endpointUrl
      ? `${this.aws.endpointUrl}/${this.bucketName}/${s3Key}`
      : `https://${this.bucketName}.s3.amazonaws.com/${s3Key}`;

    this.logger.log('Invoice PDF uploaded to S3', { orderId: payload.orderId, invoiceUrl });

    const invoicedPayload: OrderInvoicedPayload = {
      orderId: payload.orderId,
      customerId: payload.customerId,
      customerEmail: payload.customerEmail,
      invoiceUrl,
      total: payload.total,
      currency: payload.currency,
      paymentMethodId: payload.paymentMethodId,
    };

    await this.eventBridgeService.publishEvent(OrderEventType.OrderInvoiced, invoicedPayload);
    this.logger.log('OrderInvoiced event published', { orderId: payload.orderId });
  }

  /**
   * Generates a PDF invoice from the order payload and returns it as a Buffer.
   */
  private generatePdfInvoice(payload: OrderCreatedPayload): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('INVOICE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).font('Helvetica');

      // Order info
      doc.text(`Order ID: ${payload.orderId}`);
      doc.text(`Date: ${new Date().toLocaleDateString('en-US')}`);
      doc.text(`Customer ID: ${payload.customerId}`);
      doc.text(`Customer Email: ${payload.customerEmail}`);
      doc.moveDown();

      // Shipping address
      doc.font('Helvetica-Bold').text('Ship To:');
      doc.font('Helvetica');
      const addr = payload.shippingAddress;
      doc.text(addr.line1);
      if (addr.line2) doc.text(addr.line2);
      doc.text(`${addr.city}, ${addr.state} ${addr.postalCode}`);
      doc.text(addr.countryCode);
      doc.moveDown();

      // Line items table header
      doc.font('Helvetica-Bold');
      doc.text('Product', 50, doc.y, { width: 200, continued: false });
      const headerY = doc.y - doc.currentLineHeight();
      doc.text('Qty', 260, headerY, { width: 60 });
      doc.text('Unit Price', 330, headerY, { width: 100 });
      doc.text('Total', 440, headerY, { width: 80, align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      // Line items
      doc.font('Helvetica');
      for (const item of payload.items) {
        const lineTotal = item.unitPrice * item.quantity;
        const y = doc.y;
        doc.text(item.name, 50, y, { width: 200 });
        doc.text(String(item.quantity), 260, y, { width: 60 });
        doc.text(this.formatCurrency(item.unitPrice, payload.currency), 330, y, { width: 100 });
        doc.text(this.formatCurrency(lineTotal, payload.currency), 440, y, {
          width: 80,
          align: 'right',
        });
        doc.moveDown();
      }

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Totals
      const totalsX = 380;
      doc.font('Helvetica');
      doc.text('Subtotal:', totalsX, doc.y, { continued: true });
      doc.text(this.formatCurrency(payload.subtotal, payload.currency), { align: 'right' });
      doc.text('Shipping:', totalsX, doc.y, { continued: true });
      doc.text(this.formatCurrency(payload.shippingCost, payload.currency), { align: 'right' });
      doc.text('Tax:', totalsX, doc.y, { continued: true });
      doc.text(this.formatCurrency(payload.tax, payload.currency), { align: 'right' });
      doc.font('Helvetica-Bold');
      doc.text('Total:', totalsX, doc.y, { continued: true });
      doc.text(this.formatCurrency(payload.total, payload.currency), { align: 'right' });

      doc.end();
    });
  }

  /** Formats an integer amount in cents as a currency string. */
  private formatCurrency(cents: number, currency: string): string {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
  }
}
