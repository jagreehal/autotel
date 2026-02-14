import { Injectable } from '@nestjs/common';
import { trace, type TraceContext } from 'autotel';

@Injectable()
export class AppService {
  private readonly tracedFetchUser = trace((ctx: TraceContext) => async (userId: string) => {
    ctx.setAttribute('db.query', 'SELECT * FROM users WHERE id = ?');
    ctx.setAttribute('db.userId', userId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { id: userId, name: `User ${userId}`, email: `user${userId}@example.com` };
  });

  private readonly tracedFetchOrders = trace((ctx: TraceContext) => async (userId: string) => {
    ctx.setAttribute('db.query', 'SELECT * FROM orders WHERE userId = ?');
    ctx.setAttribute('db.userId', userId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return [
      { id: 'order-1', userId, amount: 99.99 },
      { id: 'order-2', userId, amount: 149.99 },
    ];
  });

  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async fetchUser(userId: string) {
    return this.tracedFetchUser(userId);
  }

  async fetchOrders(userId: string) {
    return this.tracedFetchOrders(userId);
  }

  throwError(): never {
    throw new Error('This is a test error');
  }
}
