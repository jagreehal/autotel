/**
 * An orders queue with a dead-letter queue you can inspect and replay.
 *
 * - The consumer retries with backoff. On its last attempt it calls
 *   `recordDLQ` with the reason, then moves the message to the DLQ with its
 *   own span context attached.
 * - `inspectDeadLetters` lists up to 10 dead letters with reason, attempts and
 *   trace id.
 * - `replayDeadLetters` sends them back. The consumer calls `recordReplay`, and
 *   the replay span links to the attempt that dead-lettered the message.
 *
 * The consumer moves the message itself so the DLQ copy carries that span
 * context. StartMessageMoveTask keeps trace attributes, but SQS delivers a
 * redriven message as new (ApproximateReceiveCount 1). The RedrivePolicy
 * catches a consumer that stops mid-message.
 */
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
  type MessageAttributeValue,
} from '@aws-sdk/client-sqs';
import { createLinkFromHeaders } from 'autotel';
import { traceConsumer, traceProducer } from 'autotel/messaging';

export const MAX_ATTEMPTS = 3;

export interface Order {
  id: string;
  total: number;
}

type Attributes = Record<string, MessageAttributeValue>;

export const sqs = new SQSClient({
  endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const str = (value: string): MessageAttributeValue => ({
  DataType: 'String',
  StringValue: value,
});

function headersOf(attributes: Attributes = {}) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value.StringValue !== undefined) headers[key] = value.StringValue;
  }
  return headers;
}

async function createQueue(name: string, attributes?: Record<string, string>) {
  const { QueueUrl } = await sqs.send(
    new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
  );
  return QueueUrl!;
}

export async function createOrderQueues(name: string) {
  const dlqUrl = await createQueue(`${name}-dlq`);
  const { Attributes } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: dlqUrl,
      AttributeNames: ['QueueArn'],
    }),
  );
  const queueUrl = await createQueue(name, {
    // Backstop only: the consumer dead-letters on attempt MAX_ATTEMPTS.
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: Attributes!.QueueArn,
      maxReceiveCount: MAX_ATTEMPTS + 1,
    }),
  });
  return { name, queueUrl, dlqName: `${name}-dlq`, dlqUrl };
}

export type OrderQueues = Awaited<ReturnType<typeof createOrderQueues>>;

export function createOrderFlow(
  queues: OrderQueues,
  charge: (order: Order) => Promise<void>,
) {
  const publishOrder = traceProducer({
    system: 'aws_sqs',
    destination: queues.name,
  })((ctx) => async (order: Order) => {
    ctx.setAttribute('order.id', order.id);
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queues.queueUrl,
        MessageBody: JSON.stringify(order),
        MessageAttributes: Object.fromEntries(
          Object.entries(ctx.getTraceHeaders()).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, str(value)]],
          ),
        ),
      }),
    );
  });

  const deleteFrom = (queueUrl: string, message: Message) =>
    sqs.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );

  const processOrder = traceConsumer<Message>({
    system: 'aws_sqs',
    destination: queues.name,
    headersFrom: (message) => headersOf(message.MessageAttributes),
  })((ctx) => async (message: Message) => {
    const headers = headersOf(message.MessageAttributes);
    // SAFETY: publishOrder is the only writer to this queue and the DLQ.
    const order = JSON.parse(message.Body!) as Order;
    ctx.setAttribute('order.id', order.id);

    const deadLettered = headers['dlq.traceparent']
      ? createLinkFromHeaders({ traceparent: headers['dlq.traceparent'] })
      : null;
    if (deadLettered) {
      ctx.recordReplay({
        originalDLQSpanContext: deadLettered.context,
        dlqDwellTimeMs: Date.now() - Number(headers['dlq.routed_at']),
        replayAttempt: Number(headers['replay.attempt']),
      });
    }

    const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
    try {
      await charge(order);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        ctx.recordRetry(attempt, MAX_ATTEMPTS);
        // Backoff: the message reappears after `attempt` seconds.
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queues.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: attempt,
          }),
        );
        throw cause;
      }

      ctx.recordDLQ(cause.message, queues.dlqName, {
        reasonCategory: 'processing',
        attemptCount: attempt,
        originalError: cause,
      });
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queues.dlqUrl,
          MessageBody: message.Body,
          MessageAttributes: {
            ...message.MessageAttributes,
            'dlq.traceparent': str(`00-${ctx.traceId}-${ctx.spanId}-01`),
            'dlq.reason': str(cause.message),
            'dlq.attempts': str(String(attempt)),
            'dlq.routed_at': str(String(Date.now())),
          },
        }),
      );
      await deleteFrom(queues.queueUrl, message);
      throw cause;
    }
    await deleteFrom(queues.queueUrl, message);
  });

  /** One receive from the orders queue; failures are recorded on their spans. */
  async function consumeOnce(): Promise<void> {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queues.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    await Promise.allSettled(Messages.map((message) => processOrder(message)));
  }

  async function receiveDeadLetters(visibilityTimeout: number) {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queues.dlqUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: visibilityTimeout,
        MessageAttributeNames: ['All'],
      }),
    );
    return Messages;
  }

  /** Up to 10 dead letters and why each failed, left in the DLQ. */
  async function inspectDeadLetters() {
    return (await receiveDeadLetters(0)).map((message) => {
      const headers = headersOf(message.MessageAttributes);
      return {
        // SAFETY: the DLQ only holds messages publishOrder wrote.
        orderId: (JSON.parse(message.Body!) as Order).id,
        reason: headers['dlq.reason'] ?? 'unknown (moved by RedrivePolicy)',
        attempts: Number(headers['dlq.attempts'] ?? MAX_ATTEMPTS + 1),
        traceId: headers.traceparent?.split('-')[1],
      };
    });
  }

  /** Send every dead letter back to the orders queue. Returns how many. */
  async function replayDeadLetters(): Promise<number> {
    let replayed = 0;
    // A receive returns at most 10; replayed messages are deleted, so an
    // empty long poll means the DLQ is drained.
    for (
      let messages = await receiveDeadLetters(30);
      messages.length > 0;
      messages = await receiveDeadLetters(30)
    ) {
      for (const message of messages) {
        await replayOne(message);
      }
      replayed += messages.length;
    }
    return replayed;
  }

  async function replayOne(message: Message) {
    const replayAttempt =
      Number(headersOf(message.MessageAttributes)['replay.attempt'] ?? 0) + 1;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queues.queueUrl,
        MessageBody: message.Body,
        MessageAttributes: {
          ...message.MessageAttributes,
          'replay.attempt': str(String(replayAttempt)),
        },
      }),
    );
    await deleteFrom(queues.dlqUrl, message);
  }

  return {
    publishOrder,
    consumeOnce,
    inspectDeadLetters,
    replayDeadLetters,
  };
}
