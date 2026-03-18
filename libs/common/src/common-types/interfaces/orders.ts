import {OrderEventType} from "../enums";

export interface OrderEventEnvelope<T = unknown> {
    eventId: string;
    eventType: OrderEventType;
    version: '1.0';
    occurredAt: string;
    payload: T;
}

export interface OrderItem {
    productId: string;
    quantity: number;
    unitPrice: number;
    name: string;
}

export interface Address {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
}

export interface OrderCreatedPayload {
    orderId: string;
    customerId: string;
    items: OrderItem[];
    subtotal: number;
    shippingCost: number;
    tax: number;
    total: number;
    currency: string;
    shippingAddress: Address;
    paymentMethodId: string;
    customerEmail: string;
}

export interface OrderInvoicedPayload {
    orderId: string;
    customerId: string;
    customerEmail: string;
    invoiceUrl: string;
    total: number;
    currency: string;
    paymentMethodId: string;
}

export interface OrderPaidPayload {
    orderId: string;
    customerId: string;
    customerEmail: string;
    chargeId: string;
    total: number;
    currency: string;
    shippingAddress: Address;
    items: OrderItem[];
}

export interface OrderPaymentFailedPayload {
    orderId: string;
    customerId: string;
    customerEmail: string;
    reason: string;
    declineCode?: string;
}

export interface OrderShippedPayload {
    orderId: string;
    customerId: string;
    customerEmail: string;
    carrier: string;
    trackingNumber: string;
    estimatedDelivery: string;
}
