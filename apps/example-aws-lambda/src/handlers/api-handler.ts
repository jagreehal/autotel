/**
 * API Handler - HTTP API Gateway events
 *
 * Demonstrates:
 * - wrapHandler() for simple Lambda wrapping
 * - traceLambda() for context access
 * - DynamoDB instrumentation
 */

import { init } from 'autotel';
import { wrapHandler, traceLambda } from 'autotel-aws/lambda';
import { instrumentSDK } from 'autotel-aws/sdk';
import { traceDynamoDB } from 'autotel-aws/dynamodb';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaContext } from 'autotel-aws';

// Initialize autotel (reads from OTEL_* env vars)
init({
  service: process.env.OTEL_SERVICE_NAME || 'autotel-lambda',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
});

// Create instrumented DynamoDB client
const dynamodb = instrumentSDK(new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
}));

// DynamoDB user lookup with semantic attributes
const fetchUserData = traceDynamoDB({
  operation: 'GetItem',
  table: process.env.DYNAMODB_TABLE_NAME || 'users',
})((ctx) => async (userId: string) => {
  ctx.setAttribute('db.statement', 'SELECT * FROM users WHERE id = ?');
  ctx.setAttribute('user.id', userId);

  const result = await dynamodb.send(
    new GetItemCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME || 'users',
      Key: { id: { S: userId } },
    })
  );

  ctx.setAttribute('user.exists', !!result.Item);
  return result.Item;
});

// Simple health check handler using wrapHandler
export const healthHandler = wrapHandler(
  async (_event: unknown, _context: LambdaContext): Promise<APIGatewayProxyResult> => {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        service: process.env.OTEL_SERVICE_NAME || 'autotel-lambda',
        timestamp: new Date().toISOString(),
      }),
    };
  }
);

// Main API handler using traceLambda for context access
export const handler = traceLambda<APIGatewayProxyEvent, APIGatewayProxyResult>(
  (ctx) => async (event) => {
    const { httpMethod, path, pathParameters } = event;

    ctx.setAttribute('http.method', httpMethod);
    ctx.setAttribute('http.path', path);

    // Health check
    if (path === '/health' && httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ok',
          service: process.env.OTEL_SERVICE_NAME || 'autotel-lambda',
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // Get user by ID
    if (path.startsWith('/users/') && httpMethod === 'GET') {
      const userId = pathParameters?.userId || path.split('/').pop();

      if (!userId) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'User ID is required' }),
        };
      }

      ctx.setAttribute('user.id', userId);

      const userData = await fetchUserData(userId);

      if (!userData) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'User not found' }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userData.id?.S,
          lastUpload: userData.lastUpload?.S,
          lastUploadSize: userData.lastUploadSize?.N ? parseInt(userData.lastUploadSize.N) : undefined,
          updatedAt: userData.updatedAt?.S,
        }),
      };
    }

    // Not found
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
    };
  }
);
