import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { awsConfig } from './aws.config';

// How long a handler is allowed to run before its lock is considered stale.
// If the process crashes mid-handler, the next SQS delivery will reclaim the
// lock once this window has passed.
const PENDING_TTL_SECONDS = 5 * 60; // 5 minutes

// How long to keep completed records — must exceed SQS max retention (14 days)
// so a late re-delivery is still recognised as a duplicate.
const COMPLETED_TTL_SECONDS = 15 * 24 * 60 * 60; // 15 days

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly client: DynamoDBClient;
  private readonly tableName: string;

  constructor(@Inject(awsConfig.KEY) private readonly aws: ConfigType<typeof awsConfig>) {
    this.tableName = process.env['IDEMPOTENCY_TABLE'] ?? 'processed-events';

    this.client = new DynamoDBClient({
      region: aws.region,
      credentials: {
        accessKeyId: aws.accessKeyId,
        secretAccessKey: aws.secretAccessKey,
      },
      ...(aws.endpointUrl ? { endpoint: aws.endpointUrl } : {}),
    });
  }

  /**
   * Runs handler exactly once per eventId.
   *
   * States:
   *   pending   → handler is currently running (or process crashed mid-handler)
   *   completed → handler finished successfully; future deliveries are skipped
   *
   * Stale lock recovery:
   *   If a pending record is older than PENDING_TTL_SECONDS, we treat it as
   *   abandoned (process crashed) and overwrite it with a fresh pending lock.
   *   This means PENDING_TTL_SECONDS must be greater than the longest expected
   *   handler duration to avoid two instances processing the same event.
   */
  async runOnce(eventId: string, handler: () => Promise<void>): Promise<void> {
    const acquired = await this.tryAcquire(eventId);
    if (!acquired) {
      this.logger.warn('Duplicate event — skipping', { eventId });
      return;
    }

    try {
      await handler();
      await this.markCompleted(eventId);
    } catch (error) {
      // Release the pending lock so SQS can redeliver and retry.
      await this.release(eventId);
      throw error;
    }
  }

  /**
   * Writes a pending lock for the eventId.
   *
   * Succeeds when:
   *   - No record exists yet (first delivery), OR
   *   - A pending record exists but is stale (process crashed mid-handler)
   *
   * Fails (returns false) when:
   *   - A completed record exists (already processed successfully), OR
   *   - A pending record exists and is still within its window (another
   *     instance is actively processing this event right now)
   */
  private async tryAcquire(eventId: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const pendingUntil = now + PENDING_TTL_SECONDS;

    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            eventId:      { S: eventId },
            status:       { S: 'pending' },
            pendingUntil: { N: String(pendingUntil) },
            acquiredAt:   { S: new Date().toISOString() },
            // Short TTL so abandoned pending records are eventually cleaned up
            expiresAt:    { N: String(pendingUntil + 60) },
          },
          // Acquire if no record exists, OR the existing pending lock is stale.
          // A completed record always blocks acquisition (no pendingUntil attr).
          ConditionExpression:
            'attribute_not_exists(eventId) OR (#s = :pending AND pendingUntil < :now)',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':pending': { S: 'pending' },
            ':now':     { N: String(now) },
          },
        }),
      );
      return true;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Upgrades the lock from pending → completed with a long TTL.
   * Future deliveries of the same eventId will be skipped.
   */
  private async markCompleted(eventId: string): Promise<void> {
    const expiresAt = Math.floor(Date.now() / 1000) + COMPLETED_TTL_SECONDS;

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          eventId:     { S: eventId },
          status:      { S: 'completed' },
          completedAt: { S: new Date().toISOString() },
          expiresAt:   { N: String(expiresAt) },
        },
      }),
    );
  }

  /**
   * Deletes the pending lock so the next SQS delivery can acquire it and retry.
   * Called when the handler throws.
   */
  private async release(eventId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: { eventId: { S: eventId } },
        }),
      );
    } catch (error: unknown) {
      // Log but don't throw — the original handler error is what SQS needs to see.
      this.logger.error('Failed to release idempotency lock', { eventId, error });
    }
  }
}
