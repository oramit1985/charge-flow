import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/common-types/enums/error-codes';

export interface DhlShipmentRequest {
  orderId: string;
  recipientName: string;
  recipientEmail: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
  contentDescription: string;
}

export interface DhlShipmentResult {
  trackingNumber: string;
  carrier: string;
  estimatedDelivery: string;
}

@Injectable()
export class DhlService {
  private readonly logger = new Logger(DhlService.name);
  private readonly baseUrl: string;
  private readonly accountNumber: string;
  private readonly authHeader: string;

  // Shipper details come from config (your company's address)
  private readonly shipperName: string;
  private readonly shipperEmail: string;
  private readonly shipperPhone: string;
  private readonly shipperAddressLine1: string;
  private readonly shipperCity: string;
  private readonly shipperPostalCode: string;
  private readonly shipperCountryCode: string;
  private readonly defaultWeightKg: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.baseUrl = this.configService.getOrThrow<string>('DHL_BASE_URL');
    this.accountNumber = this.configService.getOrThrow<string>('DHL_ACCOUNT_NUMBER');

    const apiKey = this.configService.getOrThrow<string>('DHL_API_KEY');
    const apiSecret = this.configService.getOrThrow<string>('DHL_API_SECRET');
    this.authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

    this.shipperName = this.configService.getOrThrow<string>('DHL_SHIPPER_NAME');
    this.shipperEmail = this.configService.getOrThrow<string>('DHL_SHIPPER_EMAIL');
    this.shipperPhone = this.configService.getOrThrow<string>('DHL_SHIPPER_PHONE');
    this.shipperAddressLine1 = this.configService.getOrThrow<string>('DHL_SHIPPER_ADDRESS_LINE1');
    this.shipperCity = this.configService.getOrThrow<string>('DHL_SHIPPER_CITY');
    this.shipperPostalCode = this.configService.getOrThrow<string>('DHL_SHIPPER_POSTAL_CODE');
    this.shipperCountryCode = this.configService.getOrThrow<string>('DHL_SHIPPER_COUNTRY_CODE');
    this.defaultWeightKg = parseFloat(
      this.configService.get<string>('DHL_DEFAULT_WEIGHT_KG') ?? '1',
    );
  }

  async createShipment(request: DhlShipmentRequest): Promise<DhlShipmentResult> {
    const plannedDate = new Date();
    plannedDate.setDate(plannedDate.getDate() + 1);
    const plannedShippingDate = plannedDate.toISOString().split('T')[0];

    const body = {
      plannedShippingDateAndTime: `${plannedShippingDate}T12:00:00 GMT+00:00`,
      pickup: { isRequested: false },
      productCode: 'P', // DHL Express Worldwide
      accounts: [{ number: this.accountNumber, typeCode: 'shipper' }],
      customerDetails: {
        shipperDetails: {
          postalAddress: {
            addressLine1: this.shipperAddressLine1,
            cityName: this.shipperCity,
            postalCode: this.shipperPostalCode,
            countryCode: this.shipperCountryCode,
          },
          contactInformation: {
            fullName: this.shipperName,
            email: this.shipperEmail,
            phone: this.shipperPhone,
          },
          typeCode: 'shipper',
        },
        receiverDetails: {
          postalAddress: {
            addressLine1: request.address.line1,
            ...(request.address.line2 ? { addressLine2: request.address.line2 } : {}),
            cityName: request.address.city,
            postalCode: request.address.postalCode,
            countryCode: request.address.countryCode,
            ...(request.address.state ? { provinceCode: request.address.state } : {}),
          },
          contactInformation: {
            fullName: request.recipientName,
            email: request.recipientEmail,
          },
          typeCode: 'receiver',
        },
      },
      content: {
        packages: [
          {
            weight: this.defaultWeightKg,
            dimensions: { length: 20, width: 15, height: 10 },
          },
        ],
        isCustomsDeclarable: false,
        description: request.contentDescription,
        incoterm: 'DAP',
        unitOfMeasurement: 'metric',
      },
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<DhlApiResponse>(`${this.baseUrl}/shipments`, body, {
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
        }),
      );

      const trackingNumber =
        response.data.packages?.[0]?.trackingNumber ?? response.data.shipmentTrackingNumber;

      // DHL Express Worldwide typically delivers in 1–3 business days
      const estimatedDelivery = this.addBusinessDays(new Date(), 3)
        .toISOString()
        .split('T')[0]!;

      this.logger.log('DHL shipment created', {
        orderId: request.orderId,
        trackingNumber,
      });

      return { trackingNumber, carrier: 'DHL', estimatedDelivery };
    } catch (error: unknown) {
      this.logger.error('DHL API call failed', { orderId: request.orderId, error });
      throw new AppError(
        ErrorCode.SHIPPING_FAILED,
        'Failed to create DHL shipment',
        500,
        { orderId: request.orderId },
      );
    }
  }

  private addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      if (day !== 0 && day !== 6) added++; // skip weekends
    }
    return result;
  }
}

interface DhlApiResponse {
  shipmentTrackingNumber: string;
  packages?: Array<{ trackingNumber: string }>;
}
