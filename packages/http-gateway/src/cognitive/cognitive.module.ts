import { Module } from '@nestjs/common';
import { CognitiveController } from './cognitive.controller.js';

@Module({
  controllers: [CognitiveController],
})
export class CognitiveModule {}
