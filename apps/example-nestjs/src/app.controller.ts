import { Controller, Get, Param } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('users/:userId')
  async getUser(@Param('userId') userId: string) {
    return this.appService.fetchUser(userId);
  }

  @Get('users/:userId/orders')
  async getOrders(@Param('userId') userId: string) {
    return this.appService.fetchOrders(userId);
  }

  @Get('error')
  getError() {
    return this.appService.throwError();
  }
}
