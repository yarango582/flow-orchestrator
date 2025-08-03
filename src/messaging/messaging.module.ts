import { Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
